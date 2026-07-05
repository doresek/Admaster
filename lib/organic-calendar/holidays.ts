// lib/organic-calendar/holidays.ts
//
// Israeli holidays the organic planner leans on (a holiday near a slot turns
// it into a 'holiday' post — timely content outperforms evergreen that week).
//
// HONESTY NOTE: these are FIXED Gregorian dates for 2026–2027 only. Jewish
// holidays follow the Hebrew (lunisolar) calendar, so the Gregorian dates move
// every year — this list needs a manual yearly refresh (or a proper Hebrew-
// calendar library) before planning into 2027-05 and beyond. We chose the
// hardcoded list deliberately: zero dependencies, fully deterministic tests.

export interface ILHoliday {
  name: string;
  /** ISO date (YYYY-MM-DD), Gregorian — first day of the holiday. */
  date: string;
  emoji: string;
}

export const IL_HOLIDAYS: ILHoliday[] = [
  { name: 'שבועות', date: '2026-05-22', emoji: '🌾' },
  { name: 'ראש השנה', date: '2026-09-11', emoji: '🍎' },
  { name: 'יום כיפור', date: '2026-09-20', emoji: '🕊️' },
  { name: 'סוכות', date: '2026-09-25', emoji: '🛖' },
  { name: 'חנוכה', date: '2026-12-04', emoji: '🕎' },
  { name: 'פורים', date: '2027-03-02', emoji: '🎭' },
  { name: 'פסח', date: '2027-04-01', emoji: '🍷' },
];

/**
 * Holidays whose date falls inside [startISO, endISO], inclusive on both ends.
 * Plain string comparison is correct for ISO dates (lexicographic = chrono).
 */
export function holidaysInRange(startISO: string, endISO: string): ILHoliday[] {
  return IL_HOLIDAYS.filter((h) => h.date >= startISO && h.date <= endISO);
}
