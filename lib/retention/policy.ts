// lib/retention/policy.ts
//
// RetentionPolicy: the "don't nag" defaults + per-client override merge.
// Defaults live HERE in code; overrides come from `clients.retention_policy`
// (jsonb, migration 052) and are merged field-by-field after validation —
// garbage overrides are IGNORED (fail toward the stricter default), never thrown.
//
// ── OWNER-QUESTION DEFAULTS (owner authorized best-call; logged here) ─────────
// | Question               | Decision (default)                                  |
// |------------------------|-----------------------------------------------------|
// | Frequency caps         | 1 touch/contact/day · min 3 days between touches ·  |
// |                        | 2/week (rolling 7d) · 6/month (rolling 30d)          |
// | Client daily volume    | 200 sends/client/day (R8)                            |
// | Promo dedup (R4)       | same promo_key never twice within 90 days            |
// | Sending hours          | 09:00–20:30 Asia/Jerusalem, every day                |
// | Shabbat                | blocked Fri 15:00 → Sat 21:00 IL (computed weekly)   |
// | Yom-Tov                | blocked erev-chag 15:00 → 21:00 of last chag day,    |
// |                        | from IL_HOLIDAYS + in-module chag-days map           |
// | Email provider         | DEFERRED — ChannelAdapter seam + mock only           |
// | SMS provider           | InforU mock until creds (C2)                         |
// | Import format          | CSV with attested consent columns per row            |
// | Mode-2 granularity     | series ACTIVATION (one approval; daily batches ride  |
// |                        | the standing approval) — doc §5                      |
// ──────────────────────────────────────────────────────────────────────────────
//
// All time-of-day fields are MINUTES since midnight, Asia/Jerusalem wall clock.

export interface RetentionPolicy {
  /** R1 — sent touches per contact per IL calendar day. */
  dailyCapPerContact: number;
  /** R2 — min days between consecutive sent touches to a contact. */
  minGapDays: number;
  /** R3a — sent touches per contact per rolling 7 days. */
  weeklyCap: number;
  /** R3b — sent touches per contact per rolling 30 days. */
  monthlyCap: number;
  /** R4 — same promo_key never resent to a contact within this many days. */
  promoDedupDays: number;
  /** R8 — sent touches per CLIENT per IL calendar day (runaway guard). */
  clientDailySendCap: number;
  /** Sending window start, minutes since IL midnight (09:00). */
  sendWindowStartMin: number;
  /** Sending window end (exclusive), minutes since IL midnight (20:30). */
  sendWindowEndMin: number;
  /** Shabbat block start on Friday, minutes since IL midnight (15:00). */
  shabbatStartMin: number;
  /** Shabbat block end on Saturday (exclusive), minutes (21:00). */
  shabbatEndMin: number;
  /** Erev-chag block start, minutes since IL midnight (15:00). */
  erevChagStartMin: number;
  /** Chag block end on the last chag day (exclusive), minutes (21:00). */
  chagEndMin: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  dailyCapPerContact: 1,
  minGapDays: 3,
  weeklyCap: 2,
  monthlyCap: 6,
  promoDedupDays: 90,
  clientDailySendCap: 200,
  sendWindowStartMin: 9 * 60,           // 09:00
  sendWindowEndMin: 20 * 60 + 30,       // 20:30
  shabbatStartMin: 15 * 60,             // Fri 15:00
  shabbatEndMin: 21 * 60,               // Sat 21:00
  erevChagStartMin: 15 * 60,            // erev-chag 15:00
  chagEndMin: 21 * 60,                  // last chag day 21:00
};

/** jsonb override keys accepted from `clients.retention_policy` (snake_case). */
const NUMERIC_OVERRIDES: Record<string, keyof RetentionPolicy> = {
  daily_cap: 'dailyCapPerContact',
  min_gap_days: 'minGapDays',
  weekly_cap: 'weeklyCap',
  monthly_cap: 'monthlyCap',
  promo_dedup_days: 'promoDedupDays',
  client_daily_send_cap: 'clientDailySendCap',
};

const TIME_OVERRIDES: Record<string, keyof RetentionPolicy> = {
  send_window_start: 'sendWindowStartMin',
  send_window_end: 'sendWindowEndMin',
  shabbat_start: 'shabbatStartMin',
  shabbat_end: 'shabbatEndMin',
  erev_chag_start: 'erevChagStartMin',
  chag_end: 'chagEndMin',
};

/** Parse "HH:MM" → minutes since midnight; null on anything else. */
export function parseHHMM(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Merge `clients.retention_policy` (unknown jsonb) over the defaults.
 * TOTAL: any non-object, missing, or invalid field falls back to the default —
 * a broken override must never disable a cap.
 */
export function resolvePolicy(raw: unknown): RetentionPolicy {
  const policy: RetentionPolicy = { ...DEFAULT_RETENTION_POLICY };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return policy;
  const obj = raw as Record<string, unknown>;

  for (const [key, field] of Object.entries(NUMERIC_OVERRIDES)) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      policy[field] = Math.floor(v);
    }
  }
  for (const [key, field] of Object.entries(TIME_OVERRIDES)) {
    const v = obj[key];
    const minutes = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60
      ? v
      : parseHHMM(v);
    if (minutes !== null) policy[field] = minutes;
  }
  return policy;
}
