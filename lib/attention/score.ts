// lib/attention/score.ts
//
// C-06 attention scheduler — the PURE scoring core (§8.2.2).
//
// Every component function maps its slice of ClientAttentionState to a value
// in [0..1] plus a plain-language reason. Normalization contract:
//
//   • Bounded inputs use bounded shapes (a Gaussian bump, exponential decay),
//     which land in [0..1] by construction.
//   • Unbounded raw inputs (sums over many anomalies / hypotheses) SATURATE
//     via 1 − exp(−raw/k): monotone, 0 at 0, asymptotically 1, never above 1.
//   • Every numeric input is sanitized first (NaN/±Infinity → 0, negatives
//     clamped where a negative is meaningless), so all functions here are
//     TOTAL: no input state can produce NaN or Infinity.
//
// scoreAttention is then a weighted sum of the five normalized components with
// weights that sum to 1.0, so the final score is also in [0..1] and components
// are comparable to each other before weighting. Deterministic by design: no
// clocks, no randomness, no I/O — same state, same score.

import type {
  AnomalyFlag,
  AttentionComponent,
  AttentionScore,
  AttentionWeights,
  CalendarProximity,
  ClientAttentionState,
  ErrorFlag,
  OpenHypothesisProgress,
  StalenessState,
} from './types';

// ── Tuning constants (exported so tests + heartbeat docs can cite them) ──────

/**
 * Component weights, sum = 1.00.
 *
 * Ordering rationale (this IS the priority policy, so it is written down):
 *   anomaly (0.35)   — an unhandled fresh anomaly is live money burning; it
 *                      must be able to outrank everything else.
 *   errors (0.25)    — a broken/expiring pipe starves every other signal; it
 *                      beats any single "opportunity" component.
 *   hypothesis (0.20) — an almost-resolved high-leverage hypothesis is the
 *                      cheapest information available (§8.2.2's headline case).
 *   staleness (0.12) — a client the brain hasn't touched is unknown risk.
 *   calendar (0.08)  — important but plannable; it rarely needs to win a tick
 *                      outright, it needs to tip close calls.
 */
export const DEFAULT_WEIGHTS: AttentionWeights = {
  anomaly:         0.35,
  errors:          0.25,
  hypothesisValue: 0.20,
  staleness:       0.12,
  calendar:        0.08,
};

/** Severity → base urgency for anomaly flags. */
export const ANOMALY_SEVERITY_BASE: Record<AnomalyFlag['severity'], number> = {
  low:  0.25,
  med:  0.60,
  high: 1.00,
};

/** Anomaly urgency decays by e every 24h — yesterday's spike is context, not fire. */
export const ANOMALY_DECAY_HOURS = 24;

/** Saturation constant for the anomaly sum: one fresh high flag ≈ 0.86. */
export const ANOMALY_SATURATION_K = 0.5;

/**
 * The peak-near-floor bump: hypothesis attention peaks at 85% of the sample
 * floor. σ = 0.15 puts the "hot zone" at ~0.7–0.95 progress: bump(0) ≈ 0,
 * bump(0.7) ≈ 0.61, bump(0.85) = 1, bump(0.95) ≈ 0.80, bump(1.2) ≈ 0.07.
 */
export const HYPOTHESIS_PEAK_PROGRESS = 0.85;
export const HYPOTHESIS_PEAK_SIGMA    = 0.15;

/** Saturation constant for the hypothesis-value sum. */
export const HYPOTHESIS_SATURATION_K = 2;

/** Staleness saturation: at 3× cadence the component reaches ~0.74. */
export const STALENESS_SATURATION_K = 1.5;

/** Fallback cadence when the provided cadence is missing/nonsensical. */
export const DEFAULT_CADENCE_DAYS = 7;

/** Calendar urgency ramps up over the last ~2 weeks before the decision point. */
export const CALENDAR_RAMP_DAYS = 14;

/**
 * After the decision point passes, urgency decays by e every 30 days: being
 * late is still actionable (act NOW), but the value of acting shrinks as the
 * remaining pre-window runway shrinks.
 */
export const CALENDAR_LATE_DECAY_DAYS = 30;

