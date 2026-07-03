// calendar.test.ts — the Israeli calendar overlay: window lookup + shock matching.

import { describe, expect, it } from 'vitest';
import { expectedShock, ISRAELI_MARKET_WINDOWS, windowMatchesShock } from '../calendar';
import type { CalendarWindow } from '../types';

const windowByLabel = (label: string): CalendarWindow => {
  const w = ISRAELI_MARKET_WINDOWS.find((x) => x.label === label);
  if (!w) throw new Error(`test setup: no window labeled ${label}`);
  return w;
};

describe('expectedShock — window lookup', () => {
  it('Sep 20 falls in חגי תשרי', () => {
    expect(expectedShock('2026-09-20')?.label).toBe('חגי תשרי');
  });

  it('tishrei boundaries are inclusive: Sep 15 and Oct 15 in, Sep 14 and Oct 16 out', () => {
    expect(expectedShock('2026-09-15')?.label).toBe('חגי תשרי');
    expect(expectedShock('2026-10-15')?.label).toBe('חגי תשרי');
    expect(expectedShock('2026-09-14')).toBeNull();
    expect(expectedShock('2026-10-16')).toBeNull();
  });

  it('quiet months have no window (February, June)', () => {
    expect(expectedShock('2026-02-10')).toBeNull();
    expect(expectedShock('2026-06-10')).toBeNull();
  });

  it('memorial-days window covers late April (attention_down)', () => {
    const w = expectedShock('2026-04-25');
    expect(w?.label).toBe('ימי הזיכרון והעצמאות');
    expect(w?.expected).toBe('attention_down');
  });

  it('pre-Pesach and memorial windows abut without overlap (Apr 15 vs Apr 16)', () => {
    expect(expectedShock('2026-04-15')?.label).toBe('לפני פסח ופסח');
    expect(expectedShock('2026-04-16')?.label).toBe('ימי הזיכרון והעצמאות');
  });

  it('year is irrelevant — only month-day decides (documented approximation)', () => {
    expect(expectedShock('2031-12-20')?.label).toBe('חנוכה');
  });

  it('throws on malformed dates instead of answering "no window"', () => {
    expect(() => expectedShock('20-09-2026')).toThrow(RangeError);
    expect(() => expectedShock('september 20')).toThrow(RangeError);
  });

  it('the table itself has no overlapping windows (at most one match per day)', () => {
    // Lexicographic MM-DD comparison is only sound if windows never overlap;
    // guard the invariant so a future window edit can't silently break lookup.
    for (const a of ISRAELI_MARKET_WINDOWS) {
      for (const b of ISRAELI_MARKET_WINDOWS) {
        if (a === b) continue;
        const disjoint =
          a.month_day_end < b.month_day_start || b.month_day_end < a.month_day_start;
        expect(disjoint, `${a.label} overlaps ${b.label}`).toBe(true);
      }
    }
  });
});

describe('windowMatchesShock — expectation vs observation', () => {
  it('cpm_up windows match rising cpm and rising spend only', () => {
    const tishrei = windowByLabel('חגי תשרי');
    expect(windowMatchesShock(tishrei, 'cpm', 'up')).toBe(true);
    expect(windowMatchesShock(tishrei, 'spend', 'up')).toBe(true);
    expect(windowMatchesShock(tishrei, 'cpm', 'down')).toBe(false);   // CPM crash in a chag ≠ expected
    expect(windowMatchesShock(tishrei, 'ctr', 'down')).toBe(false);   // says nothing about engagement
  });

  it('attention_down windows match falling ctr/cvr only', () => {
    const memorial = windowByLabel('ימי הזיכרון והעצמאות');
    expect(windowMatchesShock(memorial, 'ctr', 'down')).toBe(true);
    expect(windowMatchesShock(memorial, 'cvr', 'down')).toBe(true);
    expect(windowMatchesShock(memorial, 'ctr', 'up')).toBe(false);
    expect(windowMatchesShock(memorial, 'cpm', 'up')).toBe(false);
  });

  it('mixed windows match any shock (the window explains movement either way)', () => {
    const summer = windowByLabel('החופש הגדול');
    expect(windowMatchesShock(summer, 'cpm', 'up')).toBe(true);
    expect(windowMatchesShock(summer, 'ctr', 'down')).toBe(true);
    expect(windowMatchesShock(summer, 'cvr', 'up')).toBe(true);
  });
});
