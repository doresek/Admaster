// app/api/portfolio — D-2 AGENCY PORTFOLIO (DASHBOARD-ARCHITECTURE §2).
//
// PURE assembly helpers shared by the route and its tests (and, type-only, by
// the page). Everything here is deterministic data-shaping over values other
// layers computed:
//   • lib/attention  — rankClients output IS the triage order (§2: "the C-06
//     attention scores ARE the sort order"); this module never re-sorts it.
//   • lib/metrics-layer — MetricValue[] per client; every number shown comes
//     from there (or is a SUM/COUNT of such numbers, computed here and tested).
//   • lib/narration  — the portfolio narration line; this module only ASSEMBLES
//     typed facts and hands them to narrate() (anti-hallucination inherited).
//
// ── TRIAGE LANES — the documented thresholds ─────────────────────────────────
// A client lands in a lane by the SEVERITY of its top attention components and
// the worst direction-adjusted metric move ("badness"):
//
//   🔴 urgent — any of:
//     • errors.value  ≥ 0.85 (LANE_ERROR_URGENT) — under ERROR_KIND_URGENCY a
//       real pipe failure (meta_token_expiring 1.0, connection_error 0.85) or
//       a high-severity 'other' flag (0.90) lands at/above this line: the data
//       pipe is dead or dying.
//     • anomaly.value ≥ 0.5 (LANE_ANOMALY_URGENT) — given ANOMALY_SEVERITY_BASE
//       + ANOMALY_SATURATION_K, one FRESH med anomaly scores ≈0.70 and one
//       fresh high ≈0.86, while a fresh low is ≈0.39; 0.5 therefore reads
//       "at least one fresh med+ anomaly" — live money misbehaving now.
//     • worstBadness ≥ 50 (LANE_BADNESS_URGENT) — some computed metric moved
//       ≥50% in the WRONG direction vs the previous period (e.g. leads halved,
//       or cost-per-lead up 50%).
//   🟡 watch — otherwise, any of:
//     • errors.value > 0 or anomaly.value > 0 — ANY open error/anomaly flag
//       deserves at least a look, even a stale or low one.
//     • worstBadness ≥ 20 (LANE_BADNESS_WATCH) — a ≥20% wrong-way move.
//     • score ≥ 0.30 (LANE_SCORE_WATCH) — the composite attention score says
//       "this client is buying attention" even without a single loud
//       component (e.g. a hot hypothesis + staleness together; note a
//       never-analyzed client alone is staleness 1.0 × weight 0.12 = 0.12 —
//       deliberately 🟢: new, not troubled).
//   🟢 ok — the rest.
//
// Clients whose metrics were NOT computed (per-client load failure, or beyond
// METRIC_CLIENT_CAP) are laned from attention components alone and marked
// `partial` — the UI shows 'נתונים חלקיים', never breaks.

import {
  DEFAULT_WEIGHTS,
  type AttentionComponents,
  type AttentionScore,
} from '@/lib/attention';
import {
  metricDef,
  type MetricPeriod,
  type MetricValue,
} from '@/lib/metrics-layer';
import { narrate, type NarrationInput } from '@/lib/narration';

// ── payload vocabulary ────────────────────────────────────────────────────────

export type Lane = 'urgent' | 'watch' | 'ok';

export type ComponentKey = keyof AttentionComponents;

/** The highest-contributing attention component, surfaced as the card's issue. */
export interface TopIssue {
  component: ComponentKey;
  /** Fixed Hebrew label for the component KIND — carries no numbers. */
  label_he:  string;
  /** The component's reason string VERBATIM (the C-06 audit-trail text). */
  reason:    string;
}

export interface HeadlineMetric {
  /** leads_total this period (null = not computable). */
  leads:     number | null;
  /** Percent change vs the previous period, as computed by the metrics layer. */
  delta_pct: number | null;
}

export interface ClientHealthSummary {
  clientId:        string;
  name:            string;
  attention_score: number;
  lane:            Lane;
  /** null when this client's metrics were not computed (partial). */
  headline_metric: HeadlineMetric | null;
  top_issue:       TopIssue | null;
  /** true → metrics missing/failed for this client; UI shows 'נתונים חלקיים'. */
  partial:         boolean;
}