/** Error kind → fixed urgency. A dying token is a guaranteed future outage. */
export const ERROR_KIND_URGENCY: Record<ErrorFlag['kind'], number> = {
  meta_token_expiring: 1.00,
  connection_error:    0.85,
  other:               0, // 'other' falls back to severity (see scoreErrors)
};

export const ERROR_SEVERITY_URGENCY: Record<ErrorFlag['severity'], number> = {
  low:  0.30,
  med:  0.60,
  high: 0.90,
};

// ── Total-function helpers ────────────────────────────────────────────────────

/** NaN/±Infinity → 0. The scorer must survive any garbage a ledger can hold. */
const finiteOr0 = (x: number): number => (Number.isFinite(x) ? x : 0);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, finiteOr0(x)));

/** Saturate an unbounded non-negative sum into [0..1): 1 − exp(−x/k). */
const saturate = (raw: number, k: number): number =>
  1 - Math.exp(-Math.max(0, finiteOr0(raw)) / k);

const pct = (x: number): string => `${Math.round(x * 100)}%`;

const days1 = (d: number): string => `${Math.round(d * 10) / 10}d`;

// ── Component: anomalies ──────────────────────────────────────────────────────

/**
 * WHY: an unhandled anomaly means live spend is misbehaving RIGHT NOW — the
 * most expensive thing a marketer can ignore. High severity dominates (base
 * 1.0 vs 0.25) and urgency decays exponentially with age (e-fold per 24h):
 * a fresh high-severity flag saturates near the top of the scale and outranks
 * every slower-moving signal, while a stale flag fades into context.
 */
export function scoreAnomalies(flags: AnomalyFlag[]): AttentionComponent {
  if (flags.length === 0) return { value: 0, reason: 'no anomaly flags' };

  let sum = 0;
  let top: AnomalyFlag = flags[0];
  let topContribution = -1;
  for (const f of flags) {
    const age = Math.max(0, finiteOr0(f.ageHours));
    const contribution = ANOMALY_SEVERITY_BASE[f.severity] * Math.exp(-age / ANOMALY_DECAY_HOURS);
    sum += contribution;
    if (contribution > topContribution) {
      topContribution = contribution;
      top = f;
    }
  }

  const value = saturate(sum, ANOMALY_SATURATION_K);
  const reason =
    `${flags.length} unresolved anomaly flag${flags.length === 1 ? '' : 's'}; ` +
    `most urgent: ${top.severity} '${top.kind}' ${days1(Math.max(0, finiteOr0(top.ageHours)) / 24)} old`;
  return { value, reason };
}

// ── Component: open-hypothesis value ──────────────────────────────────────────

/**
 * The peak-near-floor shape. WHY a bump and not a ramp: at progress 0 the
 * hypothesis needs budget/time, not attention — attention can't speed it up.
 * NEAR the floor (~0.7–0.95) one more tick of attention is the cheapest
 * information in the whole system: the verdict is almost paid for and a claim
 * is about to move real atoms. PAST the floor (>1) the verdict is mechanically
 * due from the C-01 runner — attention adds nothing, so the bump falls off.
 */
export function hypothesisProgressBump(sampleProgress: number): number {
  const p = finiteOr0(sampleProgress);
  const z = (p - HYPOTHESIS_PEAK_PROGRESS) / HYPOTHESIS_PEAK_SIGMA;
  return Math.exp(-(z * z) / 2);
}

/**
 * WHY: this is §8.2.2's headline case — a tiny client about to resolve a
 * high-leverage hypothesis outranks a big quiet one. Each open hypothesis
 * contributes bump(progress) × decisionWeight (how many downstream decisions
 * the claim unblocks); the sum saturates so a client cannot buy rank by
 * hoarding open hypotheses.
 */
export function scoreHypothesisValue(open: OpenHypothesisProgress[]): AttentionComponent {
  if (open.length === 0) return { value: 0, reason: 'no open hypotheses' };

  let sum = 0;
  let top: OpenHypothesisProgress = open[0];
  let topContribution = -1;
  for (const h of open) {
    const contribution = hypothesisProgressBump(h.sampleProgress) * Math.max(0, finiteOr0(h.decisionWeight));
    sum += contribution;
    if (contribution > topContribution) {
      topContribution = contribution;
      top = h;
    }
  }

  const value = saturate(sum, HYPOTHESIS_SATURATION_K);
  const atoms = top.hypothesis.insight_ids.length;
  const reason =
    `${open.length} open hypothes${open.length === 1 ? 'is' : 'es'}; ` +
    `highest-value: '${top.hypothesis.domain}' at ${pct(clamp01(top.sampleProgress))} of floor, ` +
    `${atoms} atom${atoms === 1 ? '' : 's'} gated`;
  return { value, reason };
}

