// lib/experiments/allocate.ts
//
// PURE Thompson-style daily arm allocation (spec C-11 allocateArms): within a
// test's REGISTERED structure, split the day's budget ∝ each arm's sampled
// win probability — but floors first (an arm below its floor trajectory gets
// its minimum viable spend before any proportional split; never starve a test
// below significance), and C-01 kill rules first of all (a flagged arm gets 0;
// EXECUTING the kill belongs to the runner/heartbeat, not here).
//
// DETERMINISM: Thompson sampling normally needs an RNG; determinism is a hard
// requirement here (unit tests + heartbeat replay must reproduce allocations
// bit-for-bit), so the "sampling" is pseudo-sampling from a seeded LCG. The
// seed comes from the caller — e.g. a date hash — so the same day replays
// identically while different days still explore.

import { armFloorProgress, checkKillRules } from '@/lib/hypotheses';
import type { ArmObservation, FloorSpec, HypothesisRow } from '@/lib/hypotheses';
import { round2 } from './info-value';
import type { AllocationPlan, ArmAllocation, UnitCosts } from './types';

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const ceil2 = (n: number): number => Math.ceil(n * 100) / 100;

// ── deterministic pseudo-sampling ─────────────────────────────────────────────

/**
 * Numerical Recipes LCG (32-bit): deterministic uniform stream from a seed.
 * Not cryptographic and not meant to be — it only has to be well-spread and
 * reproducible.
 */
function lcg(seed: number): () => number {
  let state = (isFiniteNum(seed) ? Math.floor(Math.abs(seed)) : 1) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296; // [0, 1)
  };
}

/** Approximate standard normal via Irwin–Hall (sum of 12 uniforms − 6). */
function gaussian(next: () => number): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += next();
  return sum - 6;
}

/**
 * Beta-ish pseudo-sample of an arm's success rate from (successes, trials):
 * Laplace-smoothed mean (s+1)/(n+2) plus a gaussian perturbation scaled by the
 * posterior's approximate sd √(m(1−m)/(n+3)) — small samples wobble a lot
 * (exploration), large samples barely move (exploitation), which is the whole
 * Thompson idea without an actual Beta sampler.
 */
function pseudoBetaSample(successes: number, trials: number, next: () => number): number {
  const s = Math.max(0, successes);
  const n = Math.max(s, trials);
  const mean = (s + 1) / (n + 2);
  const sd   = Math.sqrt((mean * (1 - mean)) / (n + 3));
  const sample = mean + gaussian(next) * sd;
  return Math.min(1 - 1e-4, Math.max(1e-4, sample));
}

// ── grade → (successes, trials) ───────────────────────────────────────────────

// Which observed counts stand in for successes/trials per floor grade. cpa is
// graded on conversions-per-click like cvr (a cost is not a count; its rate
// proxy is what the pseudo-posterior can honestly be built from). MIRRORS the
// grade→result mapping spirit of lib/hypotheses/core RESULT_FIELD_FOR_GRADE.
const GRADE_RATE: Record<FloorSpec['metric_grade'], { success: keyof CountFields; trial: keyof CountFields }> = {
  ctr:          { success: 'clicks',       trial: 'impressions' },
  cvr:          { success: 'conversions',  trial: 'clicks' },
  cpa:          { success: 'conversions',  trial: 'clicks' },
  lead_quality: { success: 'marked_leads', trial: 'clicks' },
};

interface CountFields {
  impressions:  number;
  clicks:       number;
  conversions:  number;
  marked_leads: number;
}

const countOf = (obs: ArmObservation | undefined, field: keyof CountFields): number => {
  const v = obs?.[field];
  return isFiniteNum(v) && v > 0 ? v : 0;
};

// Floor-field → unit-cost mapping for the floor-trajectory minimum (same
// mirror of lib/hypotheses/core's private UNIT_COST_FOR_FLOOR as info-value.ts).
const FLOOR_FIELDS = ['impressions', 'clicks', 'conversions', 'marked_leads'] as const;
const UNIT_COST_FOR_FLOOR: Record<(typeof FLOOR_FIELDS)[number], keyof UnitCosts> = {
  impressions:  'expected_cpm',
  clicks:       'expected_cpc',
  conversions:  'expected_cpa',
  marked_leads: 'expected_cost_per_marked_lead',
};

