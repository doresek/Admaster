// tests/retention/quiet-windows.test.ts — Shabbat/chag/sending-hours window
// math on FIXED dates (deterministic; `now` injected everywhere).
//
// DST facts used: Israel is UTC+3 (IDT) in May–Oct 2026 and Apr 2027,
// UTC+2 (IST) in Jan 2026. 2026-07-03 is a Friday; 2026-07-04 a Saturday.
import { describe, it, expect } from 'vitest';
import { DEFAULT_RETENTION_POLICY as P } from '@/lib/retention/policy';
import {
  ilWallClock,
  ilToUtc,
  addDaysISO,
  isShabbatWindow,
  shabbatWindowEnd,
  isChagWindow,
  activeChagSpan,
  buildChagSpans,
  isQuietHours,
  nextAllowedSendTime,
  holidayHorizonWarning,
  HOLIDAY_HORIZON_ISO,
} from '@/lib/retention/quiet-windows';

const at = (iso: string) => new Date(iso);

describe('ilWallClock / ilToUtc', () => {
  it('reads the Asia/Jerusalem wall clock (summer, UTC+3)', () => {
    const wc = ilWallClock(at('2026-07-03T11:59:00Z')); // Fri 14:59 IL
    expect(wc).toEqual({ dateISO: '2026-07-03', weekday: 5, minutes: 14 * 60 + 59 });
  });
  it('reads the wall clock in winter (UTC+2)', () => {
    const wc = ilWallClock(at('2026-01-02T13:01:00Z')); // Fri 15:01 IL
    expect(wc).toEqual({ dateISO: '2026-01-02', weekday: 5, minutes: 15 * 60 + 1 });
  });
  it('ilToUtc inverts the wall clock (summer + winter)', () => {
    expect(ilToUtc('2026-07-05', 9 * 60).toISOString()).toBe('2026-07-05T06:00:00.000Z');
    expect(ilToUtc('2026-01-04', 9 * 60).toISOString()).toBe('2026-01-04T07:00:00.000Z');
  });
  it('addDaysISO crosses month ends', () => {
    expect(addDaysISO('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDaysISO('2026-07-01', -1)).toBe('2026-06-30');
  });
});

describe('Shabbat window (Fri 15:00 → Sat 21:00 IL, computed weekly)', () => {
  it('Fri 14:59 IL is allowed', () => {
    expect(isShabbatWindow(at('2026-07-03T11:59:00+03:00'), P)).toBe(false);
  });
  it('Fri 15:00 IL is blocked (boundary in)', () => {
    expect(isShabbatWindow(at('2026-07-03T15:00:00+03:00'), P)).toBe(true);
  });
  it('Fri 15:01 IL is blocked', () => {
    expect(isShabbatWindow(at('2026-07-03T15:01:00+03:00'), P)).toBe(true);
  });
  it('Sat 20:59 IL is blocked', () => {
    expect(isShabbatWindow(at('2026-07-04T20:59:00+03:00'), P)).toBe(true);
  });
  it('Sat 21:00 IL is allowed (boundary out)', () => {
    expect(isShabbatWindow(at('2026-07-04T21:00:00+03:00'), P)).toBe(false);
  });
  it('Sat 21:01 IL is allowed', () => {
    expect(isShabbatWindow(at('2026-07-04T21:01:00+03:00'), P)).toBe(false);
  });
  it('midweek is never Shabbat', () => {
    expect(isShabbatWindow(at('2026-07-01T12:00:00+03:00'), P)).toBe(false); // Wed
  });
  it('works on the WINTER clock too (Fri 2026-01-02, UTC+2)', () => {
    expect(isShabbatWindow(at('2026-01-02T14:59:00+02:00'), P)).toBe(false);
    expect(isShabbatWindow(at('2026-01-02T15:01:00+02:00'), P)).toBe(true);
    expect(isShabbatWindow(at('2026-01-03T21:01:00+02:00'), P)).toBe(false); // Sat night
  });
  it('shabbatWindowEnd is Saturday 21:00 IL', () => {
    expect(shabbatWindowEnd(at('2026-07-03T16:00:00+03:00'), P).toISOString())
      .toBe('2026-07-04T18:00:00.000Z'); // Sat 21:00 IDT
    expect(shabbatWindowEnd(at('2026-07-04T10:00:00+03:00'), P).toISOString())
      .toBe('2026-07-04T18:00:00.000Z'); // already Saturday
  });
});

describe('Yom-Tov windows (IL_HOLIDAYS + chag-days map; חנוכה/פורים excluded)', () => {
  it('builds spans: 2-day רה"ש merged, סוכות split (first day + שמח"ת)', () => {
    const spans = buildChagSpans();
    expect(spans).toContainEqual({ name: 'ראש השנה', start: '2026-09-11', end: '2026-09-12' });
    expect(spans).toContainEqual({ name: 'סוכות', start: '2026-09-25', end: '2026-09-25' });
    expect(spans).toContainEqual({ name: 'סוכות', start: '2026-10-02', end: '2026-10-02' });
    expect(spans).toContainEqual({ name: 'פסח', start: '2027-04-01', end: '2027-04-01' });
    expect(spans).toContainEqual({ name: 'פסח', start: '2027-04-07', end: '2027-04-07' });
    expect(spans.some((s) => s.name === 'חנוכה')).toBe(false);
    expect(spans.some((s) => s.name === 'פורים')).toBe(false);
  });
  it('erev-chag blocks from 15:00 (ערב שבועות, Thu 2026-05-21)', () => {
    expect(isChagWindow(at('2026-05-21T14:00:00+03:00'), P)).toBe(false);
    expect(isChagWindow(at('2026-05-21T15:01:00+03:00'), P)).toBe(true);
  });
  it('the chag day itself is blocked until 21:00 (שבועות, Fri 2026-05-22)', () => {
    expect(isChagWindow(at('2026-05-22T10:00:00+03:00'), P)).toBe(true);
    expect(activeChagSpan(at('2026-05-22T10:00:00+03:00'), P)?.name).toBe('שבועות');
    expect(isChagWindow(at('2026-05-22T21:30:00+03:00'), P)).toBe(false);
  });
  it('day 2 of ראש השנה is fully blocked', () => {
    expect(isChagWindow(at('2026-09-12T10:00:00+03:00'), P)).toBe(true);
    expect(isChagWindow(at('2026-09-12T21:30:00+03:00'), P)).toBe(false); // after chag end
  });
  it('chol-hamoed is NOT blocked (סוכות 2026-09-28, פסח 2027-04-04)', () => {
    expect(isChagWindow(at('2026-09-28T12:00:00+03:00'), P)).toBe(false);
    expect(isChagWindow(at('2027-04-04T12:00:00+03:00'), P)).toBe(false);
  });
  it('שמיני עצרת (2026-10-02) is blocked', () => {
    expect(isChagWindow(at('2026-10-02T10:00:00+03:00'), P)).toBe(true);
  });
  it('horizon warning fires near the list end, stays quiet before', () => {
    expect(HOLIDAY_HORIZON_ISO).toBe('2027-04-07');
    expect(holidayHorizonWarning(at('2026-07-07T09:00:00Z'))).toBeNull();
    expect(holidayHorizonWarning(at('2027-03-15T09:00:00Z'))).toMatch(/horizon/);
  });
});

describe('sending hours (09:00–20:30 IL)', () => {
  it.each([
    ['2026-07-07T08:59:00+03:00', true],   // Tue before open
    ['2026-07-07T09:00:00+03:00', false],  // open (inclusive)
    ['2026-07-07T20:29:00+03:00', false],
    ['2026-07-07T20:30:00+03:00', true],   // close (exclusive)
    ['2026-07-07T23:00:00+03:00', true],
  ])('%s → quiet=%s', (iso, quiet) => {
    expect(isQuietHours(at(iso), P)).toBe(quiet);
  });
});

describe('nextAllowedSendTime (the R7 defer target)', () => {
  it('inside a legal window returns the instant unchanged', () => {
    const t = at('2026-07-07T12:00:00+03:00'); // Tue noon
    expect(nextAllowedSendTime(t, P).getTime()).toBe(t.getTime());
  });
  it('before opening clamps to 09:00 same day', () => {
    expect(nextAllowedSendTime(at('2026-07-07T07:00:00+03:00'), P).toISOString())
      .toBe('2026-07-07T06:00:00.000Z'); // Tue 09:00 IDT
  });
  it('after closing rolls to 09:00 next day', () => {
    expect(nextAllowedSendTime(at('2026-07-07T21:00:00+03:00'), P).toISOString())
      .toBe('2026-07-08T06:00:00.000Z'); // Wed 09:00 IDT
  });
  it('a Friday-evening candidate lands SUNDAY 09:00 (not Saturday night)', () => {
    expect(nextAllowedSendTime(at('2026-07-03T16:00:00+03:00'), P).toISOString())
      .toBe('2026-07-05T06:00:00.000Z'); // Sun 09:00 IDT
  });
  it('erev-chag Thursday defers past chag+Shabbat to Sunday 09:00', () => {
    // ערב שבועות Thu 2026-05-21 16:00 → chag Fri → Shabbat → Sun 2026-05-24 09:00
    expect(nextAllowedSendTime(at('2026-05-21T16:00:00+03:00'), P).toISOString())
      .toBe('2026-05-24T06:00:00.000Z');
  });
});
