// tests/master-studio/credit-cost.test.ts
import { describe, it, expect } from 'vitest';
import { CREDIT_COSTS } from '@/types';

describe('master_post credit cost', () => {
  it('is 6 for the best-of-N pipeline', () => {
    expect(CREDIT_COSTS.master_post).toBe(6);
  });
});
