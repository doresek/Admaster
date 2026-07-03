// lib/calibration/__tests__/core.test.ts
//
// Deep tests for the pure calibration math (C-03). Every expected number is
// computed BY HAND in the accompanying comment, so a regression is caught by
// arithmetic, not by a snapshot agreeing with itself.

import { describe, expect, it } from 'vitest';
import type { HypothesisDomain, HypothesisStatus } from '@/lib/capability-contracts';
import {
  binSamples,
  brier,
  buildAdjustmentTable,
  calibrationAdjust,
  DEFAULT_BIN_EDGES,
  poolAdjacentViolators,
  report,
  toSample,
  type CalibrationHypothesis,
} from '../core';
import type { AdjustmentBin, AdjustmentTable, CalibrationSample } from '../types';

const sample = (domain: HypothesisDomain, predicted: number, outcome: 0 | 1): CalibrationSample =>
  ({ domain, predicted, outcome });

/** n copies of the same sample. */
const times = (n: number, domain: HypothesisDomain, predicted: number, outcome: 0 | 1): CalibrationSample[] =>
  Array.from({ length: n }, () => sample(domain, predicted, outcome));

const hypothesis = (
  status: HypothesisStatus,
  prediction: CalibrationHypothesis['prediction'] = { confidence: 0.8 },
  domain: HypothesisDomain = 'angle',
): CalibrationHypothesis => ({ status, domain, prediction });

const okValue = (result: ReturnType<typeof brier>): number => {
  if (!result.ok) throw new Error(`expected ok result, got error: ${result.error}`);
  return result.value;
};

// ── brier ─────────────────────────────────────────────────────────────────────

describe('brier', () => {
  it('scores known values', () => {
    expect(okValue(brier(0.8, 1))).toBeCloseTo(0.04, 10);  // (0.8−1)² = 0.04
    expect(okValue(brier(0.8, 0))).toBeCloseTo(0.64, 10);  // (0.8−0)² = 0.64
    expect(okValue(brier(0.5, 1))).toBeCloseTo(0.25, 10);  // coin flip
    expect(okValue(brier(0.5, 0))).toBeCloseTo(0.25, 10);  // coin flip, either way
    expect(okValue(brier(1, 1))).toBe(0);                  // perfect
    expect(okValue(brier(0, 1))).toBe(1);                  // maximally wrong
  });

  it('rejects predicted outside [0,1] or non-finite with a typed error (never NaN)', () => {
    for (const bad of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = brier(bad, 1);
      expect(result.ok).toBe(false);
    }
  });
});

// ── toSample ──────────────────────────────────────────────────────────────────

describe('toSample', () => {
  it('maps every status per the exclusion semantics (table-driven)', () => {
    const cases: Array<{ status: HypothesisStatus; outcome: 0 | 1 | null; reason: string | null }> = [
      { status: 'supported',    outcome: 1,    reason: null },
      { status: 'refuted',      outcome: 0,    reason: null },
      { status: 'open',         outcome: null, reason: 'status_open' },
      { status: 'inconclusive', outcome: null, reason: 'status_inconclusive' },
      { status: 'killed',       outcome: null, reason: 'status_killed' },
      { status: 'superseded',   outcome: null, reason: 'status_superseded' },
    ];
    for (const c of cases) {
      const result = toSample(hypothesis(c.status));
      if (c.outcome === null) {
        expect(result.sample).toBeNull();
        expect(result.reason).toBe(c.reason);
      } else {
        expect(result.reason).toBeNull();
        expect(result.sample).toEqual({ domain: 'angle', predicted: 0.8, outcome: c.outcome });
      }
    }
  });

  it('carries the domain through', () => {
    const result = toSample(hypothesis('refuted', { confidence: 0.3 }, 'offer'));
    expect(result.sample).toEqual({ domain: 'offer', predicted: 0.3, outcome: 0 });
  });

  it('excludes a resolved hypothesis with missing confidence, with a reason', () => {
    const result = toSample(hypothesis('supported', {}));
    expect(result.sample).toBeNull();
    expect(result.reason).toBe('missing_confidence');
  });

  it('excludes non-finite or out-of-range confidence, with a reason', () => {
    for (const bad of [Number.NaN, -0.2, 1.5, Number.POSITIVE_INFINITY]) {
      const result = toSample(hypothesis('supported', { confidence: bad }));
      expect(result.sample).toBeNull();
      expect(result.reason).toBe('invalid_confidence');
    }
  });
});

