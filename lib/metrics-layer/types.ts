// lib/metrics-layer/types.ts
//
// Shared vocabulary for the METRICS LAYER — dashboard foundation D-0
// (DASHBOARD-ARCHITECTURE §0.1): "every number is defined once (Hebrew name,
// formula, grain, target) in a semantic metrics layer; all narration/Q&A/
// alerts ground in it. THE single source of truth."
//
// Design commitments encoded in these types:
//   • A metric formula is a PURE function over typed slices of measurement-
//     spine rows — no I/O, no clock, no locale. Reviewable, testable data.
//   • TOTALITY: a metric that cannot be computed returns null WITH a Hebrew
//     reason — never NaN, never a guess (§0's honesty doctrine: labeled
//     numbers beat confident fabrications).
//   • COMPARISONS ARE NEVER NAKED (§0.3 leap 4): every MetricValue carries
//     prev-period, optional goal and optional benchmark alongside the value.

import type {
  ChannelReconciliationRow,
  ClientEconomicsRow,
  FunnelLeadRow,
  LeadStageEventRow,
} from '@/lib/capability-contracts';

// ── metric identity ───────────────────────────────────────────────────────────

export type MetricUnit      = 'count' | 'ils' | 'pct' | 'ratio';
export type MetricGrain     = 'day' | 'week' | 'month';
export type MetricDirection = 'up_good' | 'down_good';

/** The launch registry keys — the honest ≤12 computable from the spine today. */
export type MetricKey =
  | 'leads_total'
  | 'leads_qualified'
  | 'qualified_rate'
  | 'irrelevant_rate'
  | 'close_rate'
  | 'closed_value'
  | 'contacted_24h_rate'
  | 'consent_rate'
  | 'spend_total'
  | 'cost_per_lead'
  | 'roas_vs_breakeven'
  | 'reconciliation_ratio';

// ── inputs ────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD, both ends inclusive (digest convention). */
export interface MetricPeriod {
  start: string;
  end:   string;
}

/**
 * The slice of a campaigns row the spend formulas read. Until the H4 flip
 * lands live platform spend, the only spend signal we have is the PLANNED
 * daily budget of live, non-dry-run campaigns — every consumer of it carries
 * an honesty label saying exactly that (§0's "honesty is the differentiator").
 */
export interface MetricCampaignRow {
  id:           string;
  status:       string;
  channel:      string;
  daily_budget: number | null;
  dry_run:      boolean;
  created_at:   string;
}

/** One period's worth of spine rows — what a formula sees. */
export interface PeriodSlice {
  period:         MetricPeriod;
  leads:          FunnelLeadRow[];
  stageEvents:    LeadStageEventRow[];
  reconciliation: ChannelReconciliationRow[];
  campaigns:      MetricCampaignRow[];
}

/** Cross-period facts a formula may need beyond its slice. */
export interface FormulaContext {
  economics:  ClientEconomicsRow | null;
  /** Inclusive day count of the slice's period; 0 = period unparseable. */
  periodDays: number;
}

/**
 * The one typed bundle loaders assemble once and computeMetrics consumes.
 * `previous` powers the prev-period comparison (leap 4); economics is
 * point-in-time (a single row per client), shared by both periods.
 */
export interface MetricInputs {
  current:   PeriodSlice;
  previous:  PeriodSlice;
  economics: ClientEconomicsRow | null;
}

// ── definitions ───────────────────────────────────────────────────────────────

/** A formula's outcome: a finite number, or null WITH a Hebrew reason. */
export interface MetricResult {
  value:  number | null;
  reason: string | null;
}

/**
 * One registry entry — pure data + a pure function. `benchmark` is a static,
 * source-cited prior (fleet benchmarks arrive at ≥10 clients, C-12); `null`
 * means "no honest benchmark exists yet" and the UI must not invent one.
 */
export interface MetricDef {
  key:            MetricKey;
  name_he:        string;
  description_he: string;
  unit:           MetricUnit;
  grain:          MetricGrain;
  direction:      MetricDirection;
  /** e.g. 'מבוסס קליקים' for attribution-derived numbers; null = no caveat. */
  honesty_label:  string | null;
  /** Static honest prior, or null when none exists (never fabricated). */
  benchmark:      number | null;
  formula:        (slice: PeriodSlice, ctx: FormulaContext) => MetricResult;
}

// ── outputs ───────────────────────────────────────────────────────────────────

/** Per-client goal overrides (owner-set targets), keyed by metric. */
export type MetricGoalMap = Partial<Record<MetricKey, number>>;

export interface MetricComparison {
  target: number;
  /** Direction-aware: up_good → value ≥ target; down_good → value ≤ target. */
  met:    boolean;
}

/**
 * A computed metric — everything a tile / narration / alert needs, with the
 * comparison bases attached so no consumer ever renders a naked number.
 */
export interface MetricValue {
  key:                   MetricKey;
  name_he:               string;
  unit:                  MetricUnit;
  direction:             MetricDirection;
  honesty_label:         string | null;
  value:                 number | null;
  /** Hebrew reason when value is null — surfaced honestly, never hidden. */
  not_computable_reason: string | null;
  prev:                  number | null;
  /** Percent change vs prev (1 dp); null when either side is missing or prev=0. */
  delta_pct:             number | null;
  vs_goal:               MetricComparison | null;
  vs_benchmark:          MetricComparison | null;
}
