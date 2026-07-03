// compute.test.ts — the pure math of C-04, hand-verifiable end to end.

import { describe, expect, it } from 'vitest';
import {
  computeFactor,
  DEFAULT_DELTA_THRESHOLD,
  DEFAULT_DIRECTION_QUORUM,
  DEFAULT_MIN_SAMPLE,
  mad,
  median,
  relDeltas,
} from '../compute';
import type { ClientDayMetric, DailyDelta, FleetMetric } from '../types';

const day = (
  clientId: string,
  metric:   FleetMetric,
  value:    number,
  date = '2026-02-10',
): ClientDayMetric => ({ client_id: clientId, date, metric, value });

const delta = (clientId: string, rel: number, metric: FleetMetric = 'cpm'): DailyDelta =>
  ({ client_id: clientId, metric, rel_delta: rel });

// ── median / mad — exact, hand-computed ──────────────────────────────────────

describe('median', () => {
  it('odd length: median of [3,1,2] is 2', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('even length: median of [1,2,3,4] is the middle-pair mean 2.5', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('single element is its own median', () => {
    expect(median([7])).toBe(7);
  });

  it('handles negatives: median of [-4,-1,-9] is -4', () => {
    expect(median([-4, -1, -9])).toBe(-4);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  it('throws RangeError on empty input (no silent 0/NaN)', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('mad', () => {
  it('[1,2,3,4,9]: median 3, |devs| [2,1,0,1,6] → mad 1', () => {
    expect(mad([1, 2, 3, 4, 9])).toBe(1);
  });

  it('constant input has zero spread', () => {
    expect(mad([5, 5, 5])).toBe(0);
  });

  it('even length: [2,4,6,8]: median 5, |devs| [3,1,1,3] → mad 2', () => {
    expect(mad([2, 4, 6, 8])).toBe(2);
  });

  it('throws RangeError on empty input', () => {
    expect(() => mad([])).toThrow(RangeError);
  });
});

// ── relDeltas — totality guards ───────────────────────────────────────────────

describe('relDeltas', () => {
  it('computes (today − prev) / prev per client per metric', () => {
    const prev  = [day('c1', 'cpm', 100), day('c2', 'ctr', 0.02)];
    const today = [day('c1', 'cpm', 140), day('c2', 'ctr', 0.01)];
    const out = relDeltas(prev, today);
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.client_id === 'c1')?.rel_delta).toBeCloseTo(0.4, 12);
    expect(out.find((d) => d.client_id === 'c2')?.rel_delta).toBeCloseTo(-0.5, 12);
  });

  it('excludes a client whose prev value is 0 (never Infinity)', () => {
    expect(relDeltas([day('c1', 'cpm', 0)], [day('c1', 'cpm', 50)])).toEqual([]);
  });

  it('excludes a client missing the prev day', () => {
    expect(relDeltas([], [day('c1', 'cpm', 50)])).toEqual([]);
  });

  it('excludes a client missing the today value', () => {
    expect(relDeltas([day('c1', 'cpm', 50)], [])).toEqual([]);
  });

  it('pairs strictly per metric — a cpm yesterday never pairs a ctr today', () => {
    expect(relDeltas([day('c1', 'cpm', 100)], [day('c1', 'ctr', 0.02)])).toEqual([]);
  });

  it('GRID: no combination of pathological values ever yields non-finite output', () => {
    // Every pathological prev/today pairing either produces a finite delta or
    // no delta at all — the medians downstream never see Infinity/NaN.
    const pathological = [0, -5, NaN, Infinity, -Infinity, 100, 0.0001];
    for (const prevValue of pathological) {
      for (const todayValue of pathological) {
        const out = relDeltas(
          [day('c1', 'cpm', prevValue)],
          [day('c1', 'cpm', todayValue)],
        );
        for (const d of out) expect(Number.isFinite(d.rel_delta)).toBe(true);
      }
    }
  });

  it('duplicate (client, metric) today entries: first occurrence wins, one delta', () => {
    const out = relDeltas(
      [day('c1', 'cpm', 100)],
      [day('c1', 'cpm', 150), day('c1', 'cpm', 999)],
    );
    expect(out).toHaveLength(1);
    expect(out[0].rel_delta).toBeCloseTo(0.5, 12);
  });
});

// ── computeFactor — THE HEADLINE ─────────────────────────────────────────────

describe('computeFactor — shock detection', () => {
  it('HEADLINE: 10 of 12 clients CPM +~40% (war news cycle) → shocked, direction up', () => {
    // The scenario the module exists for: a market-level auction event moves
    // nearly the whole fleet the same way. Two counter-movers (clients mid
    // budget-change) must not veto the verdict — the median ignores them and
    // the 10/12 ≈ 0.83 quorum clears 0.6 easily.
    const deltas = [
      delta('c1', 0.35), delta('c2', 0.38), delta('c3', 0.40), delta('c4', 0.41),
      delta('c5', 0.42), delta('c6', 0.39), delta('c7', 0.44), delta('c8', 0.37),
      delta('c9', 0.45), delta('c10', 0.40),
      delta('c11', -0.05), delta('c12', -0.02),
    ];
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.shocked).toBe(true);
    expect(f.direction).toBe('up');
    expect(f.sample_n).toBe(12);
    expect(f.median_delta).toBeGreaterThanOrEqual(DEFAULT_DELTA_THRESHOLD);
    expect(f.note).toBeNull(); // February — no calendar window to soften it
  });

  it('CONTRAST: 6 up / 6 down at the same magnitude → median ~0 → NOT shocked', () => {
    // A split market is NOT a shock: half the fleet surging while half
    // collapses is client-level news (verticals diverging, individual
    // failures), not an exogenous event. The median lands at 0 and nothing
    // fires — this is exactly what protects atoms: were this a "shock",
    // twelve clients' honest diagnoses would be suppressed for no reason.
    // The mean would have been fooled into 0 too, but a trimmed mean or a
    // "count of big movers" detector would have fired — the median + quorum
    // pair rejects it twice over (no direction, no 60% agreement).
    const deltas = [
      delta('c1', 0.4), delta('c2', 0.4), delta('c3', 0.4),
      delta('c4', 0.4), delta('c5', 0.4), delta('c6', 0.4),
      delta('c7', -0.4), delta('c8', -0.4), delta('c9', -0.4),
      delta('c10', -0.4), delta('c11', -0.4), delta('c12', -0.4),
    ];
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.median_delta).toBe(0);
    expect(f.shocked).toBe(false);
    expect(f.direction).toBeNull();
  });

  it('one whale cannot fake a shock (median robustness)', () => {
    // 8 calm clients + 1 client 5×-ing overnight: mean delta would be ~0.55
    // ("shock!"), the median stays ~0.01 (calm). This is the whole reason for
    // median over mean.
    const deltas = [
      delta('c1', 0.01), delta('c2', -0.02), delta('c3', 0.03), delta('c4', 0.0),
      delta('c5', 0.02), delta('c6', -0.01), delta('c7', 0.01), delta('c8', 0.02),
      delta('whale', 5.0),
    ];
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.shocked).toBe(false);
  });
});

describe('computeFactor — the minSample activation gate', () => {
  it('7 clients all +40% → NOT shocked, note "insufficient fleet" (spec: live at ≥8)', () => {
    const deltas = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((c) => delta(c, 0.4));
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.shocked).toBe(false);
    expect(f.direction).toBeNull();
    expect(f.sample_n).toBe(7);
    expect(f.note).toContain('insufficient fleet');
    expect(f.note).toContain(`${DEFAULT_MIN_SAMPLE}`);
    // median/mad still reported for observability while dormant:
    expect(f.median_delta).toBeCloseTo(0.4, 12);
  });

  it('8 clients (exactly the gate) all +40% → shocked', () => {
    const deltas = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => delta(c, 0.4));
    expect(computeFactor('cpm', '2026-02-10', deltas).shocked).toBe(true);
  });

  it('zero deltas → sample_n 0, null median/mad, insufficient-fleet note', () => {
    const f = computeFactor('cvr', '2026-02-10', []);
    expect(f).toEqual({
      metric: 'cvr', median_delta: null, mad: null, sample_n: 0,
      shocked: false, direction: null,
      note: `insufficient fleet (0 clients < ${DEFAULT_MIN_SAMPLE} minimum)`,
    });
  });

  it('minSample is overridable (the activation parameter)', () => {
    const deltas = ['c1', 'c2', 'c3'].map((c) => delta(c, 0.4));
    expect(computeFactor('cpm', '2026-02-10', deltas, { minSample: 3 }).shocked).toBe(true);
  });
});