// ── binSamples ────────────────────────────────────────────────────────────────

describe('binSamples', () => {
  it('returns all empty bins with stable shape for no samples', () => {
    const bins = binSamples([]);
    expect(bins).toHaveLength(5);
    bins.forEach((bin, i) => {
      expect(bin.lo).toBe(DEFAULT_BIN_EDGES[i]);
      expect(bin.hi).toBe(DEFAULT_BIN_EDGES[i + 1]);
      expect(bin.n).toBe(0);
      expect(bin.meanPredicted).toBeNull();
      expect(bin.observedRate).toBeNull();
    });
  });

  it('places boundary values in the lo-inclusive bin', () => {
    // Bins are [lo, hi): 0.2 exactly belongs to [0.2, 0.4), not [0, 0.2).
    const bins = binSamples([
      sample('angle', 0,    1),  // → [0, 0.2)
      sample('angle', 0.2,  1),  // → [0.2, 0.4)  (boundary)
      sample('angle', 0.39, 0),  // → [0.2, 0.4)
      sample('angle', 0.8,  1),  // → [0.8, 1.001) (boundary)
      sample('angle', 1.0,  0),  // → [0.8, 1.001) (1.0 exactly stays inside)
    ]);
    expect(bins.map((b) => b.n)).toEqual([1, 2, 0, 0, 2]);
  });

  it('computes per-bin meanPredicted and observedRate', () => {
    // Bin [0.4, 0.6): predictions 0.4, 0.6 is out; take 0.4, 0.5, 0.45 →
    // mean = (0.4+0.5+0.45)/3 = 0.45; outcomes 1,0,1 → rate 2/3.
    const bins = binSamples([
      sample('angle', 0.4,  1),
      sample('angle', 0.5,  0),
      sample('angle', 0.45, 1),
    ]);
    expect(bins[2].n).toBe(3);
    expect(bins[2].meanPredicted).toBeCloseTo(0.45, 10);
    expect(bins[2].observedRate).toBeCloseTo(2 / 3, 10);
  });

  it('silently excludes only invalid predicted values (NaN cannot be attributed to a bin)', () => {
    const bins = binSamples([sample('angle', Number.NaN, 1), sample('angle', 0.5, 1)]);
    expect(bins.reduce((acc, b) => acc + b.n, 0)).toBe(1);
  });

  it('rejects malformed edges (programmer error)', () => {
    expect(() => binSamples([], [0.5])).toThrow(/at least 2/);
    expect(() => binSamples([], [0, 0.5, 0.4])).toThrow(/ascending/);
    expect(() => binSamples([], [0, Number.NaN])).toThrow(/finite/);
  });
});

// ── report ────────────────────────────────────────────────────────────────────

