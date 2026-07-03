import { describe, expect, it } from 'vitest';
import type { ArmObservation } from '@/lib/hypotheses';
import { allocateArms } from '../allocate';
import { UNIT_COSTS, hypothesisRow } from './fixtures';

const NOW = new Date('2026-07-03T00:00:00.000Z'); // 2 days after fixture registered_at

const sumAllocated = (allocations: Array<{ daily_budget: number }>): number =>
  Math.round(allocations.reduce((s, a) => s + a.daily_budget, 0) * 100) / 100;

describe('allocateArms — floors first (§3/§4: never starve a test below significance)', () => {
  // A is far past its floor and winning; B is losing but UNDER floor (400/1000
  // impressions). Floor trajectory for B: 600 impressions remaining × ₪20 CPM
  // = ₪12 over the 8 remaining horizon days → ₪1.5/day minimum.
  const h = hypothesisRow(); // ctr grade, floor 1000 impressions/arm, 10-day horizon
  const observations: ArmObservation[] = [
    { arm: 'A', impressions: 5000, clicks: 250, metrics: { ctr: 0.05 } },
    { arm: 'B', impressions: 400,  clicks: 4,   metrics: { ctr: 0.01 } },
  ];

  it('an under-floor arm gets its minimum viable spend even while losing', () => {
    const plan = allocateArms(h, observations, 20, 1, { unitCosts: UNIT_COSTS, now: NOW });
    const armB = plan.allocations.find((a) => a.arm === 'B');
    expect(armB).toBeDefined();
    expect(armB?.floor_minimum).toBe(1.5);
    expect(armB?.daily_budget ?? 0).toBeGreaterThanOrEqual(1.5);
    expect(armB?.floor_progress).toBe(0.4);
  });

  it('the winning arm still takes the larger share of the surplus (Thompson exploits)', () => {
    const plan = allocateArms(h, observations, 20, 1, { unitCosts: UNIT_COSTS, now: NOW });
    const armA = plan.allocations.find((a) => a.arm === 'A');
    const armB = plan.allocations.find((a) => a.arm === 'B');
    // A's pseudo-posterior (251/5002 ≈ 5%) dominates B's (5/402 ≈ 1.2%) at any seed.
    expect(armA?.sampled_win_prob ?? 0).toBeGreaterThan(armB?.sampled_win_prob ?? 1);
    expect(armA?.daily_budget ?? 0).toBeGreaterThan(armB?.daily_budget ?? 1);
  });

  it('without unit costs the floor guarantee degrades to a fair share, never to starvation', () => {
    const plan = allocateArms(h, observations, 20, 1, { now: NOW });
    const armB = plan.allocations.find((a) => a.arm === 'B');
    expect(armB?.floor_minimum).toBe(10); // fair share of ₪20 across 2 arms
  });

  it('when floor minimums exceed the budget they scale down together, with a note', () => {
    // Both arms unobserved → each needs 1000 imp × ₪20 CPM = ₪20 over min 8
    // days → 2.5/day each; budget ₪1 cannot cover ₪5 → scale ×0.2.
    const plan = allocateArms(h, [], 1, 1, { unitCosts: UNIT_COSTS, now: NOW });
    expect(plan.total_allocated).toBe(1);
    expect(plan.notes.some((n) => n.includes('exceed'))).toBe(true);
  });
});

describe('allocateArms — kill rules are delegated to C-01 and surfaced, not executed', () => {
  it('a catastrophically-flagged arm gets 0 and the action rides on the plan', () => {
    const h = hypothesisRow({
      kill_rules: { catastrophic: { spend_multiple: 3, expected_cost_per_result: 10 } },
    });
    // B spent ₪30 (= 3 × ₪10) with ZERO clicks (the ctr-grade result field).
    const observations: ArmObservation[] = [
      { arm: 'A', impressions: 2000, clicks: 100, metrics: { ctr: 0.05 } },
      { arm: 'B', impressions: 2000, clicks: 0,   metrics: { ctr: 0 } },
    ];
    const plan = allocateArms(h, observations, 20, 1, {
      unitCosts:  UNIT_COSTS,
      spendByArm: { A: 30, B: 30 },
      now:        NOW,
    });

    expect(plan.kill?.kind).toBe('kill_arm');
    if (plan.kill?.kind === 'kill_arm') expect(plan.kill.rule).toBe('catastrophic');
    const armB = plan.allocations.find((a) => a.arm === 'B');
    expect(armB?.killed).toBe(true);
    expect(armB?.daily_budget).toBe(0);
    // The survivor absorbs the full budget.
    expect(plan.allocations.find((a) => a.arm === 'A')?.daily_budget).toBe(20);
    expect(plan.total_allocated).toBe(20);
  });

  it('a mercy-flagged arm gets 0 with the C-01 reason surfaced', () => {
    const h = hypothesisRow({
      kill_rules: { mercy: { min_floor_multiple: 2, max_fraction_of_leader: 0.5 } },
    });
    // Both arms at 2× floor; B's ctr is 20% of A's → mercy kill.
    const observations: ArmObservation[] = [
      { arm: 'A', impressions: 2000, clicks: 100, metrics: { ctr: 0.05 } },
      { arm: 'B', impressions: 2000, clicks: 20,  metrics: { ctr: 0.01 } },
    ];
    const plan = allocateArms(h, observations, 20, 1, { unitCosts: UNIT_COSTS, now: NOW });
    expect(plan.kill?.kind).toBe('kill_arm');
    if (plan.kill?.kind === 'kill_arm') {
      expect(plan.kill.rule).toBe('mercy');
      expect(plan.kill.arm).toBe('B');
      expect(plan.kill.reason).toContain('kill early, reallocate to survivors');
    }
    expect(plan.allocations.find((a) => a.arm === 'B')?.daily_budget).toBe(0);
  });
});

