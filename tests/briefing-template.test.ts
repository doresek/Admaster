import { describe, it, expect } from 'vitest';
import {
  BRIEFING_TEMPLATE, BRIEFING_FIELD_KEYS, BRIEFING_REQUIRED_KEYS,
  briefCompletion, isStepComplete,
} from '@/lib/briefing-template';

describe('BRIEFING_TEMPLATE', () => {
  it('has 5 steps with unique field keys', () => {
    expect(BRIEFING_TEMPLATE).toHaveLength(5);
    expect(new Set(BRIEFING_FIELD_KEYS).size).toBe(BRIEFING_FIELD_KEYS.length); // no dup keys
  });
  it('every select field has options', () => {
    BRIEFING_TEMPLATE.flatMap(s => s.fields)
      .filter(f => f.type === 'select')
      .forEach(f => expect(f.options && f.options.length).toBeTruthy());
  });
});

describe('briefCompletion', () => {
  it('is 0 for empty and 100 when all required filled', () => {
    expect(briefCompletion(null)).toBe(0);
    expect(briefCompletion({})).toBe(0);
    const full = Object.fromEntries(BRIEFING_REQUIRED_KEYS.map(k => [k, 'x']));
    expect(briefCompletion(full)).toBe(100);
  });
  it('ignores whitespace-only values', () => {
    const partial = Object.fromEntries(BRIEFING_REQUIRED_KEYS.map(k => [k, '   ']));
    expect(briefCompletion(partial)).toBe(0);
  });
});

describe('isStepComplete', () => {
  it('gates on required fields of that step only', () => {
    const step1 = BRIEFING_TEMPLATE[0];
    expect(isStepComplete(step1, {})).toBe(false);
    const filled = Object.fromEntries(step1.fields.filter(f => f.required).map(f => [f.key, 'v']));
    expect(isStepComplete(step1, filled)).toBe(true);
    // a step with no required fields is always complete
    const linksStep = BRIEFING_TEMPLATE.find(s => s.id === 'links')!;
    expect(isStepComplete(linksStep, {})).toBe(true);
  });
});