// ── allocateArms ──────────────────────────────────────────────────────────────

export interface AllocateArmsOptions {
  /** Cumulative spend per arm — feeds the C-01 catastrophic/horizon kill checks. */
  spendByArm?: Record<string, number>;
  /** Expected unit costs for projecting the floor-trajectory minimum spend. */
  unitCosts?: UnitCosts;
  /**
   * Clock for the C-01 horizon check and remaining-days math. Defaults to the
   * wall clock; replay/tests pass it explicitly (the seed makes the SAMPLING
   * deterministic; `now` determinism is the caller's responsibility).
   */
  now?: Date;
}

/**
 * Split one test's daily budget across its registered arms:
 *   1. C-01 kill rules run FIRST (imported, never reimplemented): a mercy/
 *      catastrophic-flagged arm is allocated 0 and the action is surfaced on
 *      the plan for the runner to execute.
 *   2. FLOORS FIRST (§3/§4 — never starve an arm below significance): every
 *      live under-floor arm gets its minimum viable daily spend (remaining
 *      floor cost ÷ remaining horizon days). Without unit costs the minimum
 *      falls back to a fair share — we cannot project, so we guarantee an even
 *      cut rather than inventing a projection.
 *   3. The surplus splits ∝ deterministic Thompson pseudo-samples.
 *
 * Arms come from the REGISTERED structure (test_refs) plus any observed arms;
 * they are processed in sorted order so the seeded draws are independent of
 * input array order. Total allocated always equals the budget exactly (the
 * rounding residual lands on the first live arm) — the invariant tests assert
 * it. All math is total: degenerate budgets yield zero allocations plus a
 * note, never NaN.
 */
