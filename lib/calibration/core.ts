// lib/calibration/core.ts
//
// PURE calibration math for C-03 — zero I/O, fully deterministic, total.
// (Spec: MARKETING-CAPABILITIES-SPEC §C-03; VISION-DEEP §8.2.6.)
//
// Invariant this module defends: NO public function ever returns NaN. Garbage
// numeric input either yields a typed error result (brier, calibrationAdjust)
// or is excluded from aggregation with the exclusion made explicit in the
// types (toSample) — because a NaN that leaks into confidence math would
// silently poison every decision weight downstream.

import type { HypothesisDomain, HypothesisStatus } from '@/lib/capability-contracts';
import type {
  AdjustmentBin,
  AdjustmentTable,
  CalibrationBin,
  CalibrationReport,
  CalibrationResult,
  CalibrationSample,
  CalibrationSlice,
  ToSampleResult,
} from './types';

/**
 * Default reliability-bin edges. Bins are [lo, hi) — lo-inclusive — and the
 * final edge is 1.001 so a prediction of exactly 1.0 lands inside the last
 * bin instead of falling off the end.
 */
export const DEFAULT_BIN_EDGES: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8, 1.001];

/** Output confidences are clamped away from the hard 0/1 poles (see below). */
export const ADJUST_MIN = 0.01;
export const ADJUST_MAX = 0.99;

/** A probability usable in calibration math: finite and inside [0, 1]. */
const isValidProbability = (p: number): boolean =>
  Number.isFinite(p) && p >= 0 && p <= 1;

// ── Brier score ───────────────────────────────────────────────────────────────

/**
 * Brier score of one prediction: (predicted − outcome)².
 *
 * The Brier score is a strictly proper scoring rule — the expected score is
 * uniquely minimized by reporting one's true belief, so the system cannot game
 * its own calibration by hedging. Lower is better; 0.25 is the score of a
 * coin-flip (0.5) prediction.
 *
 * Guard: a predicted value outside [0, 1] or non-finite yields a typed error
 * result — never NaN, never a nonsense score.
 */
export function brier(predicted: number, outcome: 0 | 1): CalibrationResult<number> {
  if (!isValidProbability(predicted)) {
    return { ok: false, error: `brier: predicted must be a finite number in [0,1], got ${predicted}` };
  }
  return { ok: true, value: (predicted - outcome) ** 2 };
}

// ── Hypothesis → sample ───────────────────────────────────────────────────────

/**
 * The slice of a hypothesis row that calibration actually reads. Structural
 * subset of HypothesisRow (any real row is assignable), which also lets tests
 * exercise malformed jsonb (e.g. a prediction missing `confidence`) without
 * type casts.
 */
export interface CalibrationHypothesis {
  status:     HypothesisStatus;
  domain:     HypothesisDomain;
  prediction: { confidence?: number };
}

/**
 * Map a hypothesis to a calibration sample — or explain why it contributes
 * none.
 *
 * Only `supported` (outcome 1) and `refuted` (outcome 0) hypotheses are
 * scored. Everything else is EXCLUDED by design:
 *
 *  • `open` / `superseded` — no verdict exists; an unresolved claim says
 *    nothing about the quality of the judgment that registered it.
 *  • `inconclusive` — floors were unmet, so the world never answered. Scoring
 *    a non-answer as "wrong" would punish honest confidence on tests that ran
 *    out of budget, teaching the system to under-report belief. A non-answer
 *    is not a wrong answer.
 *  • `killed` — kill rules fire on spend/mercy conditions (creative-testing-
 *    discipline §4), not on whether the CLAIM was true. A mercy-killed arm
 *    might still have been directionally right; a kill is a budget verdict,
 *    not an epistemic one, so it must not move the calibration curve.
 *
 * A resolved hypothesis whose prediction carries no usable confidence is also
 * excluded (with a distinct reason) rather than defaulted — inventing a 0.5
 * would fabricate calibration evidence the registrant never asserted.
 */
