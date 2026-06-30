// tests/master-studio/index.test.ts
import { describe, it, expect } from 'vitest';
import { xt, parseList, parsePrinciples, stripFence, deriveFunnelStage, MASTER_NOTES_MAX } from '@/lib/master-studio';

describe('xt', () => {
  it('extracts tag content and trims', () => {
    expect(xt('a[POST]  hi  [/POST]b', 'POST')).toBe('hi');
  });
  it('returns empty string when tag missing', () => {
    expect(xt('nothing', 'POST')).toBe('');
  });
});

describe('parseList', () => {
  it('strips bullets/digits and drops empties', () => {
    expect(parseList('- one\n2. two\n\n• three')).toEqual(['one', 'two', 'three']);
  });
});

describe('parsePrinciples', () => {
  it('parses the "עקרון: X → איך התבטא: Y" shape', () => {
    const out = parsePrinciples('- עקרון: "ندرة" → איך התבטא: הוספתי טיימר');
    expect(out[0].principle).toBe('ندرة');
    expect(out[0].application).toBe('הוספתי טיימר');
  });
  it('falls back to arrow split', () => {
    const out = parsePrinciples('- proof → added testimonials');
    expect(out[0]).toEqual({ principle: 'proof', application: 'added testimonials' });
  });
});

describe('stripFence', () => {
  it('removes ```json fences', () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('MASTER_NOTES_MAX', () => {
  it('is 2000', () => { expect(MASTER_NOTES_MAX).toBe(2000); });
});

describe('deriveFunnelStage', () => {
  it('maps conversion/offer types to BOFU', () => {
    expect(deriveFunnelStage('מבצע')).toBe('BOFU');
    expect(deriveFunnelStage('sale')).toBe('BOFU');
    expect(deriveFunnelStage('Special Offer')).toBe('BOFU');
  });
  it('maps trust / product-consideration types to MOFU', () => {
    expect(deriveFunnelStage('בניית אמון')).toBe('MOFU');
    expect(deriveFunnelStage('הצגת מוצר')).toBe('MOFU');
    expect(deriveFunnelStage('product showcase')).toBe('MOFU');
  });
  it('defaults awareness/tips/engagement/empty to TOFU', () => {
    expect(deriveFunnelStage('טיפ מקצועי')).toBe('TOFU');
    expect(deriveFunnelStage('שאלה לקהל')).toBe('TOFU');
    expect(deriveFunnelStage(undefined)).toBe('TOFU');
    expect(deriveFunnelStage('')).toBe('TOFU');
  });
});