export function allocateArms(
  hypothesis: Pick<HypothesisRow, 'floor_spec' | 'kill_rules' | 'horizon' | 'registered_at' | 'test_refs'>,
  observations: ArmObservation[],
  dailyBudgetIls: number,
  seed: number,
  opts: AllocateArmsOptions = {},
): AllocationPlan {
  const notes: string[] = [];
  const spendByArm = opts.spendByArm ?? {};
  const now        = opts.now ?? new Date();
  const unitCosts  = opts.unitCosts ?? {};

  // Registered structure + observed arms, in stable sorted order.
  const armSet = new Set<string>();
  for (const ref of hypothesis.test_refs) if (ref.arm_label.trim()) armSet.add(ref.arm_label);
  for (const obs of observations) if (obs.arm.trim()) armSet.add(obs.arm);
  const arms = [...armSet].sort();

  const budget = isFiniteNum(dailyBudgetIls) && dailyBudgetIls > 0 ? dailyBudgetIls : 0;

  // 1) C-01 kill rules — delegated wholesale, never reimplemented here.
  const kill = checkKillRules(hypothesis, observations, spendByArm, now);
  const killedArm = kill?.kind === 'kill_arm' ? kill.arm : null;

  if (arms.length === 0) {
    return { allocations: [], kill, total_allocated: 0, notes: ['no arms registered or observed — nothing to allocate'] };
  }
  if (budget <= 0) {
    notes.push(`daily budget ₪${String(dailyBudgetIls)} is not a positive amount — all arms allocated 0`);
  }

  const obsByArm = new Map(observations.map((o) => [o.arm, o]));
  const next = lcg(seed);

  // Remaining days for the floor-trajectory math: horizon minus elapsed, ≥ 1
  // (the minimum must be meetable TODAY even on the last day).
  const registeredMs  = Date.parse(hypothesis.registered_at);
  const elapsedDays   = Number.isFinite(registeredMs) ? Math.max(0, (now.getTime() - registeredMs) / 86_400_000) : 0;
  const horizonDays   = isFiniteNum(hypothesis.horizon.max_days) ? hypothesis.horizon.max_days : elapsedDays + 7;
  const remainingDays = Math.max(1, horizonDays - elapsedDays);

  const live = arms.filter((a) => a !== killedArm);
  const fairShare = live.length > 0 ? budget / live.length : 0;

  // Per-arm state, sampled in sorted-arm order (determinism).
  interface ArmState {
    arm: string;
    obs: ArmObservation | undefined;
    progress: number;
    sampled: number;
    floorMin: number;
    killed: boolean;
  }
  const states: ArmState[] = arms.map((arm) => {
    const obs = obsByArm.get(arm);
    const rate = GRADE_RATE[hypothesis.floor_spec.metric_grade];
    const sampled = pseudoBetaSample(countOf(obs, rate.success), countOf(obs, rate.trial), next);
    const progress = obs ? armFloorProgress(hypothesis.floor_spec, obs) : 0;
    const killed = arm === killedArm;

    // 2) floors first — minimum viable daily spend to stay on floor trajectory.
    let floorMin = 0;
    if (!killed && budget > 0 && progress < 1) {
      let projectable = false;
      for (const field of FLOOR_FIELDS) {
        const required = hypothesis.floor_spec.per_arm[field];
        if (!isFiniteNum(required) || required <= 0) continue;
        const unitCost = unitCosts[UNIT_COST_FOR_FLOOR[field]];
        if (!isFiniteNum(unitCost) || unitCost <= 0) continue;
        projectable = true;
        const remainingUnits = Math.max(0, required - countOf(obs, field));
        const remainingCost  = field === 'impressions' ? (remainingUnits / 1000) * unitCost : remainingUnits * unitCost;
        floorMin = Math.max(floorMin, ceil2(remainingCost / remainingDays));
      }
      if (!projectable) {
        // Honest fallback: with no unit costs we cannot project the trajectory,
        // so the guarantee degrades to an even share (never to starvation).
        floorMin = round2(fairShare);
      }
    }
    return { arm, obs, progress, sampled, floorMin, killed };
  });

  // If the guaranteed minimums exceed the budget, scale them down together —
  // every under-floor arm keeps a proportional trajectory (we cannot conjure
  // budget, but we still never zero out a live arm in favor of another).
  const liveStates = states.filter((s) => !s.killed);
  const minTotal = liveStates.reduce((sum, s) => sum + s.floorMin, 0);
  let scale = 1;
  if (budget > 0 && minTotal > budget) {
    scale = budget / minTotal;
    notes.push(
      `floor minimums ₪${round2(minTotal)}/day exceed the ₪${round2(budget)}/day budget — ` +
      `scaled ×${Math.round(scale * 100) / 100}; the test is under-funded for its floors (consider pooling or a smaller slate)`,
    );
  }

  const base = new Map<string, number>();
  for (const s of liveStates) base.set(s.arm, s.floorMin * scale);

  // 3) Thompson surplus ∝ sampled win probability.
  const surplus = Math.max(0, budget - liveStates.reduce((sum, s) => sum + (base.get(s.arm) ?? 0), 0));
  const sampledSum = liveStates.reduce((sum, s) => sum + s.sampled, 0);
  if (surplus > 0 && sampledSum > 0) {
    for (const s of liveStates) {
      base.set(s.arm, (base.get(s.arm) ?? 0) + surplus * (s.sampled / sampledSum));
    }
  }

  // Round, then land the residual on the first live arm so Σ == budget exactly.
  const allocations: ArmAllocation[] = states.map((s) => ({
    arm:              s.arm,
    daily_budget:     s.killed ? 0 : round2(base.get(s.arm) ?? 0),
    floor_progress:   round2(s.progress),
    floor_minimum:    s.killed ? 0 : round2(s.floorMin * scale),
    sampled_win_prob: Math.round(s.sampled * 10000) / 10000,
    killed:           s.killed,
  }));
  if (budget > 0 && liveStates.length > 0) {
    const total = allocations.reduce((sum, a) => sum + a.daily_budget, 0);
    const residual = round2(budget - total);
    if (residual !== 0) {
      const first = allocations.find((a) => !a.killed);
      if (first) first.daily_budget = round2(first.daily_budget + residual);
    }
  }

  return {
    allocations,
    kill,
    total_allocated: round2(allocations.reduce((sum, a) => sum + a.daily_budget, 0)),
    notes,
  };
}