describe('allocateArms — seeded determinism (replay is a hard requirement)', () => {
  const h = hypothesisRow();
  const observations: ArmObservation[] = [
    { arm: 'A', impressions: 3000, clicks: 90 },
    { arm: 'B', impressions: 3000, clicks: 60 },
  ];

  it('same seed → bit-identical allocation', () => {
    const a = allocateArms(h, observations, 20, 42, { unitCosts: UNIT_COSTS, now: NOW });
    const b = allocateArms(h, observations, 20, 42, { unitCosts: UNIT_COSTS, now: NOW });
    expect(a).toEqual(b);
  });

  it('observation array order does not change the outcome (arms sampled in sorted order)', () => {
    const a = allocateArms(h, observations, 20, 42, { unitCosts: UNIT_COSTS, now: NOW });
    const b = allocateArms(h, [...observations].reverse(), 20, 42, { unitCosts: UNIT_COSTS, now: NOW });
    expect(a).toEqual(b);
  });

  it('different seed → different (but valid) pseudo-samples', () => {
    const a = allocateArms(h, observations, 20, 42, { unitCosts: UNIT_COSTS, now: NOW });
    const b = allocateArms(h, observations, 20, 43, { unitCosts: UNIT_COSTS, now: NOW });
    const probsA = a.allocations.map((x) => x.sampled_win_prob);
    const probsB = b.allocations.map((x) => x.sampled_win_prob);
    expect(probsA).not.toEqual(probsB);
    expect(sumAllocated(b.allocations)).toBe(20);
  });

  it('allocation sums to the budget exactly across many seeds (invariant)', () => {
    for (const seed of [0, 1, 7, 99, 20260703]) {
      const plan = allocateArms(h, observations, 17.77, seed, { unitCosts: UNIT_COSTS, now: NOW });
      expect(sumAllocated(plan.allocations)).toBe(17.77);
      expect(plan.total_allocated).toBe(17.77);
      for (const a of plan.allocations) {
        expect(Number.isFinite(a.daily_budget)).toBe(true);
        expect(a.daily_budget).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('allocateArms — cold start and degenerate inputs', () => {
  it('zero observations → near-even split across the registered arms', () => {
    const h = hypothesisRow({
      test_refs: [{ arm_label: 'A' }, { arm_label: 'B' }, { arm_label: 'C' }],
    });
    const plan = allocateArms(h, [], 30, 5, { now: NOW });
    expect(plan.allocations).toHaveLength(3);
    // No unit costs → floor fallback gives each arm the fair share of ₪10.
    for (const a of plan.allocations) expect(a.daily_budget).toBeCloseTo(10, 2);
    expect(sumAllocated(plan.allocations)).toBe(30);
  });

  it('zero/negative/non-finite budget → all-zero allocations with a note, never NaN', () => {
    const h = hypothesisRow();
    for (const budget of [0, -5, Number.NaN]) {
      const plan = allocateArms(h, [], budget, 1, { now: NOW });
      for (const a of plan.allocations) expect(a.daily_budget).toBe(0);
      expect(plan.total_allocated).toBe(0);
      expect(plan.notes.some((n) => n.includes('not a positive amount'))).toBe(true);
    }
  });

  it('no arms at all → empty allocations with a note', () => {
    const h = hypothesisRow({ test_refs: [] });
    const plan = allocateArms(h, [], 20, 1, { now: NOW });
    expect(plan.allocations).toEqual([]);
    expect(plan.notes[0]).toContain('nothing to allocate');
  });

  it('broken observations (NaN counts) degrade to zero, never poison the split', () => {
    const h = hypothesisRow();
    const observations: ArmObservation[] = [
      { arm: 'A', impressions: Number.NaN, clicks: Number.NaN },
      { arm: 'B', impressions: 2000, clicks: 50 },
    ];
    const plan = allocateArms(h, observations, 20, 3, { unitCosts: UNIT_COSTS, now: NOW });
    expect(sumAllocated(plan.allocations)).toBe(20);
    for (const a of plan.allocations) expect(Number.isFinite(a.daily_budget)).toBe(true);
  });
});
