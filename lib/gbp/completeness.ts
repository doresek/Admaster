// lib/gbp/completeness.ts
//
// P1-GBP-1 — GBP completeness engine (MANUAL-ASSIST MODE).
//
// There is NO Google Business Profile API access yet (allowlisting is an owner
// action, G0-GBP, weeks of review). The deliverable here is therefore a
// structured AUDIT: the owner describes the profile's current state once, and
// we return a 0-100 completeness score plus per-field cards, each carrying a
// copy-pasteable prepared value (derived deterministically from the client's
// living insight atoms — no LLM) and a business.google.com deep link the OWNER
// opens and executes by hand.
//
// Factual grounding (docs/ORGANIC-DEEP-RESEARCH.md §2, Whitespark 2026):
//   • GBP ≈32% of local-pack ranking; "open at search time" is a TOP-5 factor
//     → hours (incl. Friday/erev-chag + chagim closures) matter directly.
//   • The Services field jumped #81 → #22 → services must mirror real offers.
//   • Active profiles (fresh photos/posts) get ≈5× the views.
//   • Gemini grounds local answers on Maps data — "GBP is now an AI feed".
//
// STORAGE DECISION (V1 = STATELESS): content_artifacts.type is a constrained
// union (hook/post/creative_image/ad/campaign/message/landing) unsuited to a
// profile-state snapshot, and clients-table schema changes need the
// orchestrator. So V1 keeps the state client-entered (sessionStorage in the
// page); the VALUE is the audit itself. Follow-up: a `gbp_profile_state` home
// once the orchestrator opens a migration slot.

import type { ClientInsight } from '@/lib/intelligence/types';
import { holidaysInRange, type ILHoliday } from '@/lib/organic-calendar/holidays';

// ── State the owner fills in (what the profile looks like TODAY) ─────────────

export type GbpDayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export const GBP_DAY_KEYS: readonly GbpDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const GBP_DAY_LABELS_HE: Record<GbpDayKey, string> = {
  sun: 'ראשון', mon: 'שני', tue: 'שלישי', wed: 'רביעי',
  thu: 'חמישי', fri: 'שישי', sat: 'שבת',
};

/** One day's hours: explicitly closed, or an open+close pair ('HH:MM'). */
export interface GbpDayHours {
  closed: boolean;
  open?: string;
  close?: string;
}

export type GbpWeekHours = Partial<Record<GbpDayKey, GbpDayHours>>;

/** The owner-described current state of the Google Business Profile. */
export interface GbpProfileState {
  /** The real-world business name — the canonical NAP source of truth. */
  canonical_name: string;
  /** The name as it currently appears on the GBP (may be stuffed/mismatched). */
  gbp_name: string;
  city: string;
  primary_category: string;
  additional_categories: string[];
  /** Services currently listed on the profile's Services tab. */
  services: string[];
  description: string;
  website: string;
  phone: string;
  address: string;
  hours: GbpWeekHours;
  /** Special hours entered for the upcoming chagim. */
  holiday_hours_set: boolean;
  photos_last_30d: number;
  attributes_count: number;
  /** 'YYYY-MM' or 'YYYY-MM-DD'; '' when unset on the profile. */
  opening_date: string;
}

export function emptyProfileState(): GbpProfileState {
  return {
    canonical_name: '', gbp_name: '', city: '',
    primary_category: '', additional_categories: [],
    services: [], description: '', website: '', phone: '', address: '',
    hours: {}, holiday_hours_set: false,
    photos_last_30d: 0, attributes_count: 0, opening_date: '',
  };
}

/**
 * Defensively coerce an untrusted JSON body into a GbpProfileState (the API
 * receives this from the browser). Strings are trimmed and capped, arrays
 * filtered to capped strings, numbers clamped to sane non-negative ints.
 */
