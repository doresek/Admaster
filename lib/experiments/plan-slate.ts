// lib/experiments/plan-slate.ts
//
// PURE slate planning (spec C-11 planSlate): fit the week's testing to the
// budget's information capacity (creative-testing-discipline §3 small-budget
// corollary — at ₪50/day, ~1 CVR-grade test OR 2–3 CTR-grade tests), rank by
// information value, explore/exploit split by brain maturity (§5).
//
// DETERMINISM IS A CONTRACT: same inputs → identical plan, regardless of
// candidate array order (stable total ordering with id tie-breaks). The weekly
// heartbeat logs the plan; replaying it must reproduce it.

import { validateRegistration } from '@/lib/hypotheses';
import type {
  RegisterHypothesisInput,
  RegistrationRejection,
  VerdictMap,
} from '@/lib/hypotheses';
import type { ClientInsight } from '@/lib/intelligence/types';
import { costToFloor, infoValue, round2 } from './info-value';
import { assessMaturity } from './maturity';
import {
  KIND_PRIORITY,
  type HypothesisCandidate,
  type InfoValueBreakdown,
  type SlateDeferral,
  type SlatePlan,
  type SlateSelection,
  type UnitCosts,
} from './types';

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const ceil2 = (n: number): number => Math.ceil(n * 100) / 100;

/**
 * Horizon days used when a candidate declares only max_spend: the slate is
 * replanned by the WEEKLY heartbeat, so a test without a day bound is planned
 * to reach its floor within one planning cycle.
 */
export const DEFAULT_SLATE_HORIZON_DAYS = 7;

export interface PlanSlateInput {
  candidates:     HypothesisCandidate[];
  /** The client's active atoms (maturity + belief-movement inputs). */
  insights:       ClientInsight[];
  /** The client's WHOLE daily budget; the explore slate takes maturity share of it. */
  dailyBudgetIls: number;
  unitCosts:      UnitCosts;
}

// ── the §7 resolvability reuse ────────────────────────────────────────────────

/** The validateRegistration rejection codes that answer the BUDGET question. */
const BUDGET_REJECTIONS: ReadonlySet<string> = new Set([
  'unresolvable_at_budget',
  'unprojectable_floor',
  'invalid_budget_plan',
]);

/**
 * Reuse C-01's "don't launch unresolvable tests" arithmetic instead of
 * duplicating it: run the candidate through validateRegistration with the
 * given daily budget and keep ONLY the budget-related rejections. For open
 * hypotheses the frozen registration is used verbatim; for drafts, minimal
 * well-formed placeholders fill the registration fields the budget check
 * never reads (they are never persisted — completeness is re-validated at
 * real registration time by registerHypothesisChecked).
 */
function budgetRejections(
  candidate:  HypothesisCandidate,
  dailyBudget: number,
  unitCosts:  UnitCosts,
): RegistrationRejection[] {
  const h = candidate.hypothesis;
  const placeholderVerdicts: VerdictMap = {
    supported:    candidate.insight_ids.map((id) => ({ insight_id: id, polarity: 'positive' as const, weight: 0.5 })),
    refuted:      candidate.insight_ids.map((id) => ({ insight_id: id, polarity: 'negative' as const, weight: 0.5 })),
    inconclusive: [],
  };

  const input: RegisterHypothesisInput = {
    clientId:    h?.client_id ?? 'slate-check',
    ownerUserId: h?.owner_user_id ?? 'slate-check',
    insightIds:  candidate.insight_ids,
    claim:       candidate.claim,
    prediction:  h?.prediction ?? {
      metric:     candidate.floor_spec.metric_grade,
      comparator: 'gte',
      value:      0,
      arm:        'A',
      confidence: 0.5,
    },
    floorSpec:  candidate.floor_spec,
    horizon:    candidate.horizon,
    verdictMap: h?.verdict_map ?? placeholderVerdicts,
    killRules:  h?.kill_rules ?? {},
    testRefs:   h?.test_refs ?? [],
    domain:     candidate.domain,
    budgetPlan: { daily_budget: dailyBudget, arm_count: candidate.arm_count, ...unitCosts },
  };

  const validation = validateRegistration(input);
  if (validation.ok) return [];
  return validation.reasons.filter((r) => BUDGET_REJECTIONS.has(r.code));
}

// ── ordering ──────────────────────────────────────────────────────────────────

interface Scored {
  candidate: HypothesisCandidate;
  score:     InfoValueBreakdown;
}

/**
 * Total order: info value desc, then the skill-§5 kind ladder (contested atoms
 * before fatigue successors, etc.), then id asc — a FULL tie-break chain so
 * shuffled input yields the identical plan.
 */
function rank(a: Scored, b: Scored): number {
  if (a.score.info_value !== b.score.info_value) return b.score.info_value - a.score.info_value;
  const ka = KIND_PRIORITY[a.candidate.kind];
  const kb = KIND_PRIORITY[b.candidate.kind];
  if (ka !== kb) return ka - kb;
  return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
}

const byId = (a: SlateDeferral, b: SlateDeferral): number =>
  a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;

// ── planSlate ─────────────────────────────────────────────────────────────────

