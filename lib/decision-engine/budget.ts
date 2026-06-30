// lib/decision-engine/budget.ts
//
// Daily-budget heuristic. Pure + deterministic.
//
//   • If the client carries a monthly budget, the daily budget is monthly/30,
//     clamped to the per-stage floor.
//   • Otherwise we fall back to a per-funnel-stage base (TOFU spends widest for
//     reach, BOFU spends tightest for efficient conversion), scaled by how
//     confident we are in the chosen angle (a stronger conviction earns a
//     larger spend), and rounded to a clean increment.
import type { DecisionClientContext, FunnelStage } from './types';

export const BUDGET = {
  /** Per-stage base daily spend (ILS) when no client budget is given. */
  BASE: { TOFU: 80, MOFU: 60, BOFU: 50 } as Record<FunnelStage, number>,
  /** Per-stage minimum daily spend (the floor for the monthly-derived path too). */
  FLOOR: { TOFU: 50, MOFU: 40, BOFU: 30 } as Record<FunnelStage, number>,
  /** Days used to convert a monthly budget into a daily one. */
  DAYS_IN_MONTH: 30,
  /** Confidence scaling: daily = base * (MIN + SPAN * angleConfidence). */
  CONFIDENCE_MIN_FACTOR: 0.75,
  CONFIDENCE_SPAN:       0.50,
  /** Round daily budgets to this increment for clean numbers. */
  ROUND_TO: 5,
} as const;

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

export interface BudgetResult {
  daily_budget: number;
  rationale:    string;
}

/**
 * Recommend a daily budget for a decision.
 * @param funnelStage      drives the base/floor.
 * @param angleConfidence  conviction in the chosen angle (0..1) — scales spend.
 * @param client           optional monthly-budget override.
 */
export function recommendBudget(opts: {
  funnelStage:     FunnelStage;
  angleConfidence: number;
  client?:         DecisionClientContext | null;
}): BudgetResult {
  const { funnelStage, client } = opts;
  const confidence = Number.isFinite(opts.angleConfidence)
    ? Math.max(0, Math.min(1, opts.angleConfidence))
    : 0.5;
  const floor = BUDGET.FLOOR[funnelStage];

  const monthly = client?.monthly_budget;
  if (typeof monthly === 'number' && Number.isFinite(monthly) && monthly > 0) {
    const daily = Math.max(floor, roundTo(monthly / BUDGET.DAYS_IN_MONTH, BUDGET.ROUND_TO));
    return {
      daily_budget: daily,
      rationale: `Daily budget ₪${daily} = monthly ₪${monthly} / ${BUDGET.DAYS_IN_MONTH} (floored at ₪${floor} for ${funnelStage}).`,
    };
  }

  const base   = BUDGET.BASE[funnelStage];
  const factor = BUDGET.CONFIDENCE_MIN_FACTOR + BUDGET.CONFIDENCE_SPAN * confidence;
  const daily  = Math.max(floor, roundTo(base * factor, BUDGET.ROUND_TO));
  return {
    daily_budget: daily,
    rationale: `Daily budget ₪${daily} = ${funnelStage} base ₪${base} scaled by angle confidence ${(Math.round(confidence * 100) / 100)}.`,
  };
}
