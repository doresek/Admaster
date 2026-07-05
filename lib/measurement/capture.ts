// lib/measurement/capture.ts
//
// PURE L0 identity capture (MEASUREMENT-SPINE-PLAN §2 — "click" step).
// Attribution without stored click IDs is guessing; this module is the single
// place that turns PUBLIC, hostile input (URL query strings, client-writable
// cookies, JSON POST bodies) into a clean `CapturedIdentity` that is safe to
// persist into lead_touchpoints. No I/O — usable from both the client-rendered
// /lp page and the public lead route.
//
// ── Capture strategy (DESIGN DECISION, documented per plan) ──────────────────
// The /lp/[slug] renderer is a fully CLIENT component ('use client', data
// fetched from /api/landing/public) — there is no server-rendered form, so
// "hidden fields rendered server-side" is not available without rewriting the
// public renderer (out of scope, high regression risk). The equivalent robust
// path implemented instead:
//   1. On mount the LP page parses window.location (fbclid/gclid/utm_*/path)
//      client-side with parseClickIds — the same validator the server uses.
//   2. A FIRST-TOUCH cookie ('am_tp', 90 days, JSON) is written client-side
//      IF absent and the visit carries any signal, so a visitor who clicks an
//      ad today and submits from a clean URL next week still attributes.
//      The cookie is deliberately NOT httpOnly: it must be written by the
//      client component, and it holds marketing identifiers — not credentials.
//      It is NEVER trusted: the server re-validates it through parseClickIds.
//   3. The lead POST carries `touchpoint` = current-visit identity merged over
//      the first-touch cookie (current visit wins — labeled last-click per
//      plan §1; the cookie only fills gaps for cross-page journeys).
//   4. The lead route independently re-validates the payload AND falls back to
//      its own read of the 'am_tp' request cookie — belt and braces.
//
// ── Validation policy (these values come from PUBLIC input) ──────────────────
//   • Click IDs (fbclid/gclid/ctwa_clid/meta_lead_id): trimmed, truncated at
//     256, then STRICT charset [A-Za-z0-9._-] — anything else is rejected to
//     null (not "cleaned": a click ID with stripped chars is a corrupt ID).
//   • UTM values: trimmed, truncated at 256, allowlist of unicode letters /
//     digits / light punctuation. Injection-shaped input (<, >, quotes, {},
//     backticks…) fails the allowlist and is rejected to null.
//   • landing_path: must start with '/', query/hash stripped, truncated at 256.
//   • Only the 5 canonical utm_* keys are kept — unknown keys are dropped.

/** Max stored length for any single captured value (DB is text, we cap anyway). */
export const MAX_CAPTURED_LEN = 256;

/** First-touch cookie name + lifetime (90 days, plan §2 L0). */
export const FIRST_TOUCH_COOKIE = 'am_tp';
export const FIRST_TOUCH_MAX_AGE_S = 90 * 24 * 60 * 60;

/** The 5 canonical UTM keys we persist (utm.content = campaign_item_id, plan §2). */
export const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

/** The clean, validated identity a visit carries. Everything else is dropped. */
export interface CapturedIdentity {
  fbclid:       string | null;
  gclid:        string | null;
  ctwa_clid:    string | null;
  meta_lead_id: string | null;
  utm:          Partial<Record<UtmKey, string>>;
  landing_path: string | null;
  referrer:     string | null;
}

export const EMPTY_IDENTITY: CapturedIdentity = {
  fbclid: null, gclid: null, ctwa_clid: null, meta_lead_id: null,
  utm: {}, landing_path: null, referrer: null,
};

// Click IDs are opaque platform tokens (base64url-ish). Reject, never clean.
const CLICK_ID_RE = /^[A-Za-z0-9._-]+$/;
// UTM values: unicode letters/digits + benign separators. No <>'"`{}$%&;\ etc.
const UTM_VALUE_RE = /^[\p{L}\p{N} _\-.+()/:|,]+$/u;
// Path: absolute, no query/hash (stripped before test), conservative charset.
const PATH_RE = /^\/[\p{L}\p{N}/_\-.~%+]*$/u;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asTrimmedString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** Truncate-then-allowlist a click ID. Rejection (null) over cleaning. */
export function sanitizeClickId(v: unknown): string | null {
  const s = asTrimmedString(v);
  if (s === null) return null;
  const capped = s.slice(0, MAX_CAPTURED_LEN);
  return CLICK_ID_RE.test(capped) ? capped : null;
}

/** Truncate-then-allowlist a UTM value. Injection-shaped input → null. */
export function sanitizeUtmValue(v: unknown): string | null {
  const s = asTrimmedString(v);
  if (s === null) return null;
  const capped = s.slice(0, MAX_CAPTURED_LEN).trim();
  return UTM_VALUE_RE.test(capped) ? capped : null;
}