export interface PortfolioAggregates {
  clients_total:   number;
  lane_counts:     Record<Lane, number>;
  /** Σ leads_total over clients with computed metrics; null when none. */
  leads_total:     number | null;
  leads_prev:      number | null;
  leads_delta_pct: number | null;
  /** Σ spend_total over clients with computed metrics; null when none. */
  spend_total:     number | null;
  /** The registry's honesty label for spend (planned budget until H4). */
  spend_honesty_label: string | null;
  /** How many clients actually got metrics computed. */
  computed_clients: number;
  /** true → the fleet exceeded METRIC_CLIENT_CAP; totals cover the top slice. */
  metrics_capped:  boolean;
}

export interface PortfolioNarration {
  /** The one-line portfolio story (lane counts + the most urgent client). */
  headline_he: string;
  /** Full deterministic narration of the aggregate facts (lib/narration). */
  text_he:     string;
  sources:     string[];
  warnings:    string[];
}

export interface PortfolioPayload {
  narration:  PortfolioNarration;
  /** Each lane preserves the attention-rank order (the triage order). */
  lanes:      Record<Lane, ClientHealthSummary[]>;
  aggregates: PortfolioAggregates;
  warnings:   string[];
}

// ── tunables (documented above; exported so tests cite them) ─────────────────

export const LANE_ERROR_URGENT   = 0.85;
export const LANE_ANOMALY_URGENT = 0.5;
export const LANE_BADNESS_URGENT = 50;
export const LANE_BADNESS_WATCH  = 20;
export const LANE_SCORE_WATCH    = 0.3;

/**
 * Per-client metric loading is 5 queries/client (loadMetricInputs) — a
 * documented N+1 over the fleet. The cap bounds the worst case at
 * 20 × 5 = 100 queries per portfolio render (plus the attention loader's 5
 * batched queries). A batched multi-client loader is a later optimization;
 * beyond the cap, clients are laned from attention alone and marked partial.
 */
export const METRIC_CLIENT_CAP = 20;

/** How many clients' metric loads run concurrently (5 chunks of ≤5 × 5 queries). */
export const METRIC_CONCURRENCY = 5;

// ── small deterministic math (mirrors the metrics layer's own rules) ─────────

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Same honesty rule as computeMetrics: no delta when prev is missing or 0. */
export function deltaPct(current: number | null, prev: number | null): number | null {
  if (current === null || prev === null || prev === 0) return null;
  return round1(((current - prev) / Math.abs(prev)) * 100);
}

/**
 * Direction-adjusted badness of one metric's period-over-period move:
 * positive = moved the WRONG way (up_good fell / down_good rose), in percent.
 * (Selection-only — this number is never rendered.)
 */
export function metricBadness(m: MetricValue): number {
  if (m.delta_pct === null) return 0;
  return m.direction === 'up_good' ? -m.delta_pct : m.delta_pct;
}

/** The worst wrong-way move across computed metrics (0 when none/unknown). */
export function worstBadness(metrics: readonly MetricValue[] | null): number {
  if (metrics === null) return 0;
  let worst = 0;
  for (const m of metrics) {
    const b = metricBadness(m);
    if (b > worst) worst = b;
  }
  return worst;
}

// ── lane derivation (thresholds documented in the file header) ───────────────

export function deriveLane(
  score:   AttentionScore,
  metrics: readonly MetricValue[] | null,
): Lane {
  const { errors, anomaly } = score.components;
  const badness = worstBadness(metrics);

  if (
    errors.value  >= LANE_ERROR_URGENT ||
    anomaly.value >= LANE_ANOMALY_URGENT ||
    badness       >= LANE_BADNESS_URGENT
  ) {
    return 'urgent';
  }
  if (
    errors.value  > 0 ||
    anomaly.value > 0 ||
    badness     >= LANE_BADNESS_WATCH ||
    score.score >= LANE_SCORE_WATCH
  ) {
    return 'watch';
  }
  return 'ok';
}

// ── top issue (the card's one-line "what's wrong") ───────────────────────────

/** Fixed Hebrew labels per component KIND — no numbers, so nothing to mint. */
export const COMPONENT_LABEL_HE: Record<ComponentKey, string> = {
  anomaly:         'חריגה פעילה בקמפיינים',
  errors:          'תקלה בצינור הנתונים',
  hypothesisValue: 'ניסוי מתקרב להכרעה',
  staleness:       'הידע על הלקוח לא רוענן',
  calendar:        'חלון עונתי מתקרב',
};

/**
 * Tie-break priority when two components contribute equally — fixed and
 * data-independent (mirrors the DEFAULT_WEIGHTS priority rationale).
 */
