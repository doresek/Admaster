// app/(dashboard)/pulse/helpers.ts
//
// PURE client-side helpers for the pulse dashboard — no React, no I/O, no
// clock — so tile selection, formatting and the "why" lookup are provable by
// plain unit tests (the house bar).
//
// Formatting doctrine: every rendered digit comes from a payload value; these
// helpers dress numbers (₪ / % / פי / separators), they never compute new ones.

import type { MetricKey, MetricUnit, MetricValue } from '@/lib/metrics-layer';
import type { PulseMode, PulsePayload, PulseWhy } from '@/app/api/pulse/shared';

// ── payload shape guard (no blind casts of fetched JSON — the house bar) ─────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const stringOrNull = (v: unknown): boolean => v === null || typeof v === 'string';

/**
 * Shallow structural check of the /api/pulse payload — enough to prove the
 * body is our own contract (same-origin API in this repo) before the UI
 * consumes it. A type-guard, not a cast: a surprising body renders the error
 * state instead of crashing a tile.
 */
export function isPulsePayload(v: unknown): v is PulsePayload {
  if (!isRecord(v)) return false;
  return (v['mode'] === 'owner' || v['mode'] === 'marketer')
    && isRecord(v['period'])
    && isRecord(v['story'])
    && Array.isArray(v['metrics'])
    && isRecord(v['whys'])
    && Array.isArray(v['pending'])
    && Array.isArray(v['diagnoses'])
    && Array.isArray(v['warnings'])
    && stringOrNull(v['pending_note'])
    && stringOrNull(v['shock_note'])
    && typeof v['narration_he'] === 'string'
    && typeof v['generated_at'] === 'string';
}

// ── mode persistence (localStorage; §1: the toggle survives visits) ──────────

export const PULSE_MODE_STORAGE_KEY = 'pulse_mode';

export const isPulseModeValue = (v: unknown): v is PulseMode =>
  v === 'owner' || v === 'marketer';

/** Read the persisted mode; anything unreadable/unknown → the 'owner' default. */
export function readStoredMode(storage: Pick<Storage, 'getItem'> | null): PulseMode {
  if (storage === null) return 'owner';
  try {
    const raw = storage.getItem(PULSE_MODE_STORAGE_KEY);
    return isPulseModeValue(raw) ? raw : 'owner';
  } catch {
    // Storage access can throw (privacy modes) — the default is the answer.
    return 'owner';
  }
}

// ── owner tile selection (§1 wireframe: ≤4 tiles) ─────────────────────────────

/**
 * Owner tile priority: the wireframe's three (leads, cost-per-lead,
 * ROI-vs-breakeven) then the owner-visible business metrics. Computable
 * metrics outrank null ones (an owner opens the app to see numbers), order
 * within each group follows this list — deterministic by construction.
 */
export const OWNER_TILE_PRIORITY: readonly MetricKey[] = [
  'leads_total',
  'cost_per_lead',
  'roas_vs_breakeven',
  'closed_value',
  'leads_qualified',
  'qualified_rate',
  'contacted_24h_rate',
  'spend_total',
];

export const OWNER_TILE_CAP = 4;

export function selectOwnerTiles(metrics: readonly MetricValue[]): MetricValue[] {
  const byKey = new Map<MetricKey, MetricValue>(metrics.map((m) => [m.key, m]));
  const prioritized: MetricValue[] = [];
  for (const key of OWNER_TILE_PRIORITY) {
    const m = byKey.get(key);
    if (m !== undefined) prioritized.push(m);
  }
  const computable = prioritized.filter((m) => m.value !== null);
  const empty      = prioritized.filter((m) => m.value === null);
  return [...computable, ...empty].slice(0, OWNER_TILE_CAP);
}

// ── display formatting (Hebrew, ₪ / % / פי) ──────────────────────────────────

/** he-IL digit grouping for whole-number magnitudes; fractions stay verbatim. */
function groupHe(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('he-IL') : String(value);
}

export function formatMetricValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'ils':   return `₪${groupHe(value)}`;
    case 'pct':   return `${String(value)}%`;
    case 'ratio': return `פי ${String(value)}`;
    case 'count': return groupHe(value);
  }
}

// ── delta arrow (leap 4: never a naked number) ────────────────────────────────

export interface DeltaBadge {
  arrow: '↑' | '↓';
  /** The |delta| percentage text, digits from the payload only. */
  text:  string;
  /** Direction-aware: did the metric move the GOOD way? */
  good:  boolean;
}

export function deltaBadge(m: MetricValue): DeltaBadge | null {
  if (m.delta_pct === null || m.delta_pct === 0) return null;
  const up = m.delta_pct > 0;
  return {
    arrow: up ? '↑' : '↓',
    text:  `${String(Math.abs(m.delta_pct))}%`,
    good:  up === (m.direction === 'up_good'),
  };
}

/**
 * The tile's vs-goal / vs-benchmark line (wireframe: "מול יעד: 50",
 * "מול ענף: ₪27", "מעל איזון"). Goal wins over benchmark when both exist;
 * roas_vs_breakeven gets the break-even framing. Null when no comparison
 * exists — the tile then shows nothing rather than an invented baseline.
 */
export function comparisonLine(m: MetricValue): string | null {
  if (m.key === 'roas_vs_breakeven' && m.value !== null) {
    return m.value >= 1 ? 'מעל נקודת האיזון' : 'מתחת לנקודת האיזון';
  }
  if (m.vs_goal !== null) {
    return `מול יעד: ${formatMetricValue(m.vs_goal.target, m.unit)}${m.vs_goal.met ? ' ✓' : ''}`;
  }
  if (m.vs_benchmark !== null) {
    return `מול ענף: ${formatMetricValue(m.vs_benchmark.target, m.unit)}${m.vs_benchmark.met ? ' ✓' : ''}`;
  }
  return null;
}

// ── the "why" lookup (leap 3) ─────────────────────────────────────────────────

export function whyFor(
  key:  MetricKey,
  whys: PulsePayload['whys'],
): PulseWhy | null {
  return whys[key] ?? null;
}

export const NO_WHY_TEXT = 'אין אבחנה זמינה עדיין';

/** The popover body lines for one metric's "למה?" — payload text VERBATIM. */
export function whyLines(m: MetricValue, why: PulseWhy | null): string[] {
  const lines: string[] = [];
  if (m.value === null && m.not_computable_reason !== null) {
    lines.push(m.not_computable_reason);
  }
  if (why !== null && why.diagnosis !== null) lines.push(why.diagnosis.rationale);
  if (why !== null && why.shock !== null) lines.push(why.shock.note_he);
  if (lines.length === 0) lines.push(NO_WHY_TEXT);
  return lines;
}
