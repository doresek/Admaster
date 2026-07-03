import { describe, it, expect } from 'vitest';
import {
  isStrategyAnalysis,
  parseStrategyAnalysis,
  safeJsonParse,
  isRecord,
  isStringArray,
} from '@/lib/validation';
import type { StrategyAnalysis } from '@/lib/analyze-brief';

// A fully-shaped, valid StrategyAnalysis (the shape persisted as
// client_strategy.business_analysis and fed to the decision engine).
function validStrategy(): StrategyAnalysis {
  return {
    strategic_summary: {
      goal: 'הגדלת מכירות',
      core_offer: 'קורס דיגיטלי',
      usp: 'ליווי אישי',
      constraints: ['תקציב מוגבל', 'עונתיות'],
    },
    sub_audience: {
      name: 'הורים עסוקים',
      awareness_level: 'Problem-aware',
      persona: 'הורה בשנות ה-30',
      explanation: 'נקודת התחלה טובה',
    },
    platform_funnel: {
      platform: 'Meta',
      ad_format: 'Reels',
      funnel_type: 'lead-gen',
      platform_reason: 'קהל גדול',
      format_reason: 'engagement גבוה',
      funnel_reason: 'איסוף לידים',
    },
    offer_stack: {
      components: ['מודול 1', 'מודול 2'],
      strengths: ['תוצאות מהירות'],
      assessment: 'הצעה חזקה',
    },
    raw_text: '[STRATEGIC_SUMMARY]...[/OFFER_STACK]',
  };
}

describe('isStrategyAnalysis', () => {
  it('accepts a fully-shaped strategy', () => {
    expect(isStrategyAnalysis(validStrategy())).toBe(true);
  });

  it('accepts empty-string / empty-array fields (thin but structurally valid)', () => {
    const thin = validStrategy();
    thin.strategic_summary.goal = '';
    thin.strategic_summary.constraints = [];
    thin.offer_stack.components = [];
    expect(isStrategyAnalysis(thin)).toBe(true);
  });

  it.each([null, undefined, 42, 'str', [], {}])('rejects non-strategy value %p', (bad) => {
    expect(isStrategyAnalysis(bad)).toBe(false);
  });

  it('rejects a missing nested object', () => {
    const s: any = validStrategy();
    delete s.platform_funnel;
    expect(isStrategyAnalysis(s)).toBe(false);
  });

  it('rejects a null required field', () => {
    const s: any = validStrategy();
    s.sub_audience.awareness_level = null;
    expect(isStrategyAnalysis(s)).toBe(false);
  });

  it('rejects a wrongly-typed list field (constraints not a string[])', () => {
    const s: any = validStrategy();
    s.strategic_summary.constraints = 'not-an-array';
    expect(isStrategyAnalysis(s)).toBe(false);
  });

  it('rejects a list field containing non-strings', () => {
    const s: any = validStrategy();
    s.offer_stack.components = ['ok', 3];
    expect(isStrategyAnalysis(s)).toBe(false);
  });

  it('rejects a missing raw_text', () => {
    const s: any = validStrategy();
    delete s.raw_text;
    expect(isStrategyAnalysis(s)).toBe(false);
  });
});

describe('parseStrategyAnalysis', () => {
  it('returns the object when valid', () => {
    const s = validStrategy();
    expect(parseStrategyAnalysis(s)).toBe(s);
  });

  it('returns null on a structural mismatch', () => {
    const s: any = validStrategy();
    s.strategic_summary = { goal: 'x' }; // missing core_offer/usp/constraints
    expect(parseStrategyAnalysis(s)).toBeNull();
  });

  it('returns null on null / undefined (the empty-strategy DB case)', () => {
    expect(parseStrategyAnalysis(null)).toBeNull();
    expect(parseStrategyAnalysis(undefined)).toBeNull();
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON without a guard', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null on invalid JSON (never throws)', () => {
    expect(safeJsonParse('not json')).toBeNull();
    expect(safeJsonParse('{ broken')).toBeNull();
  });

  it('returns the value when the guard passes', () => {
    expect(safeJsonParse('{"x":1}', isRecord)).toEqual({ x: 1 });
  });

  it('returns null when valid JSON fails the guard', () => {
    expect(safeJsonParse('[1,2,3]', isRecord)).toBeNull();
    expect(safeJsonParse('42', isRecord)).toBeNull();
  });

  it('composes with a domain guard end-to-end', () => {
    const json = JSON.stringify(validStrategy());
    expect(safeJsonParse(json, isStrategyAnalysis)).not.toBeNull();
    expect(safeJsonParse('{"partial":true}', isStrategyAnalysis)).toBeNull();
  });
});

describe('helper guards', () => {
  it('isRecord', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
  it('isStringArray', () => {
    expect(isStringArray(['a', 'b'])).toBe(true);
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['a', 1])).toBe(false);
    expect(isStringArray('a')).toBe(false);
  });
});