describe('computeFactor — threshold boundaries (inclusive)', () => {
  const eight = (rel: number): DailyDelta[] =>
    ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => delta(c, rel));

  it('median exactly 0.25 → shocked (≥, not >)', () => {
    const f = computeFactor('cpm', '2026-02-10', eight(0.25));
    expect(f.median_delta).toBe(DEFAULT_DELTA_THRESHOLD);
    expect(f.shocked).toBe(true);
  });

  it('median 0.249 → not shocked', () => {
    expect(computeFactor('cpm', '2026-02-10', eight(0.249)).shocked).toBe(false);
  });

  it('median exactly -0.25 → shocked, direction down', () => {
    const f = computeFactor('cpm', '2026-02-10', eight(-0.25));
    expect(f.shocked).toBe(true);
    expect(f.direction).toBe('down');
  });
});

describe('computeFactor — direction quorum boundaries', () => {
  it('quorum exactly 0.6 (6 of 10 up) → shocked', () => {
    // sorted: [-0.3 ×4, +0.3 ×6] → middle pair (5th,6th) both +0.3 → median 0.3;
    // 6/10 = 0.6 meets the quorum inclusively.
    const deltas = [
      delta('c1', 0.3), delta('c2', 0.3), delta('c3', 0.3),
      delta('c4', 0.3), delta('c5', 0.3), delta('c6', 0.3),
      delta('c7', -0.3), delta('c8', -0.3), delta('c9', -0.3), delta('c10', -0.3),
    ];
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.median_delta).toBeCloseTo(0.3, 12);
    expect(f.shocked).toBe(true);
    expect(f.direction).toBe('up');
    expect(6 / 10).toBe(DEFAULT_DIRECTION_QUORUM); // the boundary really is exact
  });

  it('quorum ~0.583 (7 of 12 up) → NOT shocked even with a big median', () => {
    // sorted: [-0.4 ×5, +0.4 ×7] → middle pair both +0.4 → median 0.4 clears
    // the magnitude bar, but 7/12 ≈ 0.583 < 0.6 → a split-ish market, no shock.
    const deltas = [
      delta('c1', 0.4), delta('c2', 0.4), delta('c3', 0.4), delta('c4', 0.4),
      delta('c5', 0.4), delta('c6', 0.4), delta('c7', 0.4),
      delta('c8', -0.4), delta('c9', -0.4), delta('c10', -0.4),
      delta('c11', -0.4), delta('c12', -0.4),
    ];
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.median_delta).toBeCloseTo(0.4, 12);
    expect(f.shocked).toBe(false);
  });

  it('zero-delta clients count AGAINST the quorum (unmoved ≠ moved up)', () => {
    // 6 clients at +0.4 and 5 exactly flat (n=11, odd): sorted
    // [0×5, 0.4×6] → median (6th element) = 0.4, which clears the magnitude
    // bar — but share(up) = 6/11 ≈ 0.545 < 0.6 because the five unmoved
    // clients do NOT share the median's sign. An event that leaves half the
    // fleet untouched is not market-wide; the quorum encodes that.
    const deltas = [
      delta('c1', 0.4), delta('c2', 0.4), delta('c3', 0.4),
      delta('c4', 0.4), delta('c5', 0.4), delta('c6', 0.4),
      delta('c7', 0), delta('c8', 0), delta('c9', 0), delta('c10', 0), delta('c11', 0),
    ];
    const f = computeFactor('cpm', '2026-02-10', deltas);
    expect(f.median_delta).toBeCloseTo(0.4, 12);
    expect(f.shocked).toBe(false);
  });

  it('deltas of other metrics are ignored', () => {
    const cpmShock = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => delta(c, 0.4));
    const ctrNoise = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) =>
      delta(c, -0.4, 'ctr'));
    const f = computeFactor('cpm', '2026-02-10', [...cpmShock, ...ctrNoise]);
    expect(f.sample_n).toBe(8);
    expect(f.shocked).toBe(true);
    expect(f.direction).toBe('up');
  });
});