const COMPONENT_PRIORITY: readonly ComponentKey[] = [
  'anomaly', 'errors', 'hypothesisValue', 'staleness', 'calendar',
];

/**
 * The component contributing MOST to the score (value × DEFAULT_WEIGHTS —
 * the same arithmetic scoreAttention uses, so the "top issue" is exactly why
 * the client ranks where it does). All-zero components → null (no open issue).
 * The reason string is passed through VERBATIM.
 */
export function topIssue(score: AttentionScore): TopIssue | null {
  let best: ComponentKey | null = null;
  let bestContribution = 0;
  for (const key of COMPONENT_PRIORITY) {
    const contribution = score.components[key].value * DEFAULT_WEIGHTS[key];
    if (contribution > bestContribution) {
      bestContribution = contribution;
      best = key;
    }
  }
  if (best === null) return null;
  return {
    component: best,
    label_he:  COMPONENT_LABEL_HE[best],
    reason:    score.components[best].reason,
  };
}

// ── per-client summary assembly ───────────────────────────────────────────────

export function headlineMetric(metrics: readonly MetricValue[]): HeadlineMetric {
  const leads = metrics.find((m) => m.key === 'leads_total') ?? null;
  return {
    leads:     leads !== null ? leads.value : null,
    delta_pct: leads !== null ? leads.delta_pct : null,
  };
}

export interface BuildSummariesParams {
  /** rankClients output — already the triage order; NEVER re-sorted here. */
  ranked:          readonly AttentionScore[];
  /** ONLY the owner's clients (id → name). Ranked ids outside it are DROPPED. */
  names:           ReadonlyMap<string, string>;
  metricsByClient: ReadonlyMap<string, readonly MetricValue[]>;
}

/**
 * One summary per ranked client, in rank order. STRICT data boundary: a ranked
 * id with no entry in `names` (not this owner's client) never yields a summary.
 */
export function buildSummaries(params: BuildSummariesParams): ClientHealthSummary[] {
  const summaries: ClientHealthSummary[] = [];
  for (const score of params.ranked) {
    const name = params.names.get(score.clientId);
    if (name === undefined) continue; // not this owner's client — never shown
    const metrics = params.metricsByClient.get(score.clientId) ?? null;
    summaries.push({
      clientId:        score.clientId,
      name,
      attention_score: score.score,
      lane:            deriveLane(score, metrics),
      headline_metric: metrics !== null ? headlineMetric(metrics) : null,
      top_issue:       topIssue(score),
      partial:         metrics === null,
    });
  }
  return summaries;
}

// ── aggregates (pure sums over computed MetricValues — tested arithmetic) ────

export function buildAggregates(
  summaries:       readonly ClientHealthSummary[],
  metricsByClient: ReadonlyMap<string, readonly MetricValue[]>,
  metricsCapped:   boolean,
): PortfolioAggregates {
  const laneCounts: Record<Lane, number> = { urgent: 0, watch: 0, ok: 0 };
  for (const s of summaries) laneCounts[s.lane] += 1;

  let leadsSum:  number | null = null;
  let leadsPrev: number | null = null;
  let spendSum:  number | null = null;
  for (const s of summaries) {
    const metrics = metricsByClient.get(s.clientId);
    if (metrics === undefined) continue;
    const leads = metrics.find((m) => m.key === 'leads_total');
    if (leads !== undefined && isFiniteNumber(leads.value)) {
      leadsSum = (leadsSum ?? 0) + leads.value;
    }
    if (leads !== undefined && isFiniteNumber(leads.prev)) {
      leadsPrev = (leadsPrev ?? 0) + leads.prev;
    }
    const spend = metrics.find((m) => m.key === 'spend_total');
    if (spend !== undefined && isFiniteNumber(spend.value)) {
      spendSum = (spendSum ?? 0) + spend.value;
    }
  }

  return {
    clients_total:       summaries.length,
    lane_counts:         laneCounts,
    leads_total:         leadsSum,
    leads_prev:          leadsPrev,
    leads_delta_pct:     deltaPct(leadsSum, leadsPrev),
    spend_total:         spendSum,
    // Honesty from THE registry — the spend semantics stay labeled
    // planned-budget until the H4 flip, exactly as the metric itself is.
    spend_honesty_label: metricDef('spend_total')?.honesty_label ?? null,
    computed_clients:    [...metricsByClient.keys()]
      .filter((id) => summaries.some((s) => s.clientId === id)).length,
    metrics_capped:      metricsCapped,
  };
}

