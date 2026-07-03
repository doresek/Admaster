import { describe, expect, it } from 'vitest';
import { planSlate } from '../plan-slate';
import type { HypothesisCandidate } from '../types';
import { UNIT_COSTS, atom, bridgeAtoms, candidate, shuffled } from './fixtures';

// ── the headline scenario (skill §3 small-budget corollary) ───────────────────
//
// ₪50/day, MATURE client (3 proven bridge atoms) → 20% explore = ₪10/day.
//
// cvr-big:  offer domain, 3 contested atoms → dw = 3×1.5 = 4.5, bm = 1.0.
//           CVR floor 100 clicks/arm × 2 arms × ₪1.5 CPC = ₪300 over a 12-day
//           horizon → min viable ₪25/day. iv = 4.5/300 = 0.015 (ranked FIRST —
//           highest-value open hypothesis).
// ctr-1/2:  creative domain, 1 settled atom (0.9) → dw = 1, bm = 0.36.
//           CTR floor 1000 imp/arm × 2 arms × ₪20 CPM = ₪40 over 10 days →
//           min viable ₪4/day. iv = 0.36/40 = 0.009.
//
// Mature: the CVR test cannot fit ₪10/day → deferred WITH the math; the two
// cheap CTR tests fill the capacity (2–3 CTR-grade tests at ₪50/day — §3).
// New client: 50% explore = ₪25/day admits the big CVR test instead.

const cvrBig = candidate({
  id:          'cvr-big',
  claim:       'the premium offer framing beats the discount framing on CVR',
  insight_ids: ['o1', 'o2', 'o3'],
  domain:      'offer',
  kind:        'decision_unblocking',
  floor_spec:  { metric_grade: 'cvr', per_arm: { clicks: 100 } },
  horizon:     { max_days: 12 },
});
const ctr1 = candidate({
  id:          'ctr-1',
  insight_ids: ['h1'],
  domain:      'creative',
  kind:        'fatigue_successor',
  floor_spec:  { metric_grade: 'ctr', per_arm: { impressions: 1000 } },
  horizon:     { max_days: 10 },
});
const ctr2 = candidate({ ...ctr1, id: 'ctr-2', insight_ids: ['h2'] });

const CANDIDATE_ATOMS = [
  atom({ id: 'o1', confidence: 0.5 }),
  atom({ id: 'o2', confidence: 0.5 }),
  atom({ id: 'o3', confidence: 0.5 }),
  atom({ id: 'h1', confidence: 0.9 }),
  atom({ id: 'h2', confidence: 0.9 }),
];
const MATURE_INSIGHTS = [...bridgeAtoms(3), ...CANDIDATE_ATOMS];
const NEW_INSIGHTS    = [...CANDIDATE_ATOMS];

describe('planSlate — the ₪50/day mature-client headline', () => {
  const plan = planSlate({
    candidates:     [cvrBig, ctr1, ctr2],
    insights:       MATURE_INSIGHTS,
    dailyBudgetIls: 50,
    unitCosts:      UNIT_COSTS,
  });

  it('mature → 20% explore = ₪10/day', () => {
    expect(plan.maturity.maturity).toBe('mature');
    expect(plan.explore_budget_ils).toBe(10);
  });

  it('selects the two cheap CTR-grade tests (2–3 CTR-grade tests fit ₪50/day, §3)', () => {
    expect(plan.selected.map((s) => s.candidate.id)).toEqual(['ctr-1', 'ctr-2']);
  });

  it('per-test budget = max(min viable ₪4, fair share ₪5) → ₪5 each, capacity fully used', () => {
    expect(plan.selected.map((s) => s.min_viable_daily)).toEqual([4, 4]);
    expect(plan.selected.map((s) => s.daily_budget)).toEqual([5, 5]);
    expect(plan.explore_budget_used).toBe(10);
  });

  it('defers the CVR-grade test WITH the resolvability math (reused from C-01)', () => {
    expect(plan.deferred).toHaveLength(1);
    const deferral = plan.deferred[0];
    expect(deferral.candidate.id).toBe('cvr-big');
    // Our capacity framing…
    expect(deferral.reason).toContain('needs ₪25/day to reach its floor in 12 days');
    expect(deferral.reason).toContain('only ₪10/day of explore budget remains');
    // …carrying validateRegistration's own rejection, numbers included.
    expect(deferral.reason).toContain('unresolvable at this budget');
    expect(deferral.reason).toContain('< floor of 100');
    expect(deferral.reason).toContain('redesign, pool, or do not launch');
  });

  it('the deferred candidate still carries its score (it lost on budget, not on data)', () => {
    expect(plan.deferred[0].score?.info_value).toBeCloseTo(0.015, 4);
  });

  it('never overspends the explore budget (invariant)', () => {
    expect(plan.explore_budget_used).toBeLessThanOrEqual(plan.explore_budget_ils);
  });

  it('capacity note names the maturity and the counts', () => {
    expect(plan.capacity_note).toContain('mature');
    expect(plan.capacity_note).toContain('1 deferred');
  });
});

