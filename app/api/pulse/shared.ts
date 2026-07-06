// app/api/pulse/shared.ts
//
// Pure assembly helpers + payload types for the PULSE dashboard API (D-1,
// DASHBOARD-ARCHITECTURE §1). Everything here is deterministic data-in →
// data-out — no I/O, no clock — so the route's composition is provable by
// hand-math tests (same discipline as lib/metrics-layer).
//
// Mode doctrine (§1 viewer modes): the OWNER payload must never carry
// marketer-only metrics — filtering happens SERVER-SIDE (here), not in the
// client, so an owner-mode response physically cannot leak jargon keys.

import type { MetricKey, MetricPeriod, MetricValue } from '@/lib/metrics-layer';
import type { ClientStory } from '@/lib/narration';
import type { ShockState } from '@/lib/capability-contracts';

// ── payload vocabulary ────────────────────────────────────────────────────────

export type PulseMode = 'owner' | 'marketer';

export const PULSE_MODES: readonly PulseMode[] = ['owner', 'marketer'];

export const isPulseMode = (v: unknown): v is PulseMode =>
  PULSE_MODES.some((m) => m === v);

/** A diagnosis row slice the dashboard shows (rationale VERBATIM — leap 3). */
export interface PulseDiagnosis {
  id:          string;
  rationale:   string;
  failed_link: string | null;
}

/** One approval waiting for the user (the "ממתין לך" strip — leap 6). */
export interface PulsePendingItem {
  id:         string;
  title:      string | null;
  created_at: string;
}

/**
 * The "למה?" behind one metric (leap 3): a diagnosis verdict where one maps,
 * and/or the C-04 shock note ("שוק, לא אתה"). Both absent → the UI says
 * "אין אבחנה זמינה עדיין" — never an invented explanation.
 */
export interface PulseWhy {
  diagnosis: PulseDiagnosis | null;
  shock:     { note_he: string; direction: 'up' | 'down' | null } | null;
}

/** The one typed payload GET /api/pulse returns. */
export interface PulsePayload {
  mode:         PulseMode;
  period:       { start: string; end: string; days: number };
  story:        ClientStory;
  /** narrate() at the requested register — the full progressive-disclosure text. */
  narration_he: string;
  /** Mode-filtered MetricValue[] — honesty labels travel inside each value. */
  metrics:      MetricValue[];
  whys:         Partial<Record<MetricKey, PulseWhy>>;
  pending:      PulsePendingItem[];
  /** Non-null when the pending source could not be read — honest degradation. */
  pending_note: string | null;
  /** Top (most recent) diagnoses, capped at 2 — the "why" panel content. */
  diagnoses:    PulseDiagnosis[];
  /** Fleet-wide shock banner ("שוק, לא אתה"), or null when the market is calm. */
  shock_note:   string | null;
  warnings:     string[];
  generated_at: string;
}

// ── row narrowing (runtime proofs — .select() rows are claims, not types) ────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const stringOrNull   = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Keep only well-formed approvals rows; malformed rows are silently dropped
 *  from the COUNT (never from the DB) — a missing title is fine, a missing id
 *  is not a row we can link to. */
export function narrowPendingRows(rows: unknown): PulsePendingItem[] {
  if (!Array.isArray(rows)) return [];
  const out: PulsePendingItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row['id'];
    const title = row['title'] ?? null;
    const createdAt = row['created_at'];
    if (nonEmptyString(id) && stringOrNull(title) && nonEmptyString(createdAt)) {
      out.push({ id, title, created_at: createdAt });
    }
  }
  return out;
}

/** Keep only diagnoses rows with a real id + rationale (rationale is rendered
 *  VERBATIM — a row without one has nothing to say). */
export function narrowDiagnosisRows(rows: unknown): PulseDiagnosis[] {
  if (!Array.isArray(rows)) return [];
  const out: PulseDiagnosis[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row['id'];
    const rationale = row['rationale'];
    const failedLink = row['failed_link'] ?? null;
    if (nonEmptyString(id) && nonEmptyString(rationale) && stringOrNull(failedLink)) {
      out.push({ id, rationale, failed_link: failedLink });
    }
  }
  return out;
}

// ── period parsing (?period=7d|30d|90d, default 30d) ─────────────────────────

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const PULSE_PERIODS: readonly string[] = Object.keys(PERIOD_DAYS);