/**
 * Design the cycle's test slate:
 *   1. maturity → explore budget (share × daily budget, §5).
 *   2. score every candidate by information value; unprojectable ones defer
 *      with the reason (a floor we cannot project is not launchable, §7).
 *   3. rank; greedily admit candidates whose MIN VIABLE daily budget (cost to
 *      floor ÷ horizon days) still fits the remaining explore budget. A
 *      candidate that cannot reach its floor at the affordable per-test budget
 *      defers WITH the C-01 resolvability math in the reason (§3 capacity).
 *   4. per-test budget = max(min viable, fair share), water-filled so the
 *      total never exceeds the explore budget; any rounding leftover goes to
 *      the top-ranked test (more sample = faster resolution).
 *
 * Degenerate inputs are answered, not thrown: zero/invalid budget → everything
 * deferred with the reason; zero candidates → empty slate with a note.
 */
export function planSlate(input: PlanSlateInput): SlatePlan {
  const { candidates, insights, unitCosts } = input;
  const maturity = assessMaturity(insights);

  const dailyBudget   = isFiniteNum(input.dailyBudgetIls) && input.dailyBudgetIls > 0 ? input.dailyBudgetIls : 0;
  const exploreBudget = round2(dailyBudget * maturity.explore_share);

  if (candidates.length === 0) {
    return {
      selected: [],
      deferred: [],
      maturity,
      explore_budget_ils:  exploreBudget,
      explore_budget_used: 0,
      capacity_note: `no open candidates — ₪${exploreBudget}/day of explore capacity (${maturity.maturity}, ${maturity.explore_share * 100}%) is idle this cycle`,
    };
  }

  const deferred: SlateDeferral[] = [];

  if (exploreBudget <= 0) {
    for (const candidate of candidates) {
      deferred.push({
        candidate,
        reason: `zero explore budget: ₪${dailyBudget}/day × ${maturity.explore_share * 100}% (${maturity.maturity}) = ₪0 — no information capacity this cycle`,
      });
    }
    deferred.sort(byId);
    return {
      selected: [],
      deferred,
      maturity,
      explore_budget_ils:  0,
      explore_budget_used: 0,
      capacity_note: 'zero explore budget — every candidate deferred; testing resumes when a budget exists',
    };
  }

  // ── score ──
  const scored: Scored[] = [];
  for (const candidate of candidates) {
    const result = infoValue(candidate, insights, unitCosts);
    if (result.ok) scored.push({ candidate, score: result.breakdown });
    else deferred.push({ candidate, reason: `not scoreable: ${result.reason}` });
  }
  scored.sort(rank);

  // ── greedy fill ──
  interface Admitted extends Scored { min_viable_daily: number }
  const admitted: Admitted[] = [];
  let committed = 0;

  for (const s of scored) {
    const { candidate, score } = s;
    const days = isFiniteNum(candidate.horizon.max_days) && candidate.horizon.max_days > 0
      ? candidate.horizon.max_days
      : DEFAULT_SLATE_HORIZON_DAYS;
    // ceil2 (not round2): a rounded-DOWN daily budget would project a hair
    // under the floor and flunk its own launch check.
    const minViable = ceil2(score.est_cost_to_floor_ils / days);

    // Structural check first: can the test resolve within its OWN horizon at
    // its own minimum budget (max_spend caps bite here)? Reuses the C-01 math.
    const structural = budgetRejections(candidate, Math.max(minViable, 0.01), unitCosts);
    if (structural.length > 0) {
      deferred.push({
        candidate,
        score,
        reason: `unresolvable within its own horizon: ${structural.map((r) => r.message).join('; ')}`,
      });
      continue;
    }

    const remaining = round2(exploreBudget - committed);
    if (minViable > remaining) {
      const affordable = Math.max(remaining, 0.01);
      const atAffordable = budgetRejections(candidate, affordable, unitCosts);
      const math = atAffordable.length > 0
        ? atAffordable.map((r) => r.message).join('; ')
        : `projected sample at ₪${affordable}/day falls short of the floor within ${days} days`;
      deferred.push({
        candidate,
        score,
        reason:
          `needs ₪${minViable}/day to reach its floor in ${days} days but only ₪${remaining}/day of ` +
          `explore budget remains — ${math}`,
      });
      continue;
    }

    admitted.push({ ...s, min_viable_daily: minViable });
    committed = round2(committed + minViable);
  }

  // ── budget assignment: max(min viable, fair share), water-filled ──
  const selected: SlateSelection[] = admitted.map((a) => ({
    candidate:        a.candidate,
    score:            a.score,
    daily_budget:     a.min_viable_daily,
    min_viable_daily: a.min_viable_daily,
  }));

  if (selected.length > 0) {
    const fair = exploreBudget / selected.length;
    let leftover = round2(exploreBudget - committed);
    for (const sel of selected) {
      if (leftover <= 0) break;
      if (sel.daily_budget < fair) {
        const topUp = Math.min(round2(fair - sel.daily_budget), leftover);
        sel.daily_budget = round2(sel.daily_budget + topUp);
        leftover = round2(leftover - topUp);
      }
    }
    // Whatever water-filling could not place goes to the top-ranked test.
    if (leftover > 0) selected[0].daily_budget = round2(selected[0].daily_budget + leftover);
  }

  const used = round2(selected.reduce((sum, s) => sum + s.daily_budget, 0));
  deferred.sort(byId);

  return {
    selected,
    deferred,
    maturity,
    explore_budget_ils:  exploreBudget,
    explore_budget_used: used,
    capacity_note:
      `explore capacity ₪${exploreBudget}/day (${maturity.maturity}, ${maturity.explore_share * 100}% of ` +
      `₪${dailyBudget}/day): ${selected.length} selected, ${deferred.length} deferred — the slate is sized ` +
      `to the budget's information capacity, not to ambition (§3)`,
  };
}