export function toSample(hypothesis: CalibrationHypothesis): ToSampleResult {
  const { status } = hypothesis;
  if (status === 'open')         return { sample: null, reason: 'status_open' };
  if (status === 'inconclusive') return { sample: null, reason: 'status_inconclusive' };
  if (status === 'killed')       return { sample: null, reason: 'status_killed' };
  if (status === 'superseded')   return { sample: null, reason: 'status_superseded' };

  const confidence = hypothesis.prediction?.confidence;
  if (confidence === undefined || confidence === null) {
    return { sample: null, reason: 'missing_confidence' };
  }
  if (typeof confidence !== 'number' || !isValidProbability(confidence)) {
    return { sample: null, reason: 'invalid_confidence' };
  }

  return {
    sample: {
      domain:    hypothesis.domain,
      predicted: confidence,
      outcome:   status === 'supported' ? 1 : 0,
    },
    reason: null,
  };
}

// ── Binning ───────────────────────────────────────────────────────────────────

/**
 * Samples whose predicted value cannot participate in the math. toSample is
 * the sole producer of samples and already guarantees validity — this filter
 * is the belt-and-braces invariant that keeps NaN out even if a caller
 * hand-builds samples.
 */
const validSamples = (samples: readonly CalibrationSample[]): CalibrationSample[] =>
  samples.filter((s) => isValidProbability(s.predicted));

const assertValidEdges = (edges: readonly number[]): void => {
  if (edges.length < 2) throw new Error('binSamples: edges must contain at least 2 values');
  for (let i = 0; i < edges.length; i++) {
    if (!Number.isFinite(edges[i])) throw new Error('binSamples: edges must be finite numbers');
    if (i > 0 && edges[i] <= edges[i - 1]) throw new Error('binSamples: edges must be strictly ascending');
  }
};

/**
 * Bucket samples into fixed reliability bins ([lo, hi), lo-inclusive).
 *
 * Empty bins are PRESENT with n = 0 and null aggregates so every consumer
 * (report shape, adjustment builder, UI) sees a stable, index-aligned shape
 * regardless of where the data happened to fall.
 */
export function binSamples(
  samples: readonly CalibrationSample[],
  edges: readonly number[] = DEFAULT_BIN_EDGES,
): CalibrationBin[] {
  assertValidEdges(edges);

  const sums = edges.slice(0, -1).map(() => ({ n: 0, predictedSum: 0, outcomeSum: 0 }));
  for (const sample of validSamples(samples)) {
    // Linear scan is fine: 5 bins, and clarity beats a binary search here.
    for (let i = 0; i < sums.length; i++) {
      if (sample.predicted >= edges[i] && sample.predicted < edges[i + 1]) {
        sums[i].n += 1;
        sums[i].predictedSum += sample.predicted;
        sums[i].outcomeSum += sample.outcome;
        break;
      }
    }
  }

  return sums.map((s, i) => ({
    lo:            edges[i],
    hi:            edges[i + 1],
    n:             s.n,
    meanPredicted: s.n > 0 ? s.predictedSum / s.n : null,
    observedRate:  s.n > 0 ? s.outcomeSum / s.n : null,
  }));
}

// ── Report ────────────────────────────────────────────────────────────────────

const sliceOf = (samples: readonly CalibrationSample[]): CalibrationSlice => {
  let brierSum = 0;
  for (const s of samples) brierSum += (s.predicted - s.outcome) ** 2;
  return {
    n:         samples.length,
    meanBrier: samples.length > 0 ? brierSum / samples.length : null,
    bins:      binSamples(samples),
  };
};

/**
 * The calibration report: overall {n, meanBrier, bins} plus the same slice
 * per domain present in the data. This is the "does 0.8 mean 80%?" surface —
 * a bin whose meanPredicted sits far above its observedRate is the overconfidence
 * signal the adjustment table then corrects.
 *
 * n === 0 slices report meanBrier: null — never NaN.
 */