describe('report', () => {
  // 20 hand-built samples across 3 domains. All expectations computed by hand:
  //
  // angle (8):    4×(0.9→1): brier 0.01 each  |  2×(0.9→0): 0.81  |  2×(0.7→1): 0.09
  //   meanBrier  = (4·0.01 + 2·0.81 + 2·0.09) / 8 = (0.04+1.62+0.18)/8 = 1.84/8 = 0.2300
  //   bins: [0.6,0.8): n=2, mean 0.7, rate 2/2 = 1  ·  [0.8,1.0]: n=6, mean 0.9, rate 4/6
  //
  // offer (7):    3×(0.5→1): 0.25  |  2×(0.5→0): 0.25  |  2×(0.3→0): 0.09
  //   meanBrier  = (5·0.25 + 2·0.09) / 7 = (1.25+0.18)/7 = 1.43/7 = 0.204285… ≈ 0.2043
  //   bins: [0.2,0.4): n=2, mean 0.3, rate 0  ·  [0.4,0.6): n=5, mean 0.5, rate 3/5 = 0.6
  //
  // audience (5): 3×(0.1→0): 0.01  |  1×(0.2→1): 0.64  |  1×(0.2→0): 0.04
  //   meanBrier  = (3·0.01 + 0.64 + 0.04) / 5 = 0.71/5 = 0.1420
  //   bins: [0,0.2): n=3, mean 0.1, rate 0  ·  [0.2,0.4): n=2, mean 0.2, rate 1/2
  //
  // overall (20): meanBrier = (1.84 + 1.43 + 0.71) / 20 = 3.98/20 = 0.1990
  //   bins: [0,0.2): n=3, rate 0
  //         [0.2,0.4): n=4 (2 offer@0.3 + 2 audience@0.2), mean (0.3+0.3+0.2+0.2)/4 = 0.25,
  //                    rate (0+0+1+0)/4 = 0.25
  //         [0.4,0.6): n=5, mean 0.5, rate 0.6
  //         [0.6,0.8): n=2, mean 0.7, rate 1
  //         [0.8,1.0]: n=6, mean 0.9, rate 4/6 ≈ 0.6667
  const samples: CalibrationSample[] = [
    ...times(4, 'angle', 0.9, 1), ...times(2, 'angle', 0.9, 0), ...times(2, 'angle', 0.7, 1),
    ...times(3, 'offer', 0.5, 1), ...times(2, 'offer', 0.5, 0), ...times(2, 'offer', 0.3, 0),
    ...times(3, 'audience', 0.1, 0), sample('audience', 0.2, 1), sample('audience', 0.2, 0),
  ];

  it('computes per-domain n and meanBrier to 4 decimals', () => {
    const r = report(samples);
    expect(r.overall.n).toBe(20);
    expect(r.overall.meanBrier).toBeCloseTo(0.199, 4);
    expect(r.byDomain.angle?.n).toBe(8);
    expect(r.byDomain.angle?.meanBrier).toBeCloseTo(0.23, 4);
    expect(r.byDomain.offer?.n).toBe(7);
    expect(r.byDomain.offer?.meanBrier).toBeCloseTo(0.2043, 4);
    expect(r.byDomain.audience?.n).toBe(5);
    expect(r.byDomain.audience?.meanBrier).toBeCloseTo(0.142, 4);
    expect(r.byDomain.creative).toBeUndefined(); // only domains present in the data
  });

  it('computes per-bin observedRate for every slice', () => {
    const r = report(samples);
    expect(r.overall.bins.map((b) => b.n)).toEqual([3, 4, 5, 2, 6]);
    expect(r.overall.bins[1].meanPredicted).toBeCloseTo(0.25, 10);
    expect(r.overall.bins[1].observedRate).toBeCloseTo(0.25, 10);
    expect(r.overall.bins[2].observedRate).toBeCloseTo(0.6, 10);
    expect(r.overall.bins[3].observedRate).toBeCloseTo(1, 10);
    expect(r.overall.bins[4].observedRate).toBeCloseTo(4 / 6, 10);

    expect(r.byDomain.angle?.bins[3].observedRate).toBeCloseTo(1, 10);
    expect(r.byDomain.angle?.bins[4].observedRate).toBeCloseTo(4 / 6, 10);
    expect(r.byDomain.offer?.bins[1].observedRate).toBeCloseTo(0, 10);
    expect(r.byDomain.offer?.bins[2].observedRate).toBeCloseTo(0.6, 10);
    expect(r.byDomain.audience?.bins[0].observedRate).toBeCloseTo(0, 10);
    expect(r.byDomain.audience?.bins[1].observedRate).toBeCloseTo(0.5, 10);
  });

  it('reports meanBrier null (never NaN) on zero samples, with stable bin shape', () => {
    const r = report([]);
    expect(r.overall.n).toBe(0);
    expect(r.overall.meanBrier).toBeNull();
    expect(r.overall.bins).toHaveLength(5);
    expect(r.byDomain).toEqual({});
  });
});