export function coerceProfileState(raw: unknown): GbpProfileState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, cap = 400): string =>
    typeof v === 'string' ? v.trim().slice(0, cap) : '';
  const strList = (v: unknown, capItems = 30, capLen = 200): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .slice(0, capItems).map((x) => x.trim().slice(0, capLen))
      : [];
  const int = (v: unknown, max = 999): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;

  const hours: GbpWeekHours = {};
  const hRaw = (r.hours && typeof r.hours === 'object' ? r.hours : {}) as Record<string, unknown>;
  const HHMM = /^\d{2}:\d{2}$/;
  for (const day of GBP_DAY_KEYS) {
    const d = hRaw[day];
    if (!d || typeof d !== 'object') continue;
    const dd = d as Record<string, unknown>;
    if (dd.closed === true) { hours[day] = { closed: true }; continue; }
    const open  = typeof dd.open  === 'string' && HHMM.test(dd.open)  ? dd.open  : undefined;
    const close = typeof dd.close === 'string' && HHMM.test(dd.close) ? dd.close : undefined;
    if (open && close) hours[day] = { closed: false, open, close };
  }

  return {
    canonical_name: str(r.canonical_name, 120),
    gbp_name:       str(r.gbp_name, 200),
    city:           str(r.city, 60),
    primary_category: str(r.primary_category, 100),
    additional_categories: strList(r.additional_categories, 9, 100),
    services:       strList(r.services, 50, 200),
    description:    str(r.description, 2000),
    website:        str(r.website, 300),
    phone:          str(r.phone, 40),
    address:        str(r.address, 200),
    hours,
    holiday_hours_set: r.holiday_hours_set === true,
    photos_last_30d:   int(r.photos_last_30d),
    attributes_count:  int(r.attributes_count),
    opening_date:      str(r.opening_date, 10),
  };
}

// ── Audit result shape ────────────────────────────────────────────────────────

export type GbpFieldStatus = 'ok' | 'weak' | 'missing';

export type GbpField =
  | 'name' | 'category' | 'services' | 'description' | 'hours'
  | 'holiday_hours' | 'photos' | 'attributes' | 'opening_date' | 'website';

export interface GbpAuditItem {
  field: GbpField;
  label_he: string;
  status: GbpFieldStatus;
  /** Copy-pasteable value the owner pastes into GBP (when we can prepare one). */
  prepared_value?: string;
  /** business.google.com deep link (redirects to the in-Search editor). */
  deep_link: string;
  /** Why this field matters — grounded in the 2026 local-pack research. */
  why_he: string;
  /** What specifically is off, in Hebrew (mismatch details, missing days…). */
  details_he?: string;
}

export interface GbpAudit {
  /** 0-100. Weighted: ok = full weight, weak = half, missing = 0. */
  score: number;
  items: GbpAuditItem[];
  /** Chagim inside the lookahead window that need special hours. */
  upcoming_holidays: ILHoliday[];
}

// ── Deep links (manual-assist: the owner opens these while signed in) ────────
// business.google.com legacy paths redirect single-location owners straight to
// the matching section of the in-Search profile editor.

const GBP_BASE = 'https://business.google.com';

export function gbpDeepLink(field: GbpField): string {
  switch (field) {
    case 'photos':   return `${GBP_BASE}/photos`;
    case 'services': return `${GBP_BASE}/services`;
    default:         return `${GBP_BASE}/info`;
  }
}

// ── Field weights (sum = 100) ─────────────────────────────────────────────────

export const GBP_FIELD_WEIGHTS: Record<GbpField, number> = {
  name: 10,
  category: 12,
  services: 14,        // Services field: #81 → #22 in Whitespark 2026
  description: 14,
  hours: 14,           // open-at-search-time = top-5 pack factor
  holiday_hours: 8,
  photos: 10,          // active profiles ≈5× views
  attributes: 6,
  opening_date: 4,
  website: 8,
};

/** Days ahead we require chagim special-hours to be entered for. */
export const HOLIDAY_LOOKAHEAD_DAYS = 60;

// ── Normalization helpers ─────────────────────────────────────────────────────