export function report(samples: readonly CalibrationSample[]): CalibrationReport {
  const valid = validSamples(samples);

  const byDomain: Partial<Record<HypothesisDomain, CalibrationSlice>> = {};
  for (const sample of valid) {
    if (byDomain[sample.domain] === undefined) {
      byDomain[sample.domain] = sliceOf(valid.filter((s) => s.domain === sample.domain));
    }
  }

  return { overall: sliceOf(valid), byDomain };
}

// ── Isotonic regression (PAV) ─────────────────────────────────────────────────

/**
 * Pool-Adjacent-Violators (PAV) isotonic regression.
 *
 * Returns the non-decreasing sequence closest (weighted least-squares) to
 * `values`. Algorithm: walk left→right keeping a stack of blocks, each holding
 * a weighted-mean value; whenever the newest block's mean drops below its
 * predecessor's, merge the two (weighted average) and keep merging backwards
 * until monotonicity is restored; finally expand each block back over the
 * positions it swallowed. This is the classical exact solution to the
 * L2 isotonic-regression problem.
 *
 * Why calibration needs it: bin-observed hit rates are noisy at small n, and
 * a noisy middle bin (say observed [0.1, 0.5, 0.3, 0.9]) would otherwise
 * produce an adjustment map where MORE stated confidence yields LESS trusted
 * confidence — an inversion no consumer should ever see. PAV pools exactly
 * the violating neighbours ([0.1, 0.4, 0.4, 0.9]) and touches nothing else.
 */
export function poolAdjacentViolators(
  values: readonly number[],
  weights: readonly number[],
): number[] {
  if (values.length !== weights.length) {
    throw new Error('poolAdjacentViolators: values and weights must have equal length');
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error('poolAdjacentViolators: values must be finite');
    if (!Number.isFinite(weights[i]) || weights[i] <= 0) {
      throw new Error('poolAdjacentViolators: weights must be finite and > 0');
    }
  }

  const blocks: Array<{ value: number; weight: number; count: number }> = [];
  for (let i = 0; i < values.length; i++) {
    blocks.push({ value: values[i], weight: weights[i], count: 1 });
    while (blocks.length >= 2 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const right = blocks.pop();
      const left = blocks.pop();
      if (left === undefined || right === undefined) break; // unreachable; satisfies narrowing
      blocks.push({
        value:  (left.value * left.weight + right.value * right.weight) / (left.weight + right.weight),
        weight: left.weight + right.weight,
        count:  left.count + right.count,
      });
    }
  }

  const pooled: number[] = [];
  for (const block of blocks) {
    for (let i = 0; i < block.count; i++) pooled.push(block.value);
  }
  return pooled;
}

// ── Adjustment table ──────────────────────────────────────────────────────────

export interface BuildAdjustmentOptions {
  /** Minimum samples a bin needs before its correction is trusted. */
  minPerBin?: number;
}

const adjustmentBinsOf = (samples: readonly CalibrationSample[], minPerBin: number): AdjustmentBin[] => {
  const bins = binSamples(samples);

  // Only bins with enough evidence participate; sparse bins stay null so
  // calibrationAdjust falls back instead of trusting noise.
  const eligible: Array<{ index: number; rate: number; n: number }> = [];
  for (let i = 0; i < bins.length; i++) {
    const { n, observedRate } = bins[i];
    if (n >= minPerBin && observedRate !== null) eligible.push({ index: i, rate: observedRate, n });
  }

  const pooled = poolAdjacentViolators(
    eligible.map((e) => e.rate),
    eligible.map((e) => e.n),
  );

  const adjusted: Array<number | null> = bins.map(() => null);
  eligible.forEach((e, k) => { adjusted[e.index] = pooled[k]; });

  return bins.map((bin, i) => ({ lo: bin.lo, hi: bin.hi, n: bin.n, adjusted: adjusted[i] }));
};

/**
 * Build the confidence→confidence correction table.
 *
 * Per domain (and overall), each bin's `adjusted` value is its observed hit
 * rate — but only when the bin holds ≥ minPerBin samples (default 5; below
 * that the observed rate is a rumor, not a rate) — with monotonicity across
 * bins enforced by PAV isotonic regression (see poolAdjacentViolators for why).
 */
