// lib/retention/contacts.ts
//
// Pure contact-import machinery for the contacts API (T4): input
// normalization (consent REQUIRED — a consent-less row never becomes an
// insert), a small quote-aware CSV parser (no dependency), and the import
// planner that enforces dedup + the TOMBSTONE rule: a phone/email that maps
// to an opted-out contact is SKIPPED, never resurrected — re-import cannot
// undo an opt-out (doc §2 decision 2).

import { CONSENT_SOURCES, type ConsentSource } from './types';

/** A raw import row (CSV record or JSON object) before validation. */
export type RawContactInput = Record<string, unknown>;

/** A validated, normalized contact ready for insert (sans ids). */
export interface NormalizedContact {
  full_name: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  consent_source: ConsentSource;
  consented_at: string;             // ISO
  consent_evidence: string | null;
  last_purchase_at: string | null;
}

export type NormalizeResult =
  | { ok: true; contact: NormalizedContact }
  | { ok: false; error: string };

function asTrimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
}

/** Normalize a phone: strip spaces/dashes/parens; keep leading + and digits. */
export function normalizePhone(v: unknown): string | null {
  const s = asTrimmed(v);
  if (!s) return null;
  const cleaned = s.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,15}$/.test(cleaned)) return null;
  return cleaned;
}

/** Emails are lowercased at write time (052 comment: lib enforces). */
export function normalizeEmail(v: unknown): string | null {
  const s = asTrimmed(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
  return lower;
}

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
  const s = asTrimmed(v);
  if (!s) return [];
  return s.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
}

function parseTimestamp(v: unknown): string | null {
  const s = asTrimmed(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * Validate + normalize one contact input. `defaults` (e.g. a bulk consent
 * attestation for a whole CSV) is merged UNDER the row — but after the merge
 * every row MUST still carry consent_source + consented_at, or it is rejected.
 */
export function normalizeContactInput(
  row: RawContactInput,
  defaults: RawContactInput = {},
): NormalizeResult {
  const merged: RawContactInput = { ...defaults, ...stripEmpty(row) };

  const phone = normalizePhone(merged.phone);
  const email = normalizeEmail(merged.email);
  if (merged.phone && !phone) return { ok: false, error: 'invalid phone' };
  if (merged.email && !email) return { ok: false, error: 'invalid email' };
  if (!phone && !email) return { ok: false, error: 'contact needs phone or email' };

  const consentSource = asTrimmed(merged.consent_source);
  if (!consentSource || !CONSENT_SOURCES.includes(consentSource as ConsentSource)) {
    return { ok: false, error: `consent_source is required (one of: ${CONSENT_SOURCES.join(', ')})` };
  }
  const consentedAt = parseTimestamp(merged.consented_at);
  if (!consentedAt) {
    return { ok: false, error: 'consented_at is required (parseable timestamp)' };
  }

  return {
    ok: true,
    contact: {
      full_name: asTrimmed(merged.full_name),
      phone,
      email,
      tags: parseTags(merged.tags),
      consent_source: consentSource as ConsentSource,
      consented_at: consentedAt,
      consent_evidence: asTrimmed(merged.consent_evidence),
      last_purchase_at: parseTimestamp(merged.last_purchase_at),
    },
  };
}

function stripEmpty(row: RawContactInput): RawContactInput {
  const out: RawContactInput = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

// ── CSV (tiny, quote-aware; expected columns per the owner default:
//    full_name,phone,email,tags,consented_at,consent_source,consent_evidence,last_purchase_at) ──

/** Parse CSV text into records keyed by the header row. Handles "quoted, cells". */
export function parseCsv(text: string): RawContactInput[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1)
    .filter((cells) => cells.some((c) => c.trim().length > 0))
    .map((cells) => {
      const rec: RawContactInput = {};
      header.forEach((key, i) => { if (key) rec[key] = cells[i] ?? ''; });
      return rec;
    });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ── Import planning (dedup + tombstone) ───────────────────────────────────────

/** What the planner needs to know about an existing contact. */
export interface ExistingContactKey {
  id: string;
  phone: string | null;
  email: string | null;
  opted_out_at: string | null;
}

export type ImportRowAction =
  | { action: 'insert'; contact: NormalizedContact }
  | { action: 'skipped_opted_out'; existingId: string }   // THE tombstone rule
  | { action: 'skipped_duplicate'; existingId: string }
  | { action: 'rejected'; error: string };

export interface ImportRowResult {
  index: number;
  action: ImportRowAction['action'];
  error?: string;
  existingId?: string;
  contact?: NormalizedContact;
}

/**
 * Plan an import batch against the client's existing contacts. Pure:
 * - rows failing validation (incl. missing consent attestation) → rejected;
 * - phone/email hitting an OPTED-OUT contact → skipped_opted_out (a re-import
 *   NEVER resurrects a tombstone);
 * - phone/email hitting a live contact → skipped_duplicate (no silent update);
 * - duplicates WITHIN the batch: first wins, rest skipped_duplicate.
 */
export function planImport(
  rows: RawContactInput[],
  existing: ExistingContactKey[],
  defaults: RawContactInput = {},
): ImportRowResult[] {
  const byPhone = new Map<string, ExistingContactKey>();
  const byEmail = new Map<string, ExistingContactKey>();
  for (const e of existing) {
    if (e.phone) byPhone.set(e.phone, e);
    if (e.email) byEmail.set(e.email.toLowerCase(), e);
  }
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();

  return rows.map((row, index): ImportRowResult => {
    const norm = normalizeContactInput(row, defaults);
    if (!norm.ok) return { index, action: 'rejected', error: norm.error };
    const c = norm.contact;

    const hit = (c.phone && byPhone.get(c.phone)) || (c.email && byEmail.get(c.email)) || null;
    if (hit) {
      if (hit.opted_out_at) return { index, action: 'skipped_opted_out', existingId: hit.id };
      return { index, action: 'skipped_duplicate', existingId: hit.id };
    }
    if ((c.phone && seenPhone.has(c.phone)) || (c.email && seenEmail.has(c.email))) {
      return { index, action: 'skipped_duplicate' };
    }
    if (c.phone) seenPhone.add(c.phone);
    if (c.email) seenEmail.add(c.email);
    return { index, action: 'insert', contact: c };
  });
}