/** Collapse whitespace, unify Hebrew gershayim/quotes, lowercase latin. */
export function normalizeBizName(s: string): string {
  return s
    .replace(/[״“”"]/g, '"')
    .replace(/[׳’‘']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const GENERIC_CATEGORIES = [
  'עסק', 'עסקים', 'שירות', 'שירותים', 'חנות', 'חברה', 'כללי', 'מקצוען',
  'store', 'business', 'company', 'services', 'shop',
];

function isGenericCategory(cat: string): boolean {
  const n = normalizeBizName(cat);
  return GENERIC_CATEGORIES.some((g) => n === g);
}

const byConfidenceDesc = (a: ClientInsight, b: ClientInsight) => b.confidence - a.confidence;

/** Active atoms of a kind, highest confidence first, cleaned contents. */
function atomContents(atoms: ClientInsight[], kind: string, take: number): string[] {
  return atoms
    .filter((a) => a.status === 'active' && a.kind === kind && a.content.trim() !== '')
    .sort(byConfidenceDesc)
    .slice(0, take)
    .map((a) => a.content.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, ''));
}

// ── Suggested services (mirror real offers from business-layer atoms) ─────────

/** Distinct suggested service lines derived from core_offer/real_solution atoms. */
export function suggestServicesFromAtoms(atoms: ClientInsight[]): string[] {
  const raw = [
    ...atomContents(atoms, 'core_offer', 5),
    ...atomContents(atoms, 'real_solution', 5),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const key = normalizeBizName(s);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(s.slice(0, 120));
  }
  return out;
}

/** Is a suggested offer covered by any listed service? (inclusion either way) */
function serviceCovers(services: string[], suggestion: string): boolean {
  const sug = normalizeBizName(suggestion);
  return services.some((sv) => {
    const n = normalizeBizName(sv);
    return n !== '' && (n.includes(sug) || sug.includes(n));
  });
}

// ── Description builder (deterministic Hebrew template — NO LLM) ─────────────
// GBP description policy: max 750 chars, no URLs/phone numbers — the builder
// stitches sentences from the client's atoms and cuts at a sentence boundary.

export const GBP_DESCRIPTION_MAX = 750;

export function buildGbpDescription(
  state: Pick<GbpProfileState, 'canonical_name' | 'city'>,
  atoms: ClientInsight[],
): string {
  const name = state.canonical_name.trim();
  if (name === '') return '';

  const offer    = atomContents(atoms, 'core_offer', 1)[0];
  const solution = atomContents(atoms, 'real_solution', 1)[0];
  const usp      = atomContents(atoms, 'real_usp', 1)[0];
  const value    = atomContents(atoms, 'true_value', 1)[0];
  const pains    = atomContents(atoms, 'pain_solved', 2);

  const where = state.city.trim() !== '' ? ` ב${state.city.trim()}` : '';

  const sentences: string[] = [];
  sentences.push(
    offer
      ? `${name}${where} — ${offer}.`
      : `${name}${where} — שירות אישי ומקצועי.`,
  );
  if (solution) sentences.push(`${solution}.`);
  if (usp)      sentences.push(`מה שמייחד אותנו: ${usp}.`);
  if (pains.length > 0) sentences.push(`אנחנו נותנים מענה אמיתי ל: ${pains.join('; ')}.`);
  if (value)    sentences.push(`הערך עבורכם: ${value}.`);
  sentences.push('מוזמנים לפנות אלינו — נשמח לעזור.');

  // Accumulate at sentence boundaries up to the 750-char policy cap.
  let out = '';
  for (const s of sentences) {
    const next = out === '' ? s : `${out} ${s}`;
    if (next.length > GBP_DESCRIPTION_MAX) break;
    out = next;
  }
  // A single pathological sentence longer than the cap: hard-truncate.
  if (out === '' && sentences.length > 0) {
    out = `${sentences[0].slice(0, GBP_DESCRIPTION_MAX - 1)}…`;
  }
  return out;
}

// ── The audit ─────────────────────────────────────────────────────────────────

export interface AuditOptions {
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Pure completeness audit: owner-described state + the client's living atoms →
 * score 0-100 + per-field cards (status, prepared value, deep link, why-Hebrew).
 */
export function auditCompleteness(
  state: GbpProfileState,
  atoms: ClientInsight[],
  opts: AuditOptions = {},
): GbpAudit {
  const now = opts.now ?? new Date();
  const items: GbpAuditItem[] = [];

  // 1. Name — exactness against the canonical business name (no stuffing).
  {
    let status: GbpFieldStatus;
    let details: string | undefined;
    if (state.gbp_name.trim() === '') {
      status = 'missing';
    } else if (normalizeBizName(state.gbp_name) === normalizeBizName(state.canonical_name)) {
      status = 'ok';
    } else {
      status = 'weak';
      details = `השם בפרופיל ("${state.gbp_name}") שונה מהשם הקנוני ("${state.canonical_name}") — תוספות מילות מפתח לשם מנוגדות למדיניות Google ומסכנות השעיה.`;
    }
    items.push({
      field: 'name', label_he: 'שם העסק', status,
      prepared_value: state.canonical_name || undefined,
      deep_link: gbpDeepLink('name'),
      why_he: 'שם זהה בדיוק לשם האמיתי של העסק (ולניתן בציטוטים/באתר) הוא בסיס אמון הישות; שם "מנופח" במילות מפתח מסכן השעיית פרופיל.',
      details_he: details,
    });
  }

  // 2. Category — present + narrowest (generic categories are a weak signal).
  {
    let status: GbpFieldStatus;
    let details: string | undefined;
    if (state.primary_category.trim() === '') {
      status = 'missing';
    } else if (isGenericCategory(state.primary_category)) {
      status = 'weak';
      details = `"${state.primary_category}" היא קטגוריה גנרית — בחרו את הקטגוריה הצרה ביותר שמתארת את הליבה (ואת הרחבות כקטגוריות משניות).`;
    } else {
      status = 'ok';
    }
    items.push({
      field: 'category', label_he: 'קטגוריה ראשית', status,
      deep_link: gbpDeepLink('category'),
      why_he: 'הקטגוריה הראשית היא אות הדירוג החזק ביותר בפרופיל (Whitespark 2026: GBP ≈32% ממשקל ה-Pack) — הצרה ביותר מנצחת את הרחבה.',
      details_he: details,
    });
  }

  // 3. Services — must mirror the real offers (from business-layer atoms).
  {
    const suggestions = suggestServicesFromAtoms(atoms);
    const uncovered = suggestions.filter((s) => !serviceCovers(state.services, s));
    let status: GbpFieldStatus;
    let details: string | undefined;
    if (state.services.length === 0) {
      status = 'missing';
    } else if (uncovered.length === 0) {
      status = 'ok';
    } else {
      status = 'weak';
      details = `שירותים מההצעה העסקית שחסרים בפרופיל: ${uncovered.join(' · ')}`;
    }
    items.push({
      field: 'services', label_he: 'שירותים (Services)', status,
      prepared_value: (uncovered.length > 0 ? uncovered : suggestions).join('\n') || undefined,
      deep_link: gbpDeepLink('services'),
      why_he: 'שדה השירותים זינק ממקום 81 למקום 22 בגורמי הדירוג המקומי (Whitespark 2026) — הוא צריך לשקף אחד-לאחד את ההצעות האמיתיות של העסק.',
      details_he: details,
    });
  }

  // 4. Description — ≤750 chars, prepared deterministically from the atoms.
  {
    const prepared = buildGbpDescription(state, atoms);
    const len = state.description.trim().length;
    let status: GbpFieldStatus;
    let details: string | undefined;
    if (len === 0) {
      status = 'missing';
    } else if (len > GBP_DESCRIPTION_MAX) {
      status = 'weak';
      details = `התיאור הנוכחי (${len} תווים) חורג ממגבלת ${GBP_DESCRIPTION_MAX} התווים של Google.`;
    } else if (len < 250) {
      status = 'weak';
      details = `התיאור הנוכחי קצר (${len} תווים) — יש מקום לנצל עד ${GBP_DESCRIPTION_MAX} תווים עם ההצעה, הבידול והערך.`;
    } else {
      status = 'ok';
    }
    items.push({
      field: 'description', label_he: 'תיאור העסק', status,
      prepared_value: prepared || undefined,
      deep_link: gbpDeepLink('description'),
      why_he: 'תיאור מלא (עד 750 תווים) שמזכיר את השירות, העיר והבידול מזין גם את החיפוש וגם את תשובות ה-AI — Gemini קורא את ה-GBP כפיד ("GBP is now an AI feed").',
      details_he: details,
    });
  }

  // 5. Hours — all 7 days explicit (open+close or closed), Friday called out.
  {
    const defined = GBP_DAY_KEYS.filter((d) => {
      const h = state.hours[d];
      return !!h && (h.closed || (!!h.open && !!h.close));
    });
    const missingDays = GBP_DAY_KEYS.filter((d) => !defined.includes(d));
    let status: GbpFieldStatus;
    let details: string | undefined;
    if (defined.length === 0) {
      status = 'missing';
    } else if (missingDays.length > 0) {
      status = 'weak';
      const names = missingDays.map((d) => GBP_DAY_LABELS_HE[d]).join(', ');
      details = missingDays.includes('fri')
        ? `ימים ללא שעות מוגדרות: ${names}. שימו לב במיוחד ליום שישי (סגירה מוקדמת/ערב חג) — פרופיל שנראה סגור בזמן חיפוש מפסיד את ה-Pack.`
        : `ימים ללא שעות מוגדרות: ${names}.`;
    } else {
      status = 'ok';
    }
    items.push({
      field: 'hours', label_he: 'שעות פעילות', status,
      deep_link: gbpDeepLink('hours'),
      why_he: '"פתוח בזמן החיפוש" הוא גורם Top-5 בדירוג ה-Pack (Whitespark 2026) — כל שבעת הימים חייבים שעות מפורשות, כולל שישי מקוצר ושבת סגור/פתוח במפורש.',
      details_he: details,
    });
  }

  // 6. Holiday special hours — chagim inside the lookahead window.
  const startISO = isoDate(now);
  const endISO = isoDate(new Date(now.getTime() + HOLIDAY_LOOKAHEAD_DAYS * 86_400_000));
  const upcoming = holidaysInRange(startISO, endISO);
  {
    let status: GbpFieldStatus;
    let details: string | undefined;
    let prepared: string | undefined;
    if (upcoming.length === 0) {
      status = 'ok';
      details = `אין חגים ב-${HOLIDAY_LOOKAHEAD_DAYS} הימים הקרובים — אין שעות מיוחדות להגדיר כרגע.`;
    } else if (state.holiday_hours_set) {
      status = 'ok';
    } else {
      status = 'missing';
      prepared = upcoming.map((h) => `${h.emoji} ${h.name} — ${h.date} (וערב החג)`).join('\n');
      details = `חגים קרובים ללא שעות מיוחדות: ${upcoming.map((h) => h.name).join(', ')}.`;
    }
    items.push({
      field: 'holiday_hours', label_he: 'שעות מיוחדות לחגים', status,
      prepared_value: prepared,
      deep_link: gbpDeepLink('holiday_hours'),
      why_he: 'Google מסמן "ייתכן ששעות הפעילות שונות בחגים" ומוריד אמון כשאין שעות מיוחדות — בחגי ישראל (וערבי חג) זה קורה כמה פעמים ברבעון.',
      details_he: details,
    });
  }

  // 7. Photos cadence — active profiles get ≈5× the views.
  {
    const n = state.photos_last_30d;
    const status: GbpFieldStatus = n >= 4 ? 'ok' : n >= 1 ? 'weak' : 'missing';
    items.push({
      field: 'photos', label_he: 'תמונות (30 יום אחרונים)', status,
      deep_link: gbpDeepLink('photos'),
      why_he: 'פרופילים פעילים (תמונות/פוסטים שוטפים) מקבלים בערך פי-5 צפיות — היעד: לפחות תמונה בשבוע.',
      details_he: status === 'ok' ? undefined : `הועלו ${n} תמונות ב-30 הימים האחרונים; היעד ≥4 (בערך אחת בשבוע).`,
    });
  }

  // 8. Attributes.
  {
    const n = state.attributes_count;
    const status: GbpFieldStatus = n >= 3 ? 'ok' : n >= 1 ? 'weak' : 'missing';
    items.push({
      field: 'attributes', label_he: 'מאפיינים (Attributes)', status,
      deep_link: gbpDeepLink('attributes'),
      why_he: 'מאפיינים (נגישות, חניה, שירותים בעסק…) מזינים סינון בחיפוש ותשובות AI — כל מאפיין רלוונטי שמסומן הוא עוד התאמת-שאילתה.',
      details_he: status === 'ok' ? undefined : `מסומנים ${n} מאפיינים — עברו על כל הרשימה שגוגל מציעה לקטגוריה שלכם.`,
    });
  }

  // 9. Opening date.
  {
    const status: GbpFieldStatus = state.opening_date.trim() !== '' ? 'ok' : 'missing';
    items.push({
      field: 'opening_date', label_he: 'תאריך פתיחת העסק', status,
      deep_link: gbpDeepLink('opening_date'),
      why_he: 'ותק העסק הוא אות אמון לישות (וגם מוצג בפרופיל) — שדה של דקה אחת שרוב המתחרים משאירים ריק.',
    });
  }

  // 10. Website link.
  {
    const w = state.website.trim();
    const status: GbpFieldStatus = w === '' ? 'missing' : /^https?:\/\//i.test(w) ? 'ok' : 'weak';
    items.push({
      field: 'website', label_he: 'קישור לאתר', status,
      prepared_value: w === '' ? undefined : w,
      deep_link: gbpDeepLink('website'),
      why_he: 'הקישור לאתר סוגר את משולש הישות (GBP ↔ אתר ↔ ציטוטים) — והאתר הוא המקור מספר 1 לתשובות AI מקומיות (BrightLocal: 58%).',
      details_he: status === 'weak' ? 'הקישור צריך להיות כתובת מלאה שמתחילה ב-https://‎.' : undefined,
    });
  }

  // Weighted score: ok = full, weak = half, missing = 0.
  const credit: Record<GbpFieldStatus, number> = { ok: 1, weak: 0.5, missing: 0 };
  const score = Math.round(
    items.reduce((sum, it) => sum + GBP_FIELD_WEIGHTS[it.field] * credit[it.status], 0),
  );

  return { score, items, upcoming_holidays: upcoming };
}