// ── portfolio narration (facts → narrate; numbers only from computed values) ─

/**
 * Portfolio-level MetricValue facts for narrate(): the aggregate sums dressed
 * in the registry's own identity (name/unit/direction/HONESTY LABEL), so the
 * narration engine renders them under the exact same honesty discipline as any
 * single-client number.
 */
export function portfolioMetricFacts(agg: PortfolioAggregates): MetricValue[] {
  const facts: MetricValue[] = [];

  const leadsDef = metricDef('leads_total');
  if (leadsDef !== null) {
    facts.push({
      key:                   leadsDef.key,
      name_he:               leadsDef.name_he,
      unit:                  leadsDef.unit,
      direction:             leadsDef.direction,
      honesty_label:         leadsDef.honesty_label,
      value:                 agg.leads_total,
      not_computable_reason: agg.leads_total === null ? 'אין נתוני לידים מחושבים בתקופה' : null,
      prev:                  agg.leads_prev,
      delta_pct:             agg.leads_delta_pct,
      vs_goal:               null,
      vs_benchmark:          null,
    });
  }

  const spendDef = metricDef('spend_total');
  if (spendDef !== null) {
    facts.push({
      key:                   spendDef.key,
      name_he:               spendDef.name_he,
      unit:                  spendDef.unit,
      direction:             spendDef.direction,
      honesty_label:         spendDef.honesty_label, // planned-budget label, until H4
      value:                 agg.spend_total,
      not_computable_reason: agg.spend_total === null ? 'אין נתוני השקעה מחושבים בתקופה' : null,
      prev:                  null, // prev-period spend is honestly unknown pre-H4
      delta_pct:             null,
      vs_goal:               null,
      vs_benchmark:          null,
    });
  }

  return facts;
}

/**
 * The one-line portfolio story. Every number is a COUNT computed here from the
 * summaries (tested aggregate math); the "most urgent" clause names the top
 * urgent client and its fixed component label — no free numbers.
 */
export function portfolioHeadline(
  agg:       PortfolioAggregates,
  topUrgent: ClientHealthSummary | null,
): string {
  if (agg.clients_total === 0) return 'אין עדיין לקוחות בתיק.';
  const who = agg.clients_total === 1 ? 'לקוח אחד' : `${String(agg.clients_total)} לקוחות`;
  const lanes =
    `דחוף: ${String(agg.lane_counts.urgent)} · ` +
    `לתשומת לב: ${String(agg.lane_counts.watch)} · ` +
    `תקין: ${String(agg.lane_counts.ok)}`;
  let line = `${who} — ${lanes}.`;
  if (topUrgent !== null && topUrgent.top_issue !== null) {
    line += ` הכי דחוף: ${topUrgent.name} — ${topUrgent.top_issue.label_he}.`;
  }
  return line;
}

// ── the full payload ──────────────────────────────────────────────────────────

export interface BuildPortfolioParams extends BuildSummariesParams {
  period:        MetricPeriod;
  metricsCapped: boolean;
  warnings:      string[];
}

export function buildPortfolioPayload(params: BuildPortfolioParams): PortfolioPayload {
  const summaries  = buildSummaries(params);
  const aggregates = buildAggregates(summaries, params.metricsByClient, params.metricsCapped);

  // Lanes preserve rank order (summaries are already in rank order).
  const lanes: Record<Lane, ClientHealthSummary[]> = { urgent: [], watch: [], ok: [] };
  for (const s of summaries) lanes[s.lane].push(s);

  const narrationInput: NarrationInput = {
    period:         params.period,
    metrics:        portfolioMetricFacts(aggregates),
    diagnoses:      [],
    atoms:          [],
    pendingActions: [],
  };
  const narrated = narrate(narrationInput, 'marketer');

  return {
    narration: {
      headline_he: portfolioHeadline(aggregates, lanes.urgent[0] ?? null),
      text_he:     narrated.text_he,
      sources:     narrated.sources,
      warnings:    narrated.warnings,
    },
    lanes,
    aggregates,
    warnings: params.warnings,
  };
}

// ── period (UTC-anchored; the route's only clock use passes through here) ────

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 7-day inclusive window ending on `now`'s UTC date. */
export function currentWeekPeriod(now: Date): MetricPeriod {
  const end = now.toISOString().slice(0, 10);
  const startMs = Date.parse(`${end}T00:00:00.000Z`) - 6 * DAY_MS;
  return { start: new Date(startMs).toISOString().slice(0, 10), end };
}