// ── PAV isotonic regression ───────────────────────────────────────────────────

describe('poolAdjacentViolators', () => {
  it('pools a non-monotone sequence to the exact PAV solution', () => {
    // [0.1, 0.5, 0.3, 0.9]: 0.5 > 0.3 violates → pool to (0.5+0.3)/2 = 0.4;
    // 0.1 ≤ 0.4 and 0.4 ≤ 0.9 hold, so pooling stops → [0.1, 0.4, 0.4, 0.9].
    expect(poolAdjacentViolators([0.1, 0.5, 0.3, 0.9], [1, 1, 1, 1]))
      .toEqual([0.1, 0.4, 0.4, 0.9]);
  });

  it('leaves an already-monotone sequence unchanged', () => {
    expect(poolAdjacentViolators([0.1, 0.4, 0.4, 0.9], [1, 1, 1, 1]))
      .toEqual([0.1, 0.4, 0.4, 0.9]);
    expect(poolAdjacentViolators([0.2, 0.2, 0.2], [3, 1, 2])).toEqual([0.2, 0.2, 0.2]);
  });

  it('pools with weights (weighted mean, not plain mean)', () => {
    // (0.6·30 + 0.2·10) / 40 = 20/40 = 0.5 for both positions.
    expect(poolAdjacentViolators([0.6, 0.2], [30, 10])).toEqual([0.5, 0.5]);
  });

  it('cascades merges backwards until monotone', () => {
    // [0.5, 0.4, 0.3]: 0.5>0.4 → 0.45; 0.45>0.3 → (0.45·2 + 0.3)/3 = 1.2/3 = 0.4.
    // (toBeCloseTo: the pooled weighted mean differs from the 0.4 literal by 1 ulp.)
    const pooled = poolAdjacentViolators([0.5, 0.4, 0.3], [1, 1, 1]);
    expect(pooled).toHaveLength(3);
    pooled.forEach((value) => expect(value).toBeCloseTo(0.4, 12));
  });

  it('rejects malformed input loudly', () => {
    expect(() => poolAdjacentViolators([0.1], [])).toThrow(/equal length/);
    expect(() => poolAdjacentViolators([0.1], [0])).toThrow(/> 0/);
    expect(() => poolAdjacentViolators([Number.NaN], [1])).toThrow(/finite/);
  });
});

// ── buildAdjustmentTable ──────────────────────────────────────────────────────

