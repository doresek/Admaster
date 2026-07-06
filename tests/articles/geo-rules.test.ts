// tests/articles/geo-rules.test.ts — P3-3: the deterministic §3.1 GEO gate.
// Each rule pass/fail individually + the ≥3-facts count with tagged facts.

import { describe, expect, it } from 'vitest';
import {
  countFacts, countWords, extractH2s, extractOpening, isQuestionH2,
  runGeoGate, stripFactTags,
  HEBREW_QUESTION_WORDS, MIN_INFO_GAIN_FACTS, OPENING_MAX_WORDS, OPENING_MIN_WORDS,
} from '@/lib/articles/geo-rules';

const words = (n: number, w = 'מילה') => Array(n).fill(w).join(' ');

/** A body that passes every rule (commercial, year 2026). */
function passingBody(): string {
  return [
    '# כמה עולה טיפול שורש 2026',
    '',
    words(50),
    '',
    '## כמה עולה טיפול שורש בחיפה?',
    'המחיר הוא [FACT]1,200 ש"ח לשן קדמית[/FACT] במרפאה.',
    '',
    '## איך בוחרים רופא שיניים?',
    'לפי ניסיון: [FACT]מעל 15 שנות ניסיון[/FACT] ולפי ביקורות: [FACT]4.9 כוכבים מ-212 ביקורות[/FACT].',
    '',
    '## האם הטיפול כואב?',
    'לא. ההרדמה מקומית והטיפול קצר.',
  ].join('\n');
}

describe('countWords / isQuestionH2', () => {
  it('counts whitespace-separated tokens', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  שלום   עולם ')).toBe(2);
    expect(countWords(words(40))).toBe(40);
  });

  it('accepts H2s ending with ?', () => {
    expect(isQuestionH2('טיפול שורש — כדאי או לא?')).toBe(true);
  });

  it.each(HEBREW_QUESTION_WORDS)('accepts H2 starting with question word %s', (qw) => {
    expect(isQuestionH2(`${qw} עושים את זה נכון`)).toBe(true);
  });

  it('rejects declarative H2s', () => {
    expect(isQuestionH2('המחירים שלנו')).toBe(false);
    expect(isQuestionH2('')).toBe(false);
    // A question word embedded mid-heading is not enough.
    expect(isQuestionH2('כל מה שרציתם לדעת')).toBe(false);
  });
});

describe('fact counting + stripping', () => {
  it('counts unique non-empty facts only (repetition does not game the gate)', () => {
    const md = '[FACT]א[/FACT] [FACT]ב[/FACT] [FACT]א[/FACT] [FACT]  [/FACT] [FACT]ג[/FACT]';
    expect(countFacts(md)).toBe(3);
  });

  it('strips tags but keeps the content', () => {
    expect(stripFactTags('המחיר [FACT]1,200 ש"ח[/FACT] בלבד')).toBe('המחיר 1,200 ש"ח בלבד');
    expect(stripFactTags('ללא עובדות')).toBe('ללא עובדות');
  });
});

describe('opening + H2 extraction', () => {
  it('extracts the text between H1 and the first H2', () => {
    const body = '# כותרת\n\nפתיח שורה 1\nפתיח שורה 2\n\n## שאלה?\nגוף';
    expect(extractOpening(body)).toBe('פתיח שורה 1\nפתיח שורה 2');
  });

  it('extracts all ## headings (and only ##)', () => {
    expect(extractH2s(passingBody())).toEqual([
      'כמה עולה טיפול שורש בחיפה?',
      'איך בוחרים רופא שיניים?',
      'האם הטיפול כואב?',
    ]);
  });
});

describe('runGeoGate — each rule individually', () => {
  const base = { title: 'כמה עולה טיפול שורש 2026', intent: 'commercial' as const, currentYear: 2026 };

  it('passes a fully compliant commercial article', () => {
    const r = runGeoGate({ ...base, bodyMd: passingBody() });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.factCount).toBe(3);
    expect(r.bodyMd).not.toContain('[FACT]');
    expect(r.bodyMd).toContain('1,200 ש"ח לשן קדמית');
  });

  it('fails opening_word_count when the opening is too short', () => {
    const body = passingBody().replace(words(50), words(OPENING_MIN_WORDS - 1));
    const r = runGeoGate({ ...base, bodyMd: body });
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.rule)).toEqual(['opening_word_count']);
  });

  it('fails opening_word_count when the opening is too long', () => {
    const body = passingBody().replace(words(50), words(OPENING_MAX_WORDS + 1));
    const r = runGeoGate({ ...base, bodyMd: body });
    expect(r.failures.map((f) => f.rule)).toEqual(['opening_word_count']);
  });

  it('fails question_h2 when any H2 is declarative', () => {
    const body = passingBody().replace('## האם הטיפול כואב?', '## המלצות מטופלים');
    const r = runGeoGate({ ...base, bodyMd: body });
    expect(r.failures.map((f) => f.rule)).toEqual(['question_h2']);
    expect(r.failures[0].message_he).toContain('המלצות מטופלים');
  });

  it(`fails information_gain below ${MIN_INFO_GAIN_FACTS} unique facts`, () => {
    const body = passingBody().replace('[FACT]4.9 כוכבים מ-212 ביקורות[/FACT]', '4.9 כוכבים');
    const r = runGeoGate({ ...base, bodyMd: body });
    expect(r.factCount).toBe(2);
    expect(r.failures.map((f) => f.rule)).toEqual(['information_gain']);
  });

  it('fails current_year_title for commercial intent without the year', () => {
    const body = passingBody().replace('# כמה עולה טיפול שורש 2026', '# כמה עולה טיפול שורש');
    const r = runGeoGate({ ...base, bodyMd: body });
    expect(r.failures.map((f) => f.rule)).toEqual(['current_year_title']);
  });

  it('does NOT require the year for non-commercial intent', () => {
    const body = passingBody().replace('# כמה עולה טיפול שורש 2026', '# כמה עולה טיפול שורש');
    const r = runGeoGate({ ...base, bodyMd: body, intent: 'informational' });
    expect(r.ok).toBe(true);
  });

  it('uses the injected year — no Date.now() coupling', () => {
    const r = runGeoGate({ ...base, bodyMd: passingBody(), currentYear: 2031 });
    expect(r.failures.map((f) => f.rule)).toEqual(['current_year_title']);
  });

  it('collects multiple failures at once', () => {
    const body = [
      '# כותרת בלי שנה',
      '',
      words(5),
      '',
      '## סקשן רגיל',
      'ללא עובדות.',
    ].join('\n');
    const r = runGeoGate({ ...base, bodyMd: body });
    expect(r.ok).toBe(false);
    expect(new Set(r.failures.map((f) => f.rule))).toEqual(new Set([
      'opening_word_count', 'question_h2', 'information_gain', 'current_year_title',
    ]));
  });
});
