// tests/organic-perf/verdict.test.ts — deterministic verdict math boundaries.

import { describe, it, expect } from 'vitest';
import {
  computeOrganicVerdict,
  organicEngagementRate,
  ORGANIC_WORKED_MIN_ER,
  ORGANIC_UNDERPERFORMED_MIN_ER,
  ORGANIC_MIN_REACH_FOR_VERDICT,
} from '@/lib/organic-perf';

describe('organicEngagementRate', () => {
  it('is engaged / reach', () => {
    expect(organicEngagementRate(5, 100)).toBe(0.05);
    expect(organicEngagementRate(3, 150)).toBe(0.02);
  });

  it('degrades to 0 on zero/negative reach and non-finite inputs', () => {
    expect(organicEngagementRate(5, 0)).toBe(0);
    expect(organicEngagementRate(5, -10)).toBe(0);
    expect(organicEngagementRate(NaN, 100)).toBe(0);
    expect(organicEngagementRate(5, NaN)).toBe(0);
  });
});

describe('computeOrganicVerdict', () => {
  it('exports the documented constants', () => {
    expect(ORGANIC_WORKED_MIN_ER).toBe(0.05);
    expect(ORGANIC_UNDERPERFORMED_MIN_ER).toBe(0.02);
    expect(ORGANIC_MIN_REACH_FOR_VERDICT).toBe(50);
  });

  it('er >= 0.05 → worked (boundary inclusive)', () => {
    expect(computeOrganicVerdict({ reach: 100, engaged: 5 })).toBe('worked');   // exactly 0.05
    expect(computeOrganicVerdict({ reach: 100, engaged: 6 })).toBe('worked');
    expect(computeOrganicVerdict({ reach: 1000, engaged: 500 })).toBe('worked');
  });

  it('0.02 <= er < 0.05 → underperformed (both boundaries)', () => {
    expect(computeOrganicVerdict({ reach: 100, engaged: 2 })).toBe('underperformed'); // exactly 0.02
    expect(computeOrganicVerdict({ reach: 1000, engaged: 49 })).toBe('underperformed'); // 0.049
  });

  it('er < 0.02 → failed', () => {
    expect(computeOrganicVerdict({ reach: 1000, engaged: 19 })).toBe('failed'); // 0.019
    expect(computeOrganicVerdict({ reach: 100, engaged: 0 })).toBe('failed');
  });

  it('reach < 50 → null (insufficient data — do not judge noise)', () => {
    expect(computeOrganicVerdict({ reach: 49, engaged: 49 })).toBeNull(); // er = 1.0 but noise
    expect(computeOrganicVerdict({ reach: 0, engaged: 0 })).toBeNull();
    expect(computeOrganicVerdict({ reach: 1, engaged: 0 })).toBeNull();
  });

  it('reach exactly 50 IS judged', () => {
    expect(computeOrganicVerdict({ reach: 50, engaged: 3 })).toBe('worked'); // 0.06
    expect(computeOrganicVerdict({ reach: 50, engaged: 1 })).toBe('underperformed'); // 0.02
    expect(computeOrganicVerdict({ reach: 50, engaged: 0 })).toBe('failed');
  });

  it('non-finite reach → null, never a fake verdict', () => {
    expect(computeOrganicVerdict({ reach: NaN, engaged: 10 })).toBeNull();
  });
});
