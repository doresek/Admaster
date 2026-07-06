// lib/gbp/citations.ts
//
// P1-GBP-4 — NAP/citations sync checklist (MANUAL-ASSIST MODE).
//
// Citations fell to ~7% of local-pack weight (Whitespark 2026) but are "the new
// backlinks" for AI-answer entity confidence: a business whose name/address/
// phone read IDENTICALLY across GBP, the site's JSON-LD and the Israeli
// directory set (d.co.il, zap, easy, מידרג, Waze) is a high-confidence entity;
// ANY deviation (an old phone on zap, "רח'" vs "רחוב" on easy) fragments it.
//
// This module is a PURE comparator: the owner enters the canonical NAP and what
// each directory currently shows; we normalize (phones → E.164, quotes/dashes/
// whitespace unified) and flag every deviation, with a deep link per directory
// so the owner can fix it by hand. No network, no storage — runs client-side.

// ── The Israeli citation set ──────────────────────────────────────────────────

export type DirectoryId =
  | 'site_jsonld'   // the client's own site schema.org LocalBusiness JSON-LD
  | 'd_co_il'       // דפי זהב
  | 'zap'
  | 'easy'
  | 'midrag'
  | 'waze';

export interface DirectoryDef {
  id: DirectoryId;
  name_he: string;
  /** Where the owner finds/edits the listing (search deep link by name). */
  deepLink: (bizName: string, website?: string) => string;
  note_he: string;
}

const q = (s: string) => encodeURIComponent(s.trim());

export const IL_DIRECTORIES: readonly DirectoryDef[] = [
  {
    id: 'site_jsonld',
    name_he: 'האתר שלכם (JSON-LD)',
    deepLink: (_n, website) => (website && website.trim() !== '' ? website.trim() : ''),
    note_he: 'ה-schema.org LocalBusiness באתר הוא נקודת העיגון — הוא חייב להיות זהה ל-GBP אחד-לאחד.',
  },
  {
    id: 'd_co_il',
    name_he: 'דפי זהב (d.co.il)',
    deepLink: (n) => `https://www.d.co.il/search/?q=${q(n)}`,
    note_he: 'מדריך העסקים הוותיק בישראל — ציטוט הבסיס שכל מנוע בודק.',
  },
  {
    id: 'zap',
    name_he: 'זאפ (zap.co.il)',
    deepLink: (n) => `https://www.zap.co.il/search.aspx?keyword=${q(n)}`,
    note_he: 'השוואת מחירים + מדריך עסקים — נפוץ בציטוטי מסחר.',
  },
  {
    id: 'easy',
    name_he: 'איזי (easy.co.il)',
    deepLink: (n) => `https://easy.co.il/list/search?q=${q(n)}`,
    note_he: 'מדריך מקומי חזק במובייל — כולל שעות וטלפון שחייבים להתאים.',
  },
  {
    id: 'midrag',
    name_he: 'מידרג (midrag.co.il)',
    deepLink: (n) => `https://www.midrag.co.il/search?q=${q(n)}`,
    note_he: 'ביקורות בעלי מקצוע — מקור אמון שמנועי AI מצטטים בתשובות מקומיות.',
  },
  {
    id: 'waze',
    name_he: 'Waze',
    deepLink: (n) => `https://www.waze.com/he/live-map/search?q=${q(n)}`,
    note_he: 'נקודת העסק ב-Waze (דרך biz.world.waze.com) — כתובת/שם שגויים שם מטעים גם את גוגל.',
  },
] as const;

export function directoryById(id: DirectoryId): DirectoryDef | undefined {
  return IL_DIRECTORIES.find((d) => d.id === id);
}

// ── Normalizers ───────────────────────────────────────────────────────────────

/**
 * Normalize an Israeli phone number to E.164 (+972…).
 * Accepts '050-123-4567', '05 0 1234567', '(02) 623-1234', '+972-50-1234567',
 * '972501234567', '05x' mobiles and '0x' landlines. Returns null for star
 * numbers (*2244), short codes, or anything that doesn't yield a valid
 * 8-9-digit national number — those must be flagged, not silently passed.
 */
export function normalizePhoneIL(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.includes('*')) return null;

  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('972')) {
    digits = digits.slice(3);
    if (digits.startsWith('0')) digits = digits.slice(1); // +9720xx… typo form
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  } else {
    return null; // no leading 0 and no country code — ambiguous
  }

  // National significant number: 8 digits (landline: 2/3/4/8/9…) or
  // 9 digits (mobile 5x, VoIP 7x).
  if (!/^\d{8,9}$/.test(digits)) return null;
  if (digits.length === 9 && !/^[57]/.test(digits)) return null;

  return `+972${digits}`;
}

