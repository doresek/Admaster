import { describe, expect, it } from 'vitest';
import type { ArmObservation } from '@/lib/hypotheses';
import { pooledEvidence } from '../pooling';
import { hypothesisRow } from './fixtures';

const ATOM  = 'atom-hook-12';
const OTHER = 'atom-unrelated';

describe('pooledEvidence — the §3 pooling escape hatch (floors met by structure)', () => {
  // The same hook atom tested across 3 audiences. Each test's floor is 1000
  // impressions per arm; each test has observed 400 impressions total (2 arms
  // × 200) → per-test progress 400/1000 = 0.4. No single test can resolve —
  // but the STRUCTURE holds 3 × 0.4 = 1.2 floor quanta, so the atom-level
  // verdict is readable.
  const tests = [
    hypothesisRow({ id: 'hyp-aud-1', insight_ids: [ATOM, 'atom-aud-1'] }),
    hypothesisRow({ id: 'hyp-aud-2', insight_ids: [ATOM, 'atom-aud-2'] }),
    hypothesisRow({ id: 'hyp-aud-3', insight_ids: [ATOM, 'atom-aud-3'] }),
    hypothesisRow({ id: 'hyp-disjoint', insight_ids: [OTHER] }),
  ];
  const observationsFor = (prefix: string): ArmObservation[] => [
    { arm: `${prefix}-A`, impressions: 200, clicks: 10 },
    { arm: `${prefix}-B`, impressions: 200, clicks: 6 },
  ];
  const observations = {
    'hyp-aud-1':    observationsFor('a1'),
    'hyp-aud-2':    observationsFor('a2'),
    'hyp-aud-3':    observationsFor('a3'),
    // The disjoint test has a huge sample — it must NOT leak into the pool.
    'hyp-disjoint': [{ arm: 'X', impressions: 99000, clicks: 5000 }],
  };

  const pooled = pooledEvidence(ATOM, tests, observations);

  it('3 tests at 40% each pool to 1.2 quanta → ready', () => {
    expect(pooled.per_test.map((t) => t.floor_progress)).toEqual([0.4, 0.4, 0.4]);
    expect(pooled.combined_progress).toBe(1.2);
    expect(pooled.ready).toBe(true);
  });

  it('combined_n sums only the sharing tests (3 × 400 impressions, 3 × 16 clicks)', () => {
    expect(pooled.combined_n).toEqual({ impressions: 1200, clicks: 48, conversions: 0, marked_leads: 0 });
  });

  it('disjoint atoms do not pool — the unrelated test is excluded entirely', () => {
    expect(pooled.per_test.map((t) => t.hypothesis_id)).toEqual(['hyp-aud-1', 'hyp-aud-2', 'hyp-aud-3']);
  });

  it('readiness is a FLAG, not a resolution — the reason says whose job that is', () => {
    expect(pooled.reason).toContain('readiness only');
    expect(pooled.reason).toContain('resolveAndLearn');
  });

  it('below the quantum → not ready, with the arithmetic in the reason', () => {
    const partial = pooledEvidence(ATOM, tests.slice(0, 2), observations);
    // 2 × 0.4 = 0.8 < 1.
    expect(partial.combined_progress).toBe(0.8);
    expect(partial.ready).toBe(false);
    expect(partial.reason).toContain('0.8');
    expect(partial.reason).toContain('below the 1.0 needed');
  });

  it('no tests reference the atom → not ready with the reason', () => {
    const empty = pooledEvidence('atom-nobody-tests', tests, observations);
    expect(empty.ready).toBe(false);
    expect(empty.combined_progress).toBe(0);
    expect(empty.per_test).toEqual([]);
    expect(empty.reason).toContain('nothing to pool');
  });

  it('a sharing test with no observations contributes zero, not an error', () => {
    const pooledWithGap = pooledEvidence(ATOM, tests, {
      'hyp-aud-1': observationsFor('a1'),
      // hyp-aud-2 and hyp-aud-3 have no observations yet.
    });
    expect(pooledWithGap.per_test.map((t) => t.floor_progress)).toEqual([0.4, 0, 0]);
    expect(pooledWithGap.ready).toBe(false);
  });

  it('non-finite counts are treated as zero (total math)', () => {
    const pooledBroken = pooledEvidence(ATOM, [tests[0]], {
      'hyp-aud-1': [{ arm: 'A', impressions: Number.NaN, clicks: Number.POSITIVE_INFINITY }],
    });
    expect(pooledBroken.combined_n).toEqual({ impressions: 0, clicks: 0, conversions: 0, marked_leads: 0 });
    expect(Number.isFinite(pooledBroken.combined_progress)).toBe(true);
  });
});