describe('planSlate — the new-client contrast (50% explore admits the bigger test)', () => {
  const plan = planSlate({
    candidates:     [cvrBig, ctr1, ctr2],
    insights:       NEW_INSIGHTS,
    dailyBudgetIls: 50,
    unitCosts:      UNIT_COSTS,
  });

  it('new brain → 50% explore = ₪25/day', () => {
    expect(plan.maturity.maturity).toBe('new');
    expect(plan.explore_budget_ils).toBe(25);
  });

  it('the highest-value CVR test now fits (min viable ₪25/day) and takes the slate', () => {
    expect(plan.selected.map((s) => s.candidate.id)).toEqual(['cvr-big']);
    expect(plan.selected[0].daily_budget).toBe(25);
    expect(plan.explore_budget_used).toBe(25);
  });

  it('the CTR tests defer — capacity went to the highest-value open hypothesis (§3)', () => {
    expect(plan.deferred.map((d) => d.candidate.id)).toEqual(['ctr-1', 'ctr-2']);
    for (const d of plan.deferred) expect(d.reason).toContain('explore budget remains');
  });
});

describe('planSlate — determinism', () => {
  const input = {
    candidates:     [cvrBig, ctr1, ctr2],
    insights:       MATURE_INSIGHTS,
    dailyBudgetIls: 50,
    unitCosts:      UNIT_COSTS,
  };

  it('same inputs → identical plan', () => {
    expect(JSON.stringify(planSlate(input))).toBe(JSON.stringify(planSlate(input)));
  });

  it('shuffled candidate order → identical plan (stable total ordering)', () => {
    const base = planSlate(input);
    for (const seed of [7, 42, 1234]) {
      const plan = planSlate({ ...input, candidates: shuffled(input.candidates, seed) });
      expect(JSON.stringify(plan)).toBe(JSON.stringify(base));
    }
  });

  it('equal-score candidates tie-break by the §5 kind ladder, then id', () => {
    // Identical economics + atoms → identical info value; the contested_atom
    // kind must outrank fatigue_successor, and ids order the rest.
    const contested = candidate({ ...ctr1, id: 'z-contested', kind: 'contested_atom' });
    const successor = candidate({ ...ctr1, id: 'a-successor', kind: 'fatigue_successor' });
    const plan = planSlate({
      candidates:     [successor, contested],
      insights:       MATURE_INSIGHTS,
      dailyBudgetIls: 50,
      unitCosts:      UNIT_COSTS,
    });
    expect(plan.selected.map((s) => s.candidate.id)).toEqual(['z-contested', 'a-successor']);
  });
});

describe('planSlate — degenerate and structural cases', () => {
  it('zero budget → all deferred with the reason', () => {
    const plan = planSlate({
      candidates:     [ctr1, ctr2],
      insights:       MATURE_INSIGHTS,
      dailyBudgetIls: 0,
      unitCosts:      UNIT_COSTS,
    });
    expect(plan.selected).toEqual([]);
    expect(plan.deferred).toHaveLength(2);
    for (const d of plan.deferred) expect(d.reason).toContain('zero explore budget');
    expect(plan.explore_budget_used).toBe(0);
  });

  it('non-finite budget is treated as zero, never as NaN downstream', () => {
    const plan = planSlate({
      candidates:     [ctr1],
      insights:       MATURE_INSIGHTS,
      dailyBudgetIls: Number.NaN,
      unitCosts:      UNIT_COSTS,
    });
    expect(plan.explore_budget_ils).toBe(0);
    expect(Number.isFinite(plan.explore_budget_used)).toBe(true);
  });

  it('zero candidates → empty slate with an idle-capacity note', () => {
    const plan = planSlate({
      candidates:     [],
      insights:       MATURE_INSIGHTS,
      dailyBudgetIls: 50,
      unitCosts:      UNIT_COSTS,
    });
    expect(plan.selected).toEqual([]);
    expect(plan.deferred).toEqual([]);
    expect(plan.capacity_note).toContain('no open candidates');
  });

  it('a test whose own horizon max_spend cannot reach the floor defers as structurally unresolvable', () => {
    const capped: HypothesisCandidate = candidate({
      id:          'capped',
      insight_ids: ['o1'],
      floor_spec:  { metric_grade: 'cvr', per_arm: { clicks: 100 } }, // ₪300 total needed
      horizon:     { max_days: 10, max_spend: 100 },                  // but only ₪100 allowed
    });
    const plan = planSlate({
      candidates:     [capped],
      insights:       MATURE_INSIGHTS,
      dailyBudgetIls: 500, // ample explore budget — the horizon itself is the blocker
      unitCosts:      UNIT_COSTS,
    });
    expect(plan.selected).toEqual([]);
    expect(plan.deferred[0].reason).toContain('unresolvable within its own horizon');
  });

  it('an unprojectable candidate defers as not scoreable', () => {
    const blind = candidate({
      id:         'blind',
      floor_spec: { metric_grade: 'lead_quality', per_arm: { marked_leads: 15 } },
    });
    const plan = planSlate({
      candidates:     [blind],
      insights:       MATURE_INSIGHTS,
      dailyBudgetIls: 50,
      unitCosts:      UNIT_COSTS, // no expected_cost_per_marked_lead
    });
    expect(plan.deferred[0].reason).toContain('not scoreable');
  });
});
