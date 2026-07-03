// lib/voc/pii — PII stripping: robust on phones/emails/URLs, supplied-names
// exact matching (whitespace + gershayim tolerant), idempotent, and — just as
// important — NOT over-eager: metric values, prices, times and dates survive.

import { describe, expect, it } from 'vitest';
import { stripPii } from '../pii';

describe('stripPii — phones', () => {
  it('strips Israeli mobile numbers in common separator styles', () => {
    expect(stripPii('התקשרו 050-1234567 עכשיו')).toBe('התקשרו {phone} עכשיו');
    expect(stripPii('נייד: 0501234567')).toBe('נייד: {phone}');
    expect(stripPii('טל 052 123 4567')).toBe('טל {phone}');
    expect(stripPii('משרד: 03-1234567')).toBe('משרד: {phone}');
  });

  it('strips +972 and generic international formats', () => {
    expect(stripPii('חייגו +972-50-123-4567')).toBe('חייגו {phone}');
    expect(stripPii('call +14155551234')).toBe('call {phone}');
  });

  it('does NOT strip prices, times, dates or short numbers', () => {
    expect(stripPii('שילמתי 12,000 ₪ ב-15.3.2024')).toBe('שילמתי 12,000 ₪ ב-15.3.2024');
    expect(stripPii('נפתח ב-05:30 בבוקר')).toBe('נפתח ב-05:30 בבוקר');
    expect(stripPii('בתאריך 2026-06-05 הגעתי')).toBe('בתאריך 2026-06-05 הגעתי');
    expect(stripPii('חיכיתי 45 דקות')).toBe('חיכיתי 45 דקות');
  });
});

describe('stripPii — emails and URLs', () => {
  it('strips emails', () => {
    expect(stripPii('כתבו לי ruti.cohen@gmail.com תודה')).toBe('כתבו לי {email} תודה');
  });

  it('strips URLs (https and www), URLs before emails inside them', () => {
    expect(stripPii('ראו https://example.co.il/reviews?id=1 מומלץ')).toBe('ראו {url} מומלץ');
    expect(stripPii('באתר www.dental.co.il יש הכל')).toBe('באתר {url} יש הכל');
  });
});

describe('stripPii — supplied names', () => {
  it('strips supplied names case/whitespace tolerant across a run of spaces', () => {
    const out = stripPii('טופלתי אצל רותי   כהן והיה מצוין', { names: ['רותי כהן'] });
    expect(out).toBe('טופלתי אצל {name} והיה מצוין');
  });

  it('matches Hebrew gershayim variants (ד"ר with ", ״, ”)', () => {
    const names = ['ד"ר לוי'];
    expect(stripPii('הייתי אצל ד"ר לוי אתמול', { names })).toBe('הייתי אצל {name} אתמול');
    expect(stripPii('הייתי אצל ד״ר לוי אתמול', { names })).toBe('הייתי אצל {name} אתמול');
  });

  it('ignores blank name entries and leaves unrelated names alone', () => {
    expect(stripPii('דיברתי עם מיכל', { names: ['   '] })).toBe('דיברתי עם מיכל');
  });
});

describe('stripPii — idempotence and edges', () => {
  it('stripping twice equals stripping once', () => {
    const input = 'רותי כהן 050-1234567 ruti@gmail.com https://a.co.il ב-15.3.2024';
    const once = stripPii(input, { names: ['רותי כהן'] });
    expect(stripPii(once, { names: ['רותי כהן'] })).toBe(once);
    expect(once).toContain('{phone}');
    expect(once).toContain('{email}');
    expect(once).toContain('{url}');
    expect(once).toContain('{name}');
    expect(once).toContain('15.3.2024');
  });

  it('handles empty/non-string input safely', () => {
    expect(stripPii('')).toBe('');
  });
});
