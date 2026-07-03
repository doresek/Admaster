// Behavior tests for the pure core: registration validation (including the
// "don't launch unresolvable tests" math), comparator evaluation, floor checks
// and the verdict function. Boundaries are tested AT the boundary — the craft
// rules are inclusive/strict in specific places and that is the contract.

import { describe, it, expect } from 'vitest';
import { armFloorProgress, evaluatePrediction, floorMet, resolve, validateRegistration } from '../core';
import type { RegistrationRejectionCode } from '../types';
import { ATOM_1, ATOM_2, floorSpec, hypothesisRow, obs, prediction, registration, verdictMap } from './fixtures';

function rejectionCodes(input: ReturnType<typeof registration>): RegistrationRejectionCode[] {
  const v = validateRegistration(input);
  return v.ok ? [] : v.reasons.map((r) => r.code);
}

describe('validateRegistration', () => {
  it('accepts a complete, resolvable registration', () => {
    expect(validateRegistration(registration())).toEqual({ ok: true });
  });

  it('rejects an empty claim', () => {
    expect(rejectionCodes(registration({ claim: '   ' }))).toContain('empty_claim');
  });

  it('rejects empty insight_ids — a hypothesis must bind to atoms', () => {
    expect(rejectionCodes(registration({ insightIds: [] }))).toContain('no_insight_ids');
  });

  it('rejects prediction confidence outside [0..1] (and NaN)', () => {
    for (const confidence of [1.2, -0.1, Number.NaN]) {
      expect(rejectionCodes(registration({ prediction: prediction({ confidence }) })))
        .toContain('invalid_confidence');
    }
  });

  it('rejects a non-finite prediction value', () => {
    expect(rejectionCodes(registration({ prediction: prediction({ value: Number.POSITIVE_INFINITY }) })))
      .toContain('invalid_prediction');
  });

  it('rejects a ratio comparator without a baseline_arm', () => {
    expect(rejectionCodes(registration({ prediction: prediction({ comparator: 'ratio_gte', baseline_arm: undefined }) })))
      .toContain('missing_baseline_arm');
  });

  it('rejects a ratio comparator whose baseline_arm equals the arm', () => {
    expect(rejectionCodes(registration({ prediction: prediction({ baseline_arm: 'A' }) })))
      .toContain('missing_baseline_arm');
  });

  it('rejects a floor with no positive per-arm quantity', () => {
    expect(rejectionCodes(registration({ floorSpec: floorSpec({ per_arm: {} }) }))).toContain('invalid_floor');
    expect(rejectionCodes(registration({ floorSpec: floorSpec({ per_arm: { clicks: -5 } }) }))).toContain('invalid_floor');
  });

  it('rejects a horizon with neither max_days nor max_spend — a test that cannot end is a leak', () => {
    expect(rejectionCodes(registration({ horizon: {} }))).toContain('invalid_horizon');
    expect(rejectionCodes(registration({ horizon: { max_days: 0 } }))).toContain('invalid_horizon');
  });

  it('rejects a verdict_map whose supported/refuted lists are empty', () => {
    expect(rejectionCodes(registration({ verdictMap: verdictMap({ supported: [] }) })))
      .toContain('invalid_verdict_map');
  });

  it('rejects verdict_map weights outside [0..1]', () => {
    expect(rejectionCodes(registration({
      verdictMap: verdictMap({ refuted: [{ insight_id: ATOM_1, polarity: 'negative', weight: 1.5 }] }),
    }))).toContain('invalid_weight');
  });

  it('rejects verdict_map moves referencing atoms outside insight_ids', () => {
    expect(rejectionCodes(registration({
      insightIds: [ATOM_1],
      verdictMap: verdictMap(), // default map also moves ATOM_2
    }))).toContain('unknown_insight_ref');
  });

  it('rejects unexecutable kill rules', () => {
    expect(rejectionCodes(registration({
      killRules: { mercy: { min_floor_multiple: 0.5, max_fraction_of_leader: 0.5 } },
    }))).toContain('invalid_kill_rules');
    expect(rejectionCodes(registration({
      killRules: { mercy: { min_floor_multiple: 2, max_fraction_of_leader: 1 } },
    }))).toContain('invalid_kill_rules');
    expect(rejectionCodes(registration({
      killRules: { catastrophic: { spend_multiple: 3, expected_cost_per_result: 0 } },
    }))).toContain('invalid_kill_rules');
  });

  it('rejects a prediction arm that is not wired in test_refs', () => {
    expect(rejectionCodes(registration({ testRefs: [{ arm_label: 'A' }, { arm_label: 'C' }] })))
      .toContain('arm_not_in_test_refs');
  });

  it('accumulates every independent rejection reason', () => {
    const v = validateRegistration(registration({ claim: '', prediction: prediction({ confidence: 2 }) }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const codes = v.reasons.map((r) => r.code);
      expect(codes).toContain('empty_claim');
      expect(codes).toContain('invalid_confidence');
    }
  });

  describe('the "don\'t launch unresolvable tests" math (§7)', () => {
    const cpaTest = (dailyBudget: number) => registration({
      floorSpec:  floorSpec({ metric_grade: 'cpa', per_arm: { conversions: 10 } }),
      horizon:    { max_days: 14 },
      budgetPlan: { daily_budget: dailyBudget, arm_count: 2, expected_cpa: 40 },
    });

    it('rejects when the projected per-arm sample cannot reach the floor — with the numbers', () => {
      // ₪50/day × 14d / 2 arms = ₪350/arm; at ₪40/conversion → 8.75 < floor 10.
      const v = validateRegistration(cpaTest(50));
      expect(v.ok).toBe(false);
      if (!v.ok) {
        const reason = v.reasons.find((r) => r.code === 'unresolvable_at_budget');
        expect(reason).toBeDefined();
        expect(reason?.detail).toMatchObject({
          floor_field:   'conversions',
          required:      10,
          projected:     8.75,
          per_arm_spend: 350,
          arm_count:     2,
          expected_cpa:  40,
        });
        expect(reason?.message).toContain('8.75');
        expect(reason?.message).toContain('do not launch');
      }
    });

    it('accepts once the budget clears the floor', () => {
      // ₪60/day × 14d / 2 arms = ₪420/arm → 10.5 conversions ≥ 10.
      expect(validateRegistration(cpaTest(60))).toEqual({ ok: true });
    });

    it('caps the projection at horizon.max_spend, not just max_days', () => {
      const v = validateRegistration(registration({
        floorSpec:  floorSpec({ metric_grade: 'cpa', per_arm: { conversions: 10 } }),
        horizon:    { max_days: 30, max_spend: 500 },
        budgetPlan: { daily_budget: 100, arm_count: 2, expected_cpa: 40 },
      }));
      expect(v.ok).toBe(false);
      if (!v.ok) {
        const reason = v.reasons.find((r) => r.code === 'unresolvable_at_budget');
        expect(reason?.detail).toMatchObject({ per_arm_spend: 250, projected: 6.25 });
      }
    });

    it('projects impressions floors through CPM (per 1000)', () => {
      // ₪70/day × 10d / 2 arms = ₪350/arm; at ₪25 CPM → 14,000 impressions ≥ 2,000.
      expect(validateRegistration(registration({
        floorSpec:  floorSpec({ metric_grade: 'ctr', per_arm: { impressions: 2000 } }),
        horizon:    { max_days: 10 },
        budgetPlan: { daily_budget: 70, arm_count: 2, expected_cpm: 25 },
      }))).toEqual({ ok: true });
    });

    it('rejects a floor it cannot project (missing unit cost) — "unchecked" is not launchable', () => {
      const v = validateRegistration(registration({
        budgetPlan: { daily_budget: 100, arm_count: 2 }, // default floor is clicks; no expected_cpc
      }));
      expect(v.ok).toBe(false);
      if (!v.ok) {
        const reason = v.reasons.find((r) => r.code === 'unprojectable_floor');
        expect(reason?.detail).toMatchObject({ floor_field: 'clicks', missing_unit_cost: 'expected_cpc' });
      }
    });

    it('rejects a malformed budget plan', () => {
      expect(rejectionCodes(registration({ budgetPlan: { daily_budget: 100, arm_count: 0 } })))
        .toContain('invalid_budget_plan');
      expect(rejectionCodes(registration({ budgetPlan: { daily_budget: -1, arm_count: 2 } })))
        .toContain('invalid_budget_plan');
    });

    it('skips the projection entirely when no budget plan is supplied', () => {
      expect(validateRegistration(registration({ budgetPlan: undefined }))).toEqual({ ok: true });
    });
  });
});

describe('evaluatePrediction', () => {
  const arms = (a: number, b: number) => [
    obs('A', { metrics: { cvr: a } }),
    obs('B', { metrics: { cvr: b } }),
  ];

  it('gte: supported at exactly the threshold (inclusive), refuted below', () => {
    const p = prediction({ comparator: 'gte', value: 0.05, baseline_arm: undefined });
    expect(evaluatePrediction(p, [obs('A', { metrics: { cvr: 0.05 } })]).verdict).toBe('supported');
    expect(evaluatePrediction(p, [obs('A', { metrics: { cvr: 0.0499 } })]).verdict).toBe('refuted');
  });

  it('lte: supported at/below the threshold, refuted above', () => {
    const p = prediction({ metric: 'cpa', comparator: 'lte', value: 40, baseline_arm: undefined });
    expect(evaluatePrediction(p, [obs('A', { metrics: { cpa: 40 } })]).verdict).toBe('supported');
    expect(evaluatePrediction(p, [obs('A', { metrics: { cpa: 40.01 } })]).verdict).toBe('refuted');
  });

  it('ratio_gte: supported at exactly the registered ratio, refuted just below (a 5% lift on a 1.3× prediction is NOT "directionally supported")', () => {
    const p = prediction(); // cvr(A)/cvr(B) >= 1.3
    expect(evaluatePrediction(p, arms(0.065, 0.05)).verdict).toBe('supported'); // 1.30
    expect(evaluatePrediction(p, arms(0.064, 0.05)).verdict).toBe('refuted');   // 1.28
  });

  it('ratio_lte: supported at/below the ratio, refuted above', () => {
    const p = prediction({ comparator: 'ratio_lte', value: 0.8 });
    expect(evaluatePrediction(p, arms(0.04, 0.05)).verdict).toBe('supported'); // 0.80
    expect(evaluatePrediction(p, arms(0.041, 0.05)).verdict).toBe('refuted');
  });

  it('missing arm → inconclusive, never a guess', () => {
    const e = evaluatePrediction(prediction(), [obs('B', { metrics: { cvr: 0.05 } })]);
    expect(e.verdict).toBe('inconclusive');
    expect(e.reason).toContain("'A'");
  });

  it('missing baseline arm → inconclusive', () => {
    expect(evaluatePrediction(prediction(), [obs('A', { metrics: { cvr: 0.05 } })]).verdict).toBe('inconclusive');
  });

  it('missing or NaN metric → inconclusive, never NaN', () => {
    expect(evaluatePrediction(prediction(), [obs('A', { metrics: {} }), obs('B', { metrics: { cvr: 0.05 } })]).verdict)
      .toBe('inconclusive');
    const e = evaluatePrediction(prediction(), arms(Number.NaN, 0.05));
    expect(e.verdict).toBe('inconclusive');
    expect(e.observed).toBeUndefined();
  });

  it('Infinity metric → inconclusive', () => {
    expect(evaluatePrediction(prediction(), arms(Number.POSITIVE_INFINITY, 0.05)).verdict).toBe('inconclusive');
  });

  it('zero baseline → inconclusive (ratio undefined), not Infinity-supported', () => {
    const e = evaluatePrediction(prediction(), arms(0.05, 0));
    expect(e.verdict).toBe('inconclusive');
    expect(e.reason).toContain('baseline');
  });
});

describe('floors', () => {
  it('met at exactly the floor (inclusive), unmet one unit below', () => {
    const f = floorSpec(); // clicks >= 100 per arm
    expect(floorMet(f, [obs('A', { clicks: 100 }), obs('B', { clicks: 100 })])).toBe(true);
    expect(floorMet(f, [obs('A', { clicks: 100 }), obs('B', { clicks: 99 })])).toBe(false);
  });

  it('every floored quantity must be met — progress is the MINIMUM ratio', () => {
    const f = floorSpec({ per_arm: { impressions: 1000, clicks: 100 } });
    const arm = obs('A', { impressions: 3000, clicks: 50 });
    expect(armFloorProgress(f, arm)).toBe(0.5);
    expect(floorMet(f, [arm])).toBe(false);
  });

  it('missing and non-finite counts read as zero', () => {
    const f = floorSpec();
    expect(floorMet(f, [obs('A', {})])).toBe(false);
    expect(floorMet(f, [obs('A', { clicks: Number.POSITIVE_INFINITY })])).toBe(false);
  });

  it('empty observations never meet a floor', () => {
    expect(floorMet(floorSpec(), [])).toBe(false);
  });

  it('a floorless spec never reads as met', () => {
    expect(armFloorProgress(floorSpec({ per_arm: {} }), obs('A', { clicks: 10_000 }))).toBe(0);
  });
});

describe('resolve', () => {
  const NOW = new Date('2026-07-10T00:00:00.000Z');
  const supportedObs = [
    obs('A', { clicks: 150, metrics: { cvr: 0.10 } }),
    obs('B', { clicks: 150, metrics: { cvr: 0.05 } }),
  ];

  it('floor unmet → inconclusive with ZERO atom moves', () => {
    const r = resolve(hypothesisRow(), [obs('A', { clicks: 10, metrics: { cvr: 0.5 } })], NOW);
    expect(r.status).toBe('inconclusive');
    expect(r.atomMoves).toEqual([]);
    expect(r.resolution.resolved_by).toBe('horizon_forced');
    expect(r.resolution.verdict_reason).toContain('floor unmet');
  });

  it('floor met + prediction holds → supported with EXACTLY the frozen verdict_map.supported moves', () => {
    const h = hypothesisRow();
    const r = resolve(h, supportedObs, NOW);
    expect(r.status).toBe('supported');
    expect(r.atomMoves).toEqual(h.verdict_map.supported);
    expect(r.resolution.resolved_by).toBe('floor_met');
  });

  it('floor met + prediction fails → refuted with the frozen verdict_map.refuted moves', () => {
    const h = hypothesisRow();
    const r = resolve(h, [
      obs('A', { clicks: 150, metrics: { cvr: 0.06 } }),
      obs('B', { clicks: 150, metrics: { cvr: 0.05 } }),
    ], NOW); // ratio 1.2 < 1.3
    expect(r.status).toBe('refuted');
    expect(r.atomMoves).toEqual(h.verdict_map.refuted);
  });

  it('floor met but metric unreadable → inconclusive (floors alone are not a verdict)', () => {
    const r = resolve(hypothesisRow(), [obs('A', { clicks: 150 }), obs('B', { clicks: 150 })], NOW);
    expect(r.status).toBe('inconclusive');
    expect(r.atomMoves).toEqual([]);
  });

  it('an unconventional frozen inconclusive map is honored verbatim', () => {
    const moves = [{ insight_id: ATOM_1, polarity: 'negative', weight: 0.2 }] as const;
    const h = hypothesisRow({ verdict_map: verdictMap({ inconclusive: [...moves] }) });
    const r = resolve(h, [], NOW);
    expect(r.status).toBe('inconclusive');
    expect(r.atomMoves).toEqual([...moves]);
  });

  it('resolvedBy override is recorded (manual / kill paths)', () => {
    expect(resolve(hypothesisRow(), supportedObs, NOW, 'manual').resolution.resolved_by).toBe('manual');
    expect(resolve(hypothesisRow(), [], NOW, 'killed_catastrophic').resolution.resolved_by).toBe('killed_catastrophic');
  });

  it('snapshots observations into resolution.observed with non-finite values nulled (JSONB-safe)', () => {
    const r = resolve(hypothesisRow(), [
      obs('A', { clicks: 150, impressions: Number.NaN, metrics: { cvr: 0.1, ctr: Number.POSITIVE_INFINITY } }),
      obs('B', { clicks: 150, metrics: { cvr: 0.05 } }),
    ], NOW);
    expect(r.resolution.observed).toMatchObject({
      A: { clicks: 150, impressions: null, metrics: { cvr: 0.1, ctr: null } },
      B: { clicks: 150, metrics: { cvr: 0.05 } },
    });
  });
});
