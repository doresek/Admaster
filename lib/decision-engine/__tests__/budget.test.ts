import { describe, it, expect } from 'vitest';
import { recommendBudget, BUDGET } from '../budget';

describe('recommendBudget', () => {
  it('derives daily from monthly budget (monthly/30), floored per stage', () => {
    expect(recommendBudget({ funnelStage: 'BOFU', angleConfidence: 0.5, client: { monthly_budget: 3000 } }).daily_budget).toBe(100);
    // tiny monthly budget is floored
    const tiny = recommendBudget({ funnelStage: 'TOFU', angleConfidence: 0.5, client: { monthly_budget: 100 } });
    expect(tiny.daily_budget).toBe(BUDGET.FLOOR.TOFU);
  });

  it('scales the stage base by angle confidence when no client budget', () => {
    const low  = recommendBudget({ funnelStage: 'TOFU', angleConfidence: 0.1 });
    const high = recommendBudget({ funnelStage: 'TOFU', angleConfidence: 0.95 });
    expect(high.daily_budget).toBeGreaterThan(low.daily_budget);
  });

  it('never goes below the per-stage floor', () => {
    const d = recommendBudget({ funnelStage: 'BOFU', angleConfidence: 0 });
    expect(d.daily_budget).toBeGreaterThanOrEqual(BUDGET.FLOOR.BOFU);
  });

  it('rounds to a clean increment and includes a rationale', () => {
    const d = recommendBudget({ funnelStage: 'MOFU', angleConfidence: 0.63 });
    expect(d.daily_budget % BUDGET.ROUND_TO).toBe(0);
    expect(d.rationale).toMatch(/Daily budget/);
  });

  it('handles a non-finite confidence gracefully', () => {
    const d = recommendBudget({ funnelStage: 'TOFU', angleConfidence: NaN });
    expect(Number.isFinite(d.daily_budget)).toBe(true);
  });
});
