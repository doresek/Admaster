// lib/fleet/calendar.ts — the Israeli calendar overlay for shock detection.
//
// Known events pre-annotate EXPECTED shocks so they inform rather than alarm
// (spec C-04 "calendar overlay"). The windows encode the israeli-market-timing
// skill §2 table (the chagim engine) as data: when a fleet-level shock lands
// inside a window whose expected movement matches the observed one, the factor
// row stays `shocked = true` but its note marks it 'expected (חג)' — consumers
// (diagnosis suppression, verdict normalization, the national-mood trigger)
// may treat an expected shock more gently than an unexplained one, e.g. a
// tishrei CPM spike should suppress diagnoses but NOT trip the crisis switch.
//
// ── HONESTY NOTE (read before "fixing" these dates) ───────────────────────────
// The chagim follow the Hebrew (lunisolar) calendar, which drifts up to ±3
// weeks against the Gregorian one year to year (Rosh Hashana lands anywhere
// from early September to early October). The month-day bounds below are
// deliberately WIDE Gregorian approximations that contain the window in every
// year — they trade precision for zero dependencies and total predictability.
// A proper Hebrew-calendar library (e.g. @hebcal/core) computing exact
// per-year windows is a known follow-up; until then, a false "expected (חג)"
// annotation on a shock near a window edge is the accepted cost, and it is a
// benign one: the shock is still recorded and still true, only its note is
// softer. The array is plain data — editing a window is a one-line change.

import type { CalendarWindow, ExpectedShockKind, FleetMetric } from './types';

/**
 * The israeli-market-timing §2 chagim table, encoded. Windows are inclusive
 * month-day ranges; none crosses the year boundary (chanuka is clamped to
 * Dec 31 — the tail of a late chanuka spills into January in some years, part
 * of the documented drift trade-off).
 */
export const ISRAELI_MARKET_WINDOWS: readonly CalendarWindow[] = [
  {
    label:           'חגי תשרי',
    month_day_start: '09-15',
    month_day_end:   '10-15',
    expected:        'cpm_up',
    note: 'ראש השנה–סוכות scramble: retail/food/hospitality peak, auction crowding inflates CPM; B2B decisions freeze ("אחרי החגים")',
  },
  {
    label:           'בלאק פריידי',
    month_day_start: '11-20',
    month_day_end:   '11-30',
    expected:        'cpm_up',
    note: 'the imported shopping weekend, now a real Israeli retail event — heavy auction competition in late November',
  },
  {
    label:           'חנוכה',
    month_day_start: '12-05',
    month_day_end:   '12-31',
    expected:        'mixed',
    note: 'kids/family/leisure mini-peak with a school vacation week; modest retail moment — verticals move in different directions',
  },
  {
    label:           'לפני פסח ופסח',
    month_day_start: '03-15',
    month_day_end:   '04-15',
    expected:        'cpm_up',
    note: 'the second big scramble: cleaning/home/food peak weeks before, CPM inflation; the chag week itself is vacation mode',
  },
  {
    label:           'ימי הזיכרון והעצמאות',
    month_day_start: '04-16',
    month_day_end:   '05-10',
    expected:        'attention_down',
    note: 'יום השואה + יום הזיכרון: solemn national mood, promotional attention collapses (quiet-rule days); flips to celebration on יום העצמאות',
  },
  {
    label:           'החופש הגדול',
    month_day_start: '07-01',
    month_day_end:   '08-31',
    expected:        'mixed',
    note: 'summer school vacation: families reorganize around kids — B2B slows while family-leisure verticals peak',
  },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure lookup: the calendar window containing `date` (ISO YYYY-MM-DD), or null.
 * Month-day comparison is lexicographic, which is correct because both sides
 * are zero-padded 'MM-DD' strings and no window crosses the year boundary.
 * Windows are checked in array order; the table has no overlapping ranges, so
 * at most one can match. Throws on a malformed date — a bad date here is a
 * caller bug, never a "no window" answer.
 */
export function expectedShock(date: string): CalendarWindow | null {
  if (!ISO_DATE.test(date)) {
    throw new RangeError(`expectedShock: expected ISO YYYY-MM-DD date, got "${date}"`);
  }
  const monthDay = date.slice(5);
  for (const window of ISRAELI_MARKET_WINDOWS) {
    if (monthDay >= window.month_day_start && monthDay <= window.month_day_end) return window;
  }
  return null;
}

/**
 * Does an observed shock (metric + direction) match what a window predicts?
 * The mapping is the WHY of each ExpectedShockKind:
 *  - 'cpm_up': auction crowding pushes the price metrics UP (cpm, and spend
 *    follows for budget-capped accounts) — it says nothing about ctr/cvr.
 *  - 'attention_down': national mood suppresses response — the engagement
 *    metrics (ctr, cvr) fall; cpm may or may not move.
 *  - 'mixed': the window plausibly explains ANY fleet-level movement.
 * A shock that contradicts the window (e.g. CPM crashing during tishrei) is
 * NOT expected — it stays an unexplained shock and keeps full alarm value.
 */
export function windowMatchesShock(
  window:    CalendarWindow,
  metric:    FleetMetric,
  direction: 'up' | 'down',
): boolean {
  const expected: ExpectedShockKind = window.expected;
  switch (expected) {
    case 'cpm_up':
      return direction === 'up' && (metric === 'cpm' || metric === 'spend');
    case 'attention_down':
      return direction === 'down' && (metric === 'ctr' || metric === 'cvr');
    case 'mixed':
      return true;
  }
}