/** Parse the ?period= param; null/'' → the 30d default; unknown → null (400). */
export function parsePeriodParam(raw: string | null): number | null {
  if (raw === null || raw === '') return PERIOD_DAYS['30d'];
  return PERIOD_DAYS[raw] ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The inclusive YYYY-MM-DD period of `days` days ending on `now`'s UTC date.
 * `now` is a parameter (never Date.now() here) so tests pin the clock.
 */
export function periodEndingOn(days: number, now: Date): MetricPeriod {
  const end = now.toISOString().slice(0, 10);
  const startMs = Date.parse(`${end}T00:00:00.000Z`) - (days - 1) * DAY_MS;
  return { start: new Date(startMs).toISOString().slice(0, 10), end };
}

// ── mode filtering (§1: owner sees zero jargon) ───────────────────────────────

/**
 * Metrics the owner payload never carries — MUST mirror lib/narration's
 * OWNER_HIDDEN set (the engine hides the same keys from owner text; keeping
 * the two lists in agreement is asserted by tests).
 */
export const OWNER_HIDDEN_KEYS: readonly MetricKey[] = ['reconciliation_ratio'];

export function filterMetricsForMode(
  mode:    PulseMode,
  metrics: readonly MetricValue[],
): MetricValue[] {
  if (mode === 'marketer') return [...metrics];
  return metrics.filter((m) => !OWNER_HIDDEN_KEYS.some((k) => k === m.key));
}

// ── the "why" mapping (leap 3) ────────────────────────────────────────────────

/**
 * Which spine metrics a diagnosed failed link plausibly explains. This is the
 * DERIVABLE part of the mapping only — a weak hook/creative shows up as
 * expensive leads; a wrong avatar/audience as low relevance; a broken funnel
 * as missing volume; a weak offer as lost closes. 'none' maps nowhere.
 */
export const DIAGNOSIS_LINK_METRICS: Record<string, readonly MetricKey[]> = {
  hook:     ['cost_per_lead'],
  creative: ['cost_per_lead'],
  avatar:   ['qualified_rate', 'irrelevant_rate'],
  audience: ['qualified_rate', 'irrelevant_rate'],
  funnel:   ['leads_total'],
  offer:    ['close_rate'],
  none:     [],
};

/**
 * Which spine metrics a fleet-level shock (C-04, metrics cpm/ctr/cvr/spend)
 * colors: market spend/CPM moves what ads cost; market CTR/CVR moves how many
 * leads the same budget yields.
 */
export const FLEET_SHOCK_METRICS: Record<string, readonly MetricKey[]> = {
  spend: ['spend_total', 'cost_per_lead'],
  cpm:   ['spend_total', 'cost_per_lead'],
  ctr:   ['cost_per_lead'],
  cvr:   ['leads_total', 'cost_per_lead'],
};

/** Hebrew names for fleet metrics, used ONLY inside the shock note text. */
const FLEET_METRIC_HE: Record<string, string> = {
  cpm:   'עלות חשיפה בשוק',
  ctr:   'שיעור הקלקה בשוק',
  cvr:   'שיעור המרה בשוק',
  spend: 'הוצאות פרסום בשוק',
};

export interface FleetShockFact {
  metric: string;
  state:  ShockState;
}

/**
 * The "שוק, לא אתה" banner line: names the shocked fleet metrics and echoes
 * any recorded factor note VERBATIM. No numbers are minted here (the factor
 * value itself is deliberately not rendered — direction + note only).
 */
export function shockNoteHe(shocks: readonly FleetShockFact[]): string | null {
  const shocked = shocks.filter((s) => s.state.shocked);
  if (shocked.length === 0) return null;
  const names = shocked.map((s) => FLEET_METRIC_HE[s.metric] ?? s.metric).join(', ');
  const notes = shocked
    .map((s) => s.state.note)
    .filter((n): n is string => n !== null && n.length > 0);
  const suffix = notes.length > 0 ? ` (${notes.join('; ')})` : '';
  return `שוק, לא אתה: זוהתה תנודה כלל-שוקית היום — ${names}${suffix}. חלק מהשינוי הוא השוק, לא הקמפיינים שלך.`;
}

/**
 * Assemble the per-metric "למה?" map: for each metric PRESENT in the
 * (mode-filtered) list, attach the most recent diagnosis whose failed link
 * maps to it, and/or the shock note when a mapped fleet metric is shocked.
 * Diagnoses arrive newest-first; the first mapper wins per metric.
 */
export function buildWhys(
  metrics:   readonly MetricValue[],
  diagnoses: readonly PulseDiagnosis[],
  shocks:    readonly FleetShockFact[],
): Partial<Record<MetricKey, PulseWhy>> {
  const present = new Set<MetricKey>(metrics.map((m) => m.key));
  const whys: Partial<Record<MetricKey, PulseWhy>> = {};

  const ensure = (key: MetricKey): PulseWhy => {
    const existing = whys[key];
    if (existing !== undefined) return existing;
    const fresh: PulseWhy = { diagnosis: null, shock: null };
    whys[key] = fresh;
    return fresh;
  };

  for (const d of diagnoses) {
    const keys = d.failed_link !== null ? (DIAGNOSIS_LINK_METRICS[d.failed_link] ?? []) : [];
    for (const key of keys) {
      if (!present.has(key)) continue;
      const why = ensure(key);
      if (why.diagnosis === null) why.diagnosis = d;
    }
  }

  const note = shockNoteHe(shocks);
  if (note !== null) {
    for (const s of shocks) {
      if (!s.state.shocked) continue;
      for (const key of FLEET_SHOCK_METRICS[s.metric] ?? []) {
        if (!present.has(key)) continue;
        const why = ensure(key);
        if (why.shock === null) {
          why.shock = { note_he: note, direction: s.state.direction };
        }
      }
    }
  }

  return whys;
}
