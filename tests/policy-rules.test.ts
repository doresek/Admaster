import { describe, it, expect } from 'vitest';
import { matchMetaPolicy } from '@/lib/policy-rules/meta.he';
import { matchGooglePolicy } from '@/lib/policy-rules/google.he';

describe('matchMetaPolicy (Hebrew)', () => {
  it('flags "100 אחוז הצלחה" as performance guarantee', () => {
    const flags = matchMetaPolicy('100 אחוז הצלחה מובטח');
    expect(flags.some(f => f.type === 'performance_guarantee')).toBe(true);
  });

  it('flags before/after weight loss claims', () => {
    const flags = matchMetaPolicy('לפני ואחרי - ירדתי 15 קילו בחודש');
    expect(flags.some(f => f.type === 'before_after_body')).toBe(true);
  });

  it('returns empty for clean copy', () => {
    expect(matchMetaPolicy('שלום לכולם, הצטרפו לקורס שלנו')).toHaveLength(0);
  });
});

describe('matchGooglePolicy (Hebrew)', () => {
  it('flags excessive caps in headline', () => {
    expect(matchGooglePolicy('!!!מכירת ענק היום בלבד!!!')).toContainEqual(
      expect.objectContaining({ type: 'excessive_punctuation' })
    );
  });

  it('flags trademark phrasing patterns', () => {
    const flags = matchGooglePolicy('פתרון מאת iPhone מקורי');
    expect(flags.some(f => f.type === 'trademark_risk')).toBe(true);
  });
});
