// ════════════════════════════════════════════
// Meta OAuth helpers — used by the authorize + callback routes.
//
// Three concerns, kept out of the route handlers so they're unit-testable:
//   1. CSRF state: a signed (HS256) JWT carried through the OAuth round-trip.
//   2. Token exchange: code → short-lived token → long-lived token.
//   3. Identity: fetch the connected account's Pages + ad accounts (same shape
//      the manual /api/meta/clients flow stores), so an OAuth-connected client
//      is immediately usable.
//
// Dependency-free on purpose: the repo has no jsonwebtoken/jose, so we sign the
// state with Node's built-in crypto (HMAC-SHA256) in standard JWT wire format.
// ════════════════════════════════════════════
import { createHmac, timingSafeEqual } from 'crypto';
import {
  META_GRAPH_BASE,
  META_APP_ID,
  META_APP_SECRET,
  metaRedirectUri,
  assertMetaAppConfigured,
} from './meta-config';

// ── State JWT (CSRF) ─────────────────────────

// Dedicated secret for signing OAuth state. Falls back to ENCRYPTION_KEY (which
// is already required to be >= 32 chars) so the flow works out of the box in
// dev; set META_OAUTH_STATE_SECRET to a distinct random secret in production.
function stateSecret(): string {
  const s = process.env.META_OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY;
  if (!s || s.length < 32) {
    throw new Error(
      'META_OAUTH_STATE_SECRET (or ENCRYPTION_KEY) must be set and >= 32 chars to sign OAuth state',
    );
  }
  return s;
}

export interface MetaOAuthState {
  userId: string;
  clientId: string;
  returnTo: string;
  nonce: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(data: string): Buffer {
  return createHmac('sha256', stateSecret()).update(data).digest();
}

// Sign a state payload as an HS256 JWT. ttlSec bounds the OAuth round-trip.
export function signState(
  payload: Omit<MetaOAuthState, 'iat' | 'exp'>,
  ttlSec = 600,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ ...payload, iat: nowSec, exp: nowSec + ttlSec } satisfies MetaOAuthState),
  );
  const sig = b64url(hmac(`${header}.${body}`));
  return `${header}.${body}.${sig}`;
}

// Verify + decode. Returns null on any tampering, bad signature, or expiry.
export function verifyState(
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): MetaOAuthState | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const expected = hmac(`${header}.${body}`);
  let given: Buffer;
  try {
    given = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let parsed: MetaOAuthState;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed.userId || !parsed.clientId || typeof parsed.exp !== 'number') return null;
  if (parsed.exp < nowSec) return null;
  return parsed;
}

// ── Token exchange ───────────────────────────

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number; // seconds; absent/0 ⇒ long-lived / never-expiring
}

// Exchange the OAuth `code` for a short-lived user access token.
export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  assertMetaAppConfigured();
  const url =
    `${META_GRAPH_BASE}/oauth/access_token?` +
    new URLSearchParams({
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      redirect_uri: metaRedirectUri(),
      code,
    });
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'code exchange failed');
  if (!json.access_token) throw new Error('No access_token in code-exchange response');
  return json as TokenResponse;
}

// Exchange a short-lived user token for a long-lived one (~60 days).
//
// SYSTEM-USER / BUSINESS-LOGIN NOTE: when the app is configured with Facebook
// Login *for Business* (META_LOGIN_CONFIG_ID set, business_management granted),
// the token returned here is a business System-User token — long-lived and, for
// a properly configured business integration, effectively non-expiring. The
// wire call is identical (fb_exchange_token); what changes is the app-side
// Business Login configuration, which can only be exercised against the live
// Meta app + an approved business integration. In dev with a Tester account and
// classic scope login, this returns an ordinary ~60-day user token — enough to
// test the full round-trip end to end.
export async function exchangeForLongLivedToken(shortToken: string): Promise<TokenResponse> {
  assertMetaAppConfigured();
  const url =
    `${META_GRAPH_BASE}/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      fb_exchange_token: shortToken,
    });
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'long-lived exchange failed');
  if (!json.access_token) throw new Error('No access_token in long-lived response');
  return json as TokenResponse;
}

// ── Identity / metadata ──────────────────────

export interface MetaIdentity {
  metaUserId: string;
  metaUserName: string;
  pages: any[];
  adAccounts: any[];
}

// Fetch the connected account's identity + Pages + ad accounts. Mirrors the
// exact field set the manual /api/meta/clients flow persists, so an
// OAuth-connected client is immediately usable everywhere downstream.
export async function fetchMetaIdentity(token: string): Promise<MetaIdentity> {
  const enc = encodeURIComponent(token);

  const meRes = await fetch(`${META_GRAPH_BASE}/me?access_token=${enc}&fields=name,id`);
  const me = await meRes.json();
  if (me.error) throw new Error(me.error.message || 'failed to read /me');

  const pagesRes = await fetch(
    `${META_GRAPH_BASE}/me/accounts?access_token=${enc}&fields=id,name,fan_count,category,access_token`,
  );
  const pagesData = await pagesRes.json();
  const pages = pagesData.data ?? [];

  let adAccounts: any[] = [];
  try {
    const adsRes = await fetch(
      `${META_GRAPH_BASE}/me/adaccounts?access_token=${enc}&fields=id,name,currency,amount_spent,account_status`,
    );
    const adsData = await adsRes.json();
    adAccounts = adsData.data ?? [];
  } catch {
    /* ad accounts are best-effort — a Page-only token still connects */
  }

  return { metaUserId: me.id, metaUserName: me.name, pages, adAccounts };
}