// ── computeFactor — calendar overlay ─────────────────────────────────────────

describe('computeFactor — calendar overlay', () => {
  const eightUp = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => delta(c, 0.35));

  it('+35% CPM on Sep 20 → still shocked, note marks it expected (חגי תשרי)', () => {
    const f = computeFactor('cpm', '2026-09-20', eightUp);
    expect(f.shocked).toBe(true);           // the market genuinely moved — consumers still normalize
    expect(f.direction).toBe('up');
    expect(f.note).toContain('expected (חג)');
    expect(f.note).toContain('חגי תשרי');
  });

  it('the same shock in February → no calendar note (unexplained, full alarm)', () => {
    const f = computeFactor('cpm', '2026-02-10', eightUp);
    expect(f.shocked).toBe(true);
    expect(f.note).toBeNull();
  });

  it('a shock CONTRADICTING its window gets no note (CPM crash during tishrei)', () => {
    const eightDown = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => delta(c, -0.35));
    const f = computeFactor('cpm', '2026-09-20', eightDown);
    expect(f.shocked).toBe(true);
    expect(f.direction).toBe('down');
    expect(f.note).toBeNull();
  });

  it('CTR collapse during memorial days → expected (attention_down window)', () => {
    const eightCtrDown = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) =>
      delta(c, -0.35, 'ctr'));
    const f = computeFactor('ctr', '2026-04-25', eightCtrDown);
    expect(f.shocked).toBe(true);
    expect(f.note).toContain('ימי הזיכרון');
  });
});