describe('buildAdjustmentTable', () => {
  it('sets adjusted = observedRate only when the bin holds >= minPerBin samples', () => {
    // angle: [0.2,0.4) gets 5 samples (rate 3/5 = 0.6) → trusted;
    //        [0.6,0.8) gets 4 samples → below the floor of 5 → null.
    const samples = [
      ...times(3, 'angle', 0.3, 1), ...times(2, 'angle', 0.3, 0),
      ...times(2, 'angle', 0.7, 1), ...times(2, 'angle', 0.7, 0),
    ];
    const table = buildAdjustmentTable(samples); // default minPerBin = 5
    const bins = table.byDomain.angle;
    expect(table.minPerBin).toBe(5);
    expect(bins?.map((b) => b.adjusted)).toEqual([null, 0.6, null, null, null]);
    expect(bins?.[3].n).toBe(4); // present, counted, just not trusted
  });

  it('respects a custom minPerBin', () => {
    const samples = [...times(2, 'offer', 0.5, 1), sample('offer', 0.5, 0)];
    const table = buildAdjustmentTable(samples, { minPerBin: 3 });
    expect(table.byDomain.offer?.[2].adjusted).toBeCloseTo(2 / 3, 10);
  });

  it('enforces monotone non-decreasing adjusted values via PAV', () => {
    // angle rates by bin: [0.2,0.4) → 3/5 = 0.6 and [0.4,0.6) → 2/5 = 0.4 —
    // an inversion (more confidence, worse hit rate). PAV with equal weights
    // (5, 5) pools them to (0.6+0.4)/2 = 0.5 each.
    const samples = [
      ...times(3, 'angle', 0.3, 1), ...times(2, 'angle', 0.3, 0),
      ...times(2, 'angle', 0.5, 1), ...times(3, 'angle', 0.5, 0),
    ];
    const bins = buildAdjustmentTable(samples).byDomain.angle;
    expect(bins?.map((b) => b.adjusted)).toEqual([null, 0.5, 0.5, null, null]);
  });

  it('builds the overall bins across all domains', () => {
    const samples = [...times(5, 'angle', 0.3, 1), ...times(5, 'offer', 0.3, 0)];
    const table = buildAdjustmentTable(samples);
    // Overall [0.2,0.4): 10 samples, 5 supported → 0.5.
    expect(table.overall[1].adjusted).toBeCloseTo(0.5, 10);
    // Each domain alone keeps its own rate.
    expect(table.byDomain.angle?.[1].adjusted).toBeCloseTo(1, 10);
    expect(table.byDomain.offer?.[1].adjusted).toBeCloseTo(0, 10);
  });

  it('rejects a nonsensical minPerBin', () => {
    expect(() => buildAdjustmentTable([], { minPerBin: 0 })).toThrow(/minPerBin/);
    expect(() => buildAdjustmentTable([], { minPerBin: Number.NaN })).toThrow(/minPerBin/);
  });
});

// ── calibrationAdjust ─────────────────────────────────────────────────────────

/** Hand-build adjustment bins over the default edges. */
const binsOf = (adjusted: ReadonlyArray<number | null>, n = 10): AdjustmentBin[] =>
  adjusted.map((value, i) => ({
    lo: DEFAULT_BIN_EDGES[i],
    hi: DEFAULT_BIN_EDGES[i + 1],
    n:  value === null ? 0 : n,
    adjusted: value,
  }));

const tableOf = (
  byDomain: AdjustmentTable['byDomain'],
  overall: AdjustmentBin[] = binsOf([null, null, null, null, null]),
): AdjustmentTable => ({ overall, byDomain, minPerBin: 5 });

const adjusted = (raw: number, domain: HypothesisDomain, table: AdjustmentTable): number => {
  const result = calibrationAdjust(raw, domain, table);
  if (!result.ok) throw new Error(`expected ok result, got error: ${result.error}`);
  return result.value;
};

