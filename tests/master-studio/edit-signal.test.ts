// tests/master-studio/edit-signal.test.ts — G2 capture side: edit → signal mapping.
import { describe, it, expect } from 'vitest';
import { changedFraction, buildEditSignal, EDIT_WRONG_THRESHOLD } from '@/lib/master-studio/edit-signal';

describe('changedFraction', () => {
  it('identical text → 0; full rewrite → 1', () => {
    expect(changedFraction('שלום עולם', 'שלום עולם')).toBe(0);
    expect(changedFraction('אחד שתיים שלוש', 'ארבע חמש שש')).toBe(1);
  });
  it('is deterministic and proportional to the words changed', () => {
    // 1 of 4 words replaced: LCS=3 → 1 − 6/8 = 0.25.
    expect(changedFraction('אחד שתיים שלוש ארבע', 'אחד שתיים שלוש חמש')).toBe(0.25);
    // Whitespace-only differences are not a change.
    expect(changedFraction('אחד  שתיים\nשלוש', 'אחד שתיים שלוש')).toBe(0);
  });
  it('handles empty sides', () => {
    expect(changedFraction('', '')).toBe(0);
    expect(changedFraction('משהו', '')).toBe(1);
    expect(changedFraction('', 'משהו')).toBe(1);
  });
});

describe('buildEditSignal', () => {
  it('null when nothing actually changed or the post was emptied — no signal to send', () => {
    expect(buildEditSignal('פוסט', 'פוסט')).toBeNull();
    expect(buildEditSignal('פוסט', '  פוסט  ')).toBeNull();
    expect(buildEditSignal('פוסט', '')).toBeNull();
    expect(buildEditSignal('פוסט', '   ')).toBeNull();
  });

  it('light edit → "worked" (direction held), with the change % and both versions in detail', () => {
    const original = 'בוקר טוב אמהות יקרות הקורס נפתח מחר בבוקר';
    const edited   = 'בוקר טוב אמהות יקרות הקורס נפתח ביום ראשון';
    const sig = buildEditSignal(original, edited)!;
    expect(sig.kind).toBe('worked');
    expect(sig.changed).toBeLessThan(EDIT_WRONG_THRESHOLD);
    expect(sig.detail).toContain('עריכה ידנית של המשתמש');
    expect(sig.detail).toMatch(/כ-\d+% מהטקסט שונה/);
    expect(sig.detail).toContain('מחר בבוקר');   // before
    expect(sig.detail).toContain('ביום ראשון');  // after
  });

  it('heavy rewrite → "wrong" (the post missed)', () => {
    const sig = buildEditSignal('אחד שתיים שלוש ארבע חמש', 'טקסט חדש לגמרי שנכתב מאפס עכשיו')!;
    expect(sig.kind).toBe('wrong');
    expect(sig.changed).toBeGreaterThanOrEqual(EDIT_WRONG_THRESHOLD);
  });

  it('clips long posts in detail so the signal row stays compact', () => {
    const original = 'מילה '.repeat(100).trim();
    const edited   = 'אחרת '.repeat(100).trim();
    const sig = buildEditSignal(original, edited)!;
    expect(sig.detail.length).toBeLessThan(450);
    expect(sig.detail).toContain('…');
  });
});