/** Unify quotes/gershayim, dashes, collapse whitespace, lowercase latin. */
export function normalizeNapText(s: string): string {
  return s
    .replace(/[״“”"]/g, '"')
    .replace(/[׳’‘']/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Address normalization: NAP text rules + רח'/רחוב unification. */
export function normalizeAddress(s: string): string {
  return normalizeNapText(s)
    .replace(/(^|\s)רח'(\s)/g, '$1רחוב$2')
    .replace(/(^|\s)שד'(\s)/g, '$1שדרות$2');
}

// ── The comparator ────────────────────────────────────────────────────────────

export interface CanonicalNap {
  name: string;
  address: string;
  phone: string;
  website?: string;
}

/** What one directory currently shows (owner-entered). */
export interface NapListing {
  directory: DirectoryId;
  /** false = the business has no listing there at all. */
  listed: boolean;
  name?: string;
  address?: string;
  phone?: string;
}

export type NapField = 'name' | 'address' | 'phone';

export interface NapDeviation {
  field: NapField;
  expected: string;
  found: string;
  note_he: string;
}

export type NapDirectoryStatus =
  | 'match'      // listed, every entered field matches the canonical NAP
  | 'deviation'  // listed, at least one field deviates
  | 'missing'    // not listed — a placement task
  | 'unknown';   // listed but no field data entered yet

export interface NapDirectoryResult {
  directory: DirectoryId;
  directory_name_he: string;
  status: NapDirectoryStatus;
  deviations: NapDeviation[];
  deep_link: string;
  note_he: string;
}

export interface NapReport {
  canonical_phone_e164: string | null;
  results: NapDirectoryResult[];
  /** true only when every listed directory matches and none is unknown. */
  consistent: boolean;
  issues_count: number;
}

const FIELD_HE: Record<NapField, string> = { name: 'שם', address: 'כתובת', phone: 'טלפון' };

/**
 * Pure NAP-consistency check: canonical vs what each directory shows.
 * Flags ANY deviation after normalization (phone compared in E.164; a phone
 * that cannot be normalized is itself a deviation).
 */
export function checkNapConsistency(
  canonical: CanonicalNap,
  listings: NapListing[],
): NapReport {
  const canonPhone = normalizePhoneIL(canonical.phone);
  const canonName = normalizeNapText(canonical.name);
  const canonAddr = normalizeAddress(canonical.address);

  const results: NapDirectoryResult[] = listings.map((l) => {
    const def = directoryById(l.directory);
    const deepLink = def ? def.deepLink(canonical.name, canonical.website) : '';
    const base = {
      directory: l.directory,
      directory_name_he: def?.name_he ?? l.directory,
      deep_link: deepLink,
      note_he: def?.note_he ?? '',
    };

    if (!l.listed) return { ...base, status: 'missing' as const, deviations: [] };

    const deviations: NapDeviation[] = [];

    if (l.name !== undefined && l.name.trim() !== '') {
      if (normalizeNapText(l.name) !== canonName) {
        deviations.push({
          field: 'name', expected: canonical.name, found: l.name,
          note_he: `ה${FIELD_HE.name} שונה מהקנוני — יש לעדכן לנוסח המדויק.`,
        });
      }
    }
    if (l.address !== undefined && l.address.trim() !== '') {
      if (normalizeAddress(l.address) !== canonAddr) {
        deviations.push({
          field: 'address', expected: canonical.address, found: l.address,
          note_he: `ה${FIELD_HE.address} שונה מהקנונית — אחידות מלאה (כולל "רחוב"/מספר) נדרשת.`,
        });
      }
    }
    if (l.phone !== undefined && l.phone.trim() !== '') {
      const listedPhone = normalizePhoneIL(l.phone);
      const mismatch =
        listedPhone === null || canonPhone === null
          ? normalizeNapText(l.phone) !== normalizeNapText(canonical.phone)
          : listedPhone !== canonPhone;
      if (mismatch) {
        deviations.push({
          field: 'phone', expected: canonical.phone, found: l.phone,
          note_he: `ה${FIELD_HE.phone} שונה מהקנוני (ההשוואה לאחר נרמול ל-E.164).`,
        });
      }
    }

    const anyEntered =
      (l.name?.trim() ?? '') !== '' ||
      (l.address?.trim() ?? '') !== '' ||
      (l.phone?.trim() ?? '') !== '';

    if (!anyEntered) return { ...base, status: 'unknown' as const, deviations: [] };
    return {
      ...base,
      status: deviations.length > 0 ? ('deviation' as const) : ('match' as const),
      deviations,
    };
  });

  const issues = results.filter((r) => r.status === 'deviation' || r.status === 'missing');
  const unknowns = results.some((r) => r.status === 'unknown');

  return {
    canonical_phone_e164: canonPhone,
    results,
    consistent: issues.length === 0 && !unknowns && results.length > 0,
    issues_count: issues.reduce(
      (n, r) => n + (r.status === 'missing' ? 1 : r.deviations.length),
      0,
    ),
  };
}
