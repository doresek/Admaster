import { describe, it, expect } from 'vitest';
import {
  BATCH_TYPES, BATCH_HOOKS, BATCH_MIN, BATCH_MAX,
  isValidBatchCount, planBatchVariations, settleBatch,
} from '@/lib/generation-queue/batch';

describe('isValidBatchCount', () => {
  it('accepts integers in [BATCH_MIN, BATCH_MAX]', () => {
    for (let n = BATCH_MIN; n <= BATCH_MAX; n++) expect(isValidBatchCount(n)).toBe(true);
  });

  it('rejects out-of-range, non-integer and non-number values', () => {
    expect(isValidBatchCount(1)).toBe(false);
    expect(isValidBatchCount(6)).toBe(false);
    expect(isValidBatchCount(0)).toBe(false);
    expect(isValidBatchCount(-3)).toBe(false);
    expect(isValidBatchCount(2.5)).toBe(false);
    expect(isValidBatchCount('3')).toBe(false);
    expect(isValidBatchCount(undefined)).toBe(false);
    expect(isValidBatchCount(null)).toBe(false);
    expect(isValidBatchCount(NaN)).toBe(false);
  });
});

describe('planBatchVariations', () => {
  it('is deterministic and returns exactly `count` variations', () => {
    const a = planBatchVariations(4, { type: 'בניית אמון' });
    const b = planBatchVariations(4, { type: 'בניית אמון' });
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
  });

  it('starts the type rotation at the user-chosen type', () => {
    for (const t of BATCH_TYPES) {
      expect(planBatchVariations(3, { type: t })[0].type).toBe(t);
    }
  });

  it('falls back to the first type for unknown / missing base type', () => {
    expect(planBatchVariations(2)[0].type).toBe(BATCH_TYPES[0]);
    expect(planBatchVariations(2, { type: 'לא קיים' })[0].type).toBe(BATCH_TYPES[0]);
    expect(planBatchVariations(2, { type: null })[0].type).toBe(BATCH_TYPES[0]);
  });

  it('gives every run a DISTINCT type and a DISTINCT hook (a varied week, not clones)', () => {
    for (let count = BATCH_MIN; count <= BATCH_MAX; count++) {
      for (const base of [undefined, { type: 'מבצע' }, { type: 'שאלה לקהל' }]) {
        const plan = planBatchVariations(count, base);
        expect(new Set(plan.map(v => v.type)).size).toBe(count);
        expect(new Set(plan.map(v => v.hook)).size).toBe(count);
      }
    }
  });

  it('only uses vocabulary from the known type/hook lists', () => {
    const plan = planBatchVariations(5, { type: 'טיפ מקצועי' });
    for (const v of plan) {
      expect(BATCH_TYPES).toContain(v.type);
      expect(BATCH_HOOKS).toContain(v.hook);
    }
  });
});

describe('settleBatch (refund math)', () => {
  const unitCost = 6;

  it('refunds nothing when every run succeeded', () => {
    const s = settleBatch({ okFlags: [true, true, true], unitCost, creditsAfterDeduct: 82 });
    expect(s).toEqual({ succeeded: 3, failed: 0, refunded: 0, credits: 82 });
  });

  it('refunds exactly one unit per failed run', () => {
    const s = settleBatch({ okFlags: [true, false, true, false, false], unitCost, creditsAfterDeduct: 70 });
    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(3);
    expect(s.refunded).toBe(3 * unitCost);
    expect(s.credits).toBe(70 + 18);
  });

  it('a wholly-failed batch refunds everything that was deducted up front', () => {
    const count = 4;
    const creditsAfterDeduct = 100 - count * unitCost; // 76
    const s = settleBatch({ okFlags: [false, false, false, false], unitCost, creditsAfterDeduct });
    expect(s.refunded).toBe(count * unitCost);          // full up-front deduction returned
    expect(s.credits).toBe(100);                        // balance restored — never double-charged
    expect(s.succeeded).toBe(0);
  });

  it('never over-refunds: refunded + succeeded×unitCost equals the up-front deduction', () => {
    for (const okFlags of [[true, false], [false, true, true], [true, true, true, true, false]]) {
      const s = settleBatch({ okFlags, unitCost, creditsAfterDeduct: 50 });
      expect(s.refunded + s.succeeded * unitCost).toBe(okFlags.length * unitCost);
    }
  });
});