// ── Component: staleness ──────────────────────────────────────────────────────

/**
 * WHY: atoms decay in truth even when nothing writes to them — an untouched
 * client is accumulating unknown drift. Fresh (within cadence) scores 0;
 * past cadence the score grows and saturates.
 *
 * DESIGN CHOICE — null lastEvent means "never analyzed" and scores MAXIMAL
 * (1.0), above any merely-old client: a client the brain has never touched is
 * pure unknown — every belief we hold about them is unvalidated, which is
 * strictly worse than validated-but-aging knowledge.
 */
export function scoreStaleness(s: StalenessState): AttentionComponent {
  const cadence =
    Number.isFinite(s.cadenceDays) && s.cadenceDays > 0 ? s.cadenceDays : DEFAULT_CADENCE_DAYS;

  if (s.daysSinceLastAtomEvent === null) {
    return { value: 1, reason: 'never analyzed — no atom events on record' };
  }

  const daysSince = Math.max(0, finiteOr0(s.daysSinceLastAtomEvent));
  const ratio = daysSince / cadence;
  if (ratio <= 1) {
    return {
      value: 0,
      reason: `fresh: last atom event ${days1(daysSince)} ago, within ${cadence}d cadence`,
    };
  }

  const value = saturate(ratio - 1, STALENESS_SATURATION_K);
  return {
    value,
    reason: `stale: ${days1(daysSince)} since last atom event vs ${cadence}d cadence`,
  };
}

// ── Component: calendar proximity ─────────────────────────────────────────────

/**
 * WHY: seasonality windows are marketed at the DECISION window, not the event
 * window (israeli-market-timing §4-5 — decision_lag is "the field everyone
 * forgets"). Let d = daysUntilWindow − decisionLagDays (days until customers
 * start deciding):
 *
 *   d > 0  — the decision point is ahead; urgency ramps up as exp(−d/14),
 *            peaking at exactly d = 0 (the moment to act).
 *   d ≤ 0  — the decision point has PASSED; we are late but the window itself
 *            is still ahead, so this is "act immediately, value shrinking":
 *            exp(d/30) decays toward 0 as the remaining runway disappears.
 *            (An event 30 days out with a 45-day lag lands here: d = −15,
 *            still ~0.6 — urgent NOW, not "in 30 days".)
 *
 * Windows already fully in the past never reach this function — load.ts rolls
 * recurring (month-based) windows to their next occurrence and drops expired
 * one-shot windows. Each entry is weighted by the seasonality atom's
 * confidence; the component takes the MAX across windows (two nearby windows
 * demand one act of attention, not double).
 */
export function scoreCalendar(calendar: CalendarProximity[]): AttentionComponent {
  if (calendar.length === 0) return { value: 0, reason: 'no seasonality windows ahead' };

  let value = 0;
  let top: CalendarProximity = calendar[0];
  for (const c of calendar) {
    const d = finiteOr0(c.daysUntilWindow) - Math.max(0, finiteOr0(c.decisionLagDays));
    const shape = d >= 0 ? Math.exp(-d / CALENDAR_RAMP_DAYS) : Math.exp(d / CALENDAR_LATE_DECAY_DAYS);
    const weighted = shape * clamp01(c.relevanceConfidence);
    if (weighted > value) {
      value = weighted;
      top = c;
    }
  }

  const topD = finiteOr0(top.daysUntilWindow) - Math.max(0, finiteOr0(top.decisionLagDays));
  const reason =
    topD >= 0
      ? `'${top.windowLabel}' decision point in ${days1(topD)} (window in ${days1(finiteOr0(top.daysUntilWindow))}, ${days1(Math.max(0, finiteOr0(top.decisionLagDays)))} decision lag)`
      : `'${top.windowLabel}' decision point passed ${days1(-topD)} ago — window in ${days1(finiteOr0(top.daysUntilWindow))}, act immediately`;
  return { value: clamp01(value), reason };
}