export function buildAdjustmentTable(
  samples: readonly CalibrationSample[],
  options: BuildAdjustmentOptions = {},
): AdjustmentTable {
  const minPerBin = options.minPerBin ?? 5;
  if (!Number.isFinite(minPerBin) || minPerBin < 1) {
    throw new Error('buildAdjustmentTable: minPerBin must be a finite number >= 1');
  }
  const valid = validSamples(samples);

  const byDomain: Partial<Record<HypothesisDomain, AdjustmentBin[]>> = {};
  for (const sample of valid) {
    if (byDomain[sample.domain] === undefined) {
      byDomain[sample.domain] = adjustmentBinsOf(valid.filter((s) => s.domain === sample.domain), minPerBin);
    }
  }

  return { overall: adjustmentBinsOf(valid, minPerBin), byDomain, minPerBin };
}

// ── Applying the correction ───────────────────────────────────────────────────

const clampAdjusted = (value: number): number =>
  Math.max(ADJUST_MIN, Math.min(ADJUST_MAX, value));

/**
 * Piecewise-linear lookup over one bin list, or null when this list cannot
 * answer (raw's bin has no trusted correction, or no bin has one).
 *
 * Anchors sit at bin MIDPOINTS: a bin's observed rate summarizes predictions
 * around its center, so anchoring there (rather than at edges) avoids a step
 * function and gives a continuous map. Between anchors we interpolate
 * linearly; beyond the first/last anchor the map is flat (extrapolating a
 * calibration slope past the evidence would fabricate corrections).
 */
const lookupAdjusted = (bins: readonly AdjustmentBin[], raw: number): number | null => {
  const own = bins.find((b) => raw >= b.lo && raw < b.hi) ?? bins[bins.length - 1];
  if (own === undefined || own.adjusted === null) return null;

  const anchors: Array<{ x: number; y: number }> = [];
  for (const bin of bins) {
    if (bin.adjusted !== null) {
      // Cap hi at 1 so the top bin's synthetic 1.001 edge doesn't skew its midpoint.
      anchors.push({ x: (bin.lo + Math.min(bin.hi, 1)) / 2, y: bin.adjusted });
    }
  }

  if (raw <= anchors[0].x) return anchors[0].y;
  const last = anchors[anchors.length - 1];
  if (raw >= last.x) return last.y;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (raw >= a.x && raw <= b.x) {
      return a.y + ((raw - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return null; // unreachable: raw is inside [first.x, last.x]
};

/**
 * Correct a raw confidence using the published table: "the system says 0.8 in
 * this domain — given its track record, what does 0.8 actually mean?"
 *
 * Resolution order (spec §C-03):
 *  1. the domain's own bins — when raw's bin has a trusted (≥ minPerBin,
 *     isotonic) correction, interpolate between neighbouring anchors;
 *  2. otherwise the OVERALL bins (cross-domain evidence beats no evidence);
 *  3. otherwise return raw unchanged (an empty table must be an identity —
 *     the capability ships dormant until C-01 produces data).
 *
 * Total: any finite raw produces a sane output, always clamped to
 * [0.01, 0.99] — calibration must never emit absolute certainty, because a
 * 0/1 confidence would be unfalsifiable-by-update downstream. Non-finite raw
 * yields a typed error result.
 */
export function calibrationAdjust(
  raw: number,
  domain: HypothesisDomain,
  table: AdjustmentTable,
): CalibrationResult<number> {
  if (!Number.isFinite(raw)) {
    return { ok: false, error: `calibrationAdjust: raw confidence must be finite, got ${raw}` };
  }
  const x = Math.max(0, Math.min(1, raw));

  const domainBins = table.byDomain[domain];
  const fromDomain = domainBins !== undefined && domainBins.length > 0 ? lookupAdjusted(domainBins, x) : null;
  const fromOverall = fromDomain === null && table.overall.length > 0 ? lookupAdjusted(table.overall, x) : null;

  const value = fromDomain ?? fromOverall ?? x;
  return { ok: true, value: clampAdjusted(value) };
}