/** Landing path: absolute pathname only (query/hash stripped), capped. */
export function sanitizeLandingPath(v: unknown): string | null {
  const s = asTrimmedString(v);
  if (s === null) return null;
  const noQuery = s.split(/[?#]/)[0].slice(0, MAX_CAPTURED_LEN);
  return PATH_RE.test(noQuery) ? noQuery : null;
}

/**
 * Referrer: must parse as an http(s) URL; stored origin+path only (no query —
 * a referrer query string can itself carry junk), capped.
 */
export function sanitizeReferrer(v: unknown): string | null {
  const s = asTrimmedString(v);
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname}`.slice(0, MAX_CAPTURED_LEN);
  } catch {
    // Not a URL at all — reject rather than store free text in a URL column.
    return null;
  }
}

/** Anything captured at all? (Gates cookie writes + "empty touchpoint" rows.) */
export function hasAnySignal(id: CapturedIdentity): boolean {
  return Boolean(
    id.fbclid || id.gclid || id.ctwa_clid || id.meta_lead_id ||
    Object.keys(id.utm).length > 0,
  );
}

/** Accepted raw inputs: a full URL / query string, URLSearchParams, or a JSON blob. */
export type ParseClickIdsInput = string | URLSearchParams | Record<string, unknown>;

function toParamMap(input: ParseClickIdsInput): Map<string, unknown> {
  const map = new Map<string, unknown>();

  if (typeof input === 'string') {
    // Accept both a full URL and a bare query string.
    let params: URLSearchParams;
    let path: string | null = null;
    try {
      const u = new URL(input);
      params = u.searchParams;
      path = u.pathname;
    } catch {
      params = new URLSearchParams(input.startsWith('?') ? input.slice(1) : input);
    }
    for (const [k, v] of params.entries()) map.set(k, v);
    if (path !== null) map.set('landing_path', path);
    return map;
  }

  if (input instanceof URLSearchParams) {
    for (const [k, v] of input.entries()) map.set(k, v);
    return map;
  }

  // JSON blob (POST payload / cookie): flat keys, plus an optional nested
  // `utm` object ({source, medium, ...}) which we flatten to utm_* keys.
  for (const [k, v] of Object.entries(input)) {
    if (k === 'utm' && isRecord(v)) {
      for (const key of UTM_KEYS) {
        if (key in v) map.set(`utm_${key}`, v[key]);
      }
      continue;
    }
    map.set(k, v);
  }
  return map;
}

/**
 * Extract + validate {fbclid, gclid, ctwa_clid, meta_lead_id, utm_*,
 * landing_path, referrer} from any public input shape. Every value passes the
 * strict per-field sanitizer; garbage becomes null / is dropped, never stored.
 */
export function parseClickIds(input: ParseClickIdsInput): CapturedIdentity {
  const params = toParamMap(input);

  const utm: Partial<Record<UtmKey, string>> = {};
  for (const key of UTM_KEYS) {
    const clean = sanitizeUtmValue(params.get(`utm_${key}`));
    if (clean !== null) utm[key] = clean;
  }

  return {
    fbclid:       sanitizeClickId(params.get('fbclid')),
    gclid:        sanitizeClickId(params.get('gclid')),
    ctwa_clid:    sanitizeClickId(params.get('ctwa_clid')),
    meta_lead_id: sanitizeClickId(params.get('meta_lead_id')),
    utm,
    landing_path: sanitizeLandingPath(params.get('landing_path')),
    referrer:     sanitizeReferrer(params.get('referrer')),
  };
}

/**
 * Merge the CURRENT visit's identity over the FIRST-TOUCH cookie identity.
 * Current wins per field (labeled last-click, plan §1); the first touch only
 * fills gaps (cross-page journeys where the submit URL lost the ids). The utm
 * block is taken whole from whichever side has one — mixing utm_source from
 * one visit with utm_content from another would fabricate a campaign that
 * never ran.
 */
export function mergeIdentity(current: CapturedIdentity, firstTouch: CapturedIdentity): CapturedIdentity {
  return {
    fbclid:       current.fbclid       ?? firstTouch.fbclid,
    gclid:        current.gclid        ?? firstTouch.gclid,
    ctwa_clid:    current.ctwa_clid    ?? firstTouch.ctwa_clid,
    meta_lead_id: current.meta_lead_id ?? firstTouch.meta_lead_id,
    utm:          Object.keys(current.utm).length > 0 ? current.utm : firstTouch.utm,
    landing_path: current.landing_path ?? firstTouch.landing_path,
    referrer:     current.referrer     ?? firstTouch.referrer,
  };
}

/** Serialize an identity for the first-touch cookie value (URI-encoded JSON). */
export function serializeFirstTouch(identity: CapturedIdentity): string {
  return encodeURIComponent(JSON.stringify(identity));
}

/**
 * Parse + RE-VALIDATE a first-touch cookie value. The cookie is client-writable
 * (not httpOnly by design — see header), so its content gets zero trust: it
 * goes back through parseClickIds like any other public input. Malformed JSON
 * → null (caller treats as "no first touch").
 */
export function parseFirstTouchCookie(value: string | undefined | null): CapturedIdentity | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!isRecord(parsed)) return null;
    return parseClickIds(parsed);
  } catch {
    return null;
  }
}

/** Insert shape for public.lead_touchpoints (migration 060). */
export interface TouchpointInsert {
  lead_id:       string;
  client_id:     string;
  owner_user_id: string;
  fbclid:        string | null;
  gclid:         string | null;
  ctwa_clid:     string | null;
  meta_lead_id:  string | null;
  utm:           Partial<Record<UtmKey, string>>;
  landing_path:  string | null;
  referrer:      string | null;
  user_agent:    string | null;
}

export interface BuildTouchpointInput {
  leadId:      string;
  clientId:    string;
  ownerUserId: string;
  identity:    CapturedIdentity;
  userAgent?:  string | null;
}

/** Shape a validated identity into a lead_touchpoints insert row. */
export function buildTouchpoint(input: BuildTouchpointInput): TouchpointInsert {
  const ua = asTrimmedString(input.userAgent);
  return {
    lead_id:       input.leadId,
    client_id:     input.clientId,
    owner_user_id: input.ownerUserId,
    fbclid:        input.identity.fbclid,
    gclid:         input.identity.gclid,
    ctwa_clid:     input.identity.ctwa_clid,
    meta_lead_id:  input.identity.meta_lead_id,
    utm:           input.identity.utm,
    landing_path:  input.identity.landing_path,
    referrer:      input.identity.referrer,
    user_agent:    ua === null ? null : ua.slice(0, MAX_CAPTURED_LEN),
  };
}