// ── Component: error states ───────────────────────────────────────────────────

/**
 * WHY: a broken pipe starves everything else — no metrics, no verdicts, no
 * reflexes. An expiring Meta token is a GUARANTEED future outage, so it gets
 * maximal fixed urgency regardless of declared severity; connection errors are
 * nearly as urgent; 'other' defers to its severity. Max across flags (one
 * broken pipe is the problem; two broken pipes are the same problem).
 */
export function scoreErrors(errors: ErrorFlag[]): AttentionComponent {
  if (errors.length === 0) return { value: 0, reason: 'no error states' };

  let value = 0;
  let top: ErrorFlag = errors[0];
  for (const e of errors) {
    const urgency =
      e.kind === 'other' ? ERROR_SEVERITY_URGENCY[e.severity] : ERROR_KIND_URGENCY[e.kind];
    if (urgency > value) {
      value = urgency;
      top = e;
    }
  }

  const label =
    top.kind === 'meta_token_expiring'
      ? 'Meta token expiring — the data pipe is about to die'
      : top.kind === 'connection_error'
        ? 'connection error — metrics/publish pipe is down'
        : `error state (${top.severity})`;
  return { value: clamp01(value), reason: label };
}

// ── The composite score ───────────────────────────────────────────────────────

/**
 * Weighted sum of the five normalized components. Components are each in
 * [0..1] BEFORE weighting (see the normalization contract in the file header),
 * so weights express pure relative priority; with DEFAULT_WEIGHTS (sum 1.0)
 * the final score is also in [0..1]. Weights are sanitized (NaN/negative → 0)
 * so a bad override cannot produce a non-finite score.
 *
 * Deterministic: same state (+ weights) → same score, always.
 */
export function scoreAttention(
  state: ClientAttentionState,
  weights: AttentionWeights = DEFAULT_WEIGHTS,
): AttentionScore {
  const components = {
    anomaly:         scoreAnomalies(state.anomalyFlags),
    hypothesisValue: scoreHypothesisValue(state.openHypotheses),
    staleness:       scoreStaleness(state.staleness),
    calendar:        scoreCalendar(state.calendar),
    errors:          scoreErrors(state.errorStates),
  };

  const w = (x: number): number => Math.max(0, finiteOr0(x));
  const score =
    w(weights.anomaly)         * components.anomaly.value +
    w(weights.hypothesisValue) * components.hypothesisValue.value +
    w(weights.staleness)       * components.staleness.value +
    w(weights.calendar)        * components.calendar.value +
    w(weights.errors)          * components.errors.value;

  return { clientId: state.clientId, score: finiteOr0(score), components };
}

export interface RankClientsOpts {
  weights?: AttentionWeights;
  /**
   * When set, only the top K ranked clients keep their prose reasons; the rest
   * keep component VALUES but get '' reasons — heartbeat logs hundreds of
   * clients per tick and only the head of the queue needs the full story.
   */
  topKDetail?: number;
}

/**
 * Rank a fleet: AttentionScore[] sorted by score descending. Ties break by
 * clientId ascending — a fixed, data-independent order, so the ranking is
 * fully deterministic and two runs over the same fleet agree byte-for-byte.
 */
export function rankClients(
  states: ClientAttentionState[],
  opts: RankClientsOpts = {},
): AttentionScore[] {
  const scored = states.map((s) => scoreAttention(s, opts.weights ?? DEFAULT_WEIGHTS));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
  });

  if (opts.topKDetail !== undefined) {
    const k = Math.max(0, Math.floor(finiteOr0(opts.topKDetail)));
    return scored.map((s, i) =>
      i < k
        ? s
        : {
            ...s,
            components: {
              anomaly:         { value: s.components.anomaly.value,         reason: '' },
              hypothesisValue: { value: s.components.hypothesisValue.value, reason: '' },
              staleness:       { value: s.components.staleness.value,       reason: '' },
              calendar:        { value: s.components.calendar.value,        reason: '' },
              errors:          { value: s.components.errors.value,          reason: '' },
            },
          },
    );
  }
  return scored;
}