describe('calibrationAdjust', () => {
  it('discounts an overconfident domain to ~its observed rate', () => {
    // The [0.8,1.0] bin observed only 55% hits; a raw 0.8 maps to 0.55
    // (single anchor → flat map).
    const table = tableOf({ angle: binsOf([null, null, null, null, 0.55]) });
    expect(adjusted(0.8, 'angle', table)).toBeCloseTo(0.55, 10);
    expect(adjusted(0.95, 'angle', table)).toBeCloseTo(0.55, 10);
  });

  it('interpolates linearly between neighboring bin midpoints', () => {
    // Anchors: [0.2,0.4) mid 0.3 → 0.25 and [0.4,0.6) mid 0.5 → 0.45.
    // raw 0.35: 0.25 + ((0.35−0.3)/(0.5−0.3))·(0.45−0.25) = 0.25 + 0.25·0.2 = 0.30.
    const table = tableOf({ angle: binsOf([null, 0.25, 0.45, null, null]) });
    expect(adjusted(0.35, 'angle', table)).toBeCloseTo(0.30, 10);
    // At an anchor midpoint the map returns the anchor value exactly.
    expect(adjusted(0.3, 'angle', table)).toBeCloseTo(0.25, 10);
    // Below the first anchor the map is flat (no extrapolation past evidence).
    expect(adjusted(0.21, 'angle', table)).toBeCloseTo(0.25, 10);
  });

  it('falls back to the overall table when the domain bin has no trusted value', () => {
    const overall = binsOf([null, null, null, null, 0.6]);
    // Domain has data elsewhere, but raw 0.9's bin is null → overall answers.
    const table = tableOf({ angle: binsOf([null, 0.3, null, null, null]) }, overall);
    expect(adjusted(0.9, 'angle', table)).toBeCloseTo(0.6, 10);
    // Domain entirely absent → overall answers too.
    expect(adjusted(0.9, 'offer', table)).toBeCloseTo(0.6, 10);
  });

  it('is the identity (mod clamping) on an empty table', () => {
    const empty: AdjustmentTable = { overall: [], byDomain: {}, minPerBin: 5 };
    expect(adjusted(0.5, 'angle', empty)).toBe(0.5);
    expect(adjusted(0.72, 'offer', empty)).toBeCloseTo(0.72, 10);
  });

  it('always clamps to [0.01, 0.99]', () => {
    const empty: AdjustmentTable = { overall: [], byDomain: {}, minPerBin: 5 };
    expect(adjusted(0.999, 'angle', empty)).toBe(0.99);
    expect(adjusted(0.0001, 'angle', empty)).toBe(0.01);
    // A bin that observed 0% or 100% still never emits absolute certainty.
    const table = tableOf({ angle: binsOf([0, null, null, null, 1]) });
    expect(adjusted(0.05, 'angle', table)).toBe(0.01);
    expect(adjusted(0.95, 'angle', table)).toBe(0.99);
  });

  it('is total over finite inputs: out-of-range raw is clamped, then mapped', () => {
    const empty: AdjustmentTable = { overall: [], byDomain: {}, minPerBin: 5 };
    expect(adjusted(1.7, 'angle', empty)).toBe(0.99);
    expect(adjusted(-3, 'angle', empty)).toBe(0.01);
  });

  it('returns a typed error result for non-finite raw', () => {
    const empty: AdjustmentTable = { overall: [], byDomain: {}, minPerBin: 5 };
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(calibrationAdjust(bad, 'angle', empty).ok).toBe(false);
    }
  });
});

// ── The NaN invariant ─────────────────────────────────────────────────────────

describe('NaN invariant — no public function can return NaN', () => {
  /** Recursively assert that no number anywhere in the value is NaN. */
  const assertNoNaN = (value: unknown): void => {
    if (typeof value === 'number') {
      expect(Number.isNaN(value)).toBe(false);
    } else if (Array.isArray(value)) {
      value.forEach(assertNoNaN);
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(assertNoNaN);
    }
  };

  // Deliberately hostile: NaN/Infinity/out-of-range predictions mixed with
  // real ones. Every public output must still be NaN-free.
  const hostileSamples: CalibrationSample[] = [
    sample('angle', Number.NaN, 1),
    sample('angle', Number.POSITIVE_INFINITY, 0),
    sample('angle', -5, 1),
    sample('angle', 2, 0),
    ...times(6, 'angle', 0.9, 1),
    ...times(6, 'offer', 0.1, 0),
  ];

  it('report / binSamples / buildAdjustmentTable are NaN-free under hostile input', () => {
    assertNoNaN(report(hostileSamples));
    assertNoNaN(binSamples(hostileSamples));
    assertNoNaN(buildAdjustmentTable(hostileSamples, { minPerBin: 1 }));
    assertNoNaN(report([]));
    assertNoNaN(buildAdjustmentTable([]));
  });

  it('brier and calibrationAdjust are NaN-free across their whole input space', () => {
    const table = buildAdjustmentTable(hostileSamples, { minPerBin: 1 });
    for (const raw of [-10, 0, 0.001, 0.5, 0.999, 1, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertNoNaN(calibrationAdjust(raw, 'angle', table));
      assertNoNaN(calibrationAdjust(raw, 'timing', table));
      assertNoNaN(brier(raw, 1));
      assertNoNaN(brier(raw, 0));
    }
  });
});
