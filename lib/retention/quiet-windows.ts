// lib/retention/quiet-windows.ts
//
// Shabbat / Yom-Tov / sending-hours windows, computed on the Asia/Jerusalem
// WALL CLOCK via `Intl` (Node 20 ships full ICU) — no date library, no lists
// for Shabbat (it is weekly and computed forever; doc §4.3).
//
// - Shabbat: blocked Fri `shabbatStartMin` (15:00) → Sat `shabbatEndMin` (21:00).
// - Yom-Tov: chag days derived from IL_HOLIDAYS + the in-module chag-days map
//   (רה"ש 2 days, יו"כ 1, סוכות first + שמח"ת, פסח first + seventh, שבועות 1 —
//   chag days only, NOT chol-hamoed; חנוכה/פורים are not melacha-blocked).
//   Blocked erev-chag `erevChagStartMin` → `chagEndMin` of the LAST chag day.
//   HONESTY NOTE (same as holidays.ts): fixed 2026–2027 dates, yearly refresh;
//   `holidayHorizonWarning` yells when `now` nears the horizon. Shabbat never
//   expires.
// - Sending hours: `sendWindowStartMin`–`sendWindowEndMin` (09:00–20:30 IL).
//
// All functions take `now: Date` — deterministic, testable, no Date.now().

import { IL_HOLIDAYS } from '@/lib/organic-calendar/holidays';
import type { RetentionPolicy } from './policy';

// ── Israel wall clock ─────────────────────────────────────────────────────────

export interface ILWallClock {
  /** ISO date (YYYY-MM-DD) in Asia/Jerusalem. */
  dateISO: string;
  /** 0 = Sunday … 6 = Saturday (IL weekday). */
  weekday: number;
  /** Minutes since IL midnight. */
  minutes: number;
}

const IL_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const WEEKDAYS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Read the Asia/Jerusalem wall clock for an instant. */
export function ilWallClock(now: Date): ILWallClock {
  const parts: Record<string, string> = {};
  for (const p of IL_FMT.formatToParts(now)) parts[p.type] = p.value;
  // 'en-GB' may emit hour "24" at midnight; normalize.
  const hour = Number(parts.hour) % 24;
  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** Add n days to an ISO date (date-only arithmetic, UTC-safe). */
export function addDaysISO(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Asia/Jerusalem UTC-offset (ms) at a given instant, derived via Intl. */
function ilOffsetMs(at: Date): number {
  const wc = ilWallClock(at);
  const [y, m, d] = wc.dateISO.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(wc.minutes / 60), wc.minutes % 60);
  // Truncate `at` to the minute the formatter saw, so the diff is the offset.
  const atMinute = Math.floor(at.getTime() / 60000) * 60000;
  return asUtc - atMinute;
}

/**
 * The UTC instant of `dateISO` at `minutes` on the Asia/Jerusalem wall clock.
 * Two-pass offset refinement handles DST boundaries.
 */
export function ilToUtc(dateISO: string, minutes: number): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60));
  const off1 = ilOffsetMs(guess);
  const first = new Date(guess.getTime() - off1);
  const off2 = ilOffsetMs(first);
  return off2 === off1 ? first : new Date(guess.getTime() - off2);
}

// ── Shabbat (weekly, computed — never listed) ────────────────────────────────

/** True while sends are blocked for Shabbat (Fri 15:00 → Sat 21:00 IL). */
export function isShabbatWindow(now: Date, policy: RetentionPolicy): boolean {
  const wc = ilWallClock(now);
  if (wc.weekday === 5) return wc.minutes >= policy.shabbatStartMin;
  if (wc.weekday === 6) return wc.minutes < policy.shabbatEndMin;
  return false;
}

/** UTC instant this (or the next) Shabbat window ends — Sat `shabbatEndMin` IL. */
export function shabbatWindowEnd(now: Date, policy: RetentionPolicy): Date {
  const wc = ilWallClock(now);
  const daysToSat = (6 - wc.weekday + 7) % 7; // 0 when already Saturday
  const satISO = addDaysISO(wc.dateISO, daysToSat);
  return ilToUtc(satISO, policy.shabbatEndMin);
}

// ── Yom-Tov (from IL_HOLIDAYS + chag-days map) ───────────────────────────────

/**
 * Chag-day layout per holiday NAME in IL_HOLIDAYS (offsets from the listed
 * first day). Missing name ⇒ not a melacha-blocked chag (חנוכה, פורים).
 * סוכות: first day + שמיני עצרת/שמח"ת (+7). פסח: first + seventh (+6).
 */
const CHAG_DAY_OFFSETS: Record<string, number[]> = {
  'ראש השנה': [0, 1],
  'יום כיפור': [0],
  'סוכות': [0, 7],
  'פסח': [0, 6],
  'שבועות': [0],
};

/** A run of consecutive chag dates, blocked erev(start)−15:00 → end 21:00. */
export interface ChagSpan {
  name: string;
  /** First chag date (ISO). */
  start: string;
  /** Last chag date (ISO), inclusive. */
  end: string;
}

/** Expand IL_HOLIDAYS into consecutive-day chag spans (sorted, precomputed). */
export function buildChagSpans(): ChagSpan[] {
  const spans: ChagSpan[] = [];
  for (const h of IL_HOLIDAYS) {
    const offsets = CHAG_DAY_OFFSETS[h.name];
    if (!offsets) continue;
    // Merge consecutive offsets into runs (e.g. [0,1] → one span; [0,7] → two).
    let runStart = offsets[0];
    let prev = offsets[0];
    for (const off of offsets.slice(1).concat([Number.NaN])) {
      if (off === prev + 1) { prev = off; continue; }
      spans.push({
        name: h.name,
        start: addDaysISO(h.date, runStart),
        end: addDaysISO(h.date, prev),
      });
      runStart = off;
      prev = off;
    }
  }
  return spans.sort((a, b) => (a.start < b.start ? -1 : 1));
}

const CHAG_SPANS = buildChagSpans();

/** The chag span blocking `now`, or null. Blocked = erev 15:00 → end-day 21:00. */
export function activeChagSpan(now: Date, policy: RetentionPolicy): ChagSpan | null {
  const wc = ilWallClock(now);
  for (const span of CHAG_SPANS) {
    const erev = addDaysISO(span.start, -1);
    if (wc.dateISO === erev && wc.minutes >= policy.erevChagStartMin) return span;
    if (wc.dateISO >= span.start && wc.dateISO < span.end) return span;
    if (wc.dateISO === span.end && wc.minutes < policy.chagEndMin) return span;
  }
  return null;
}

/** True while sends are blocked for Yom-Tov (incl. erev from 15:00). */
export function isChagWindow(now: Date, policy: RetentionPolicy): boolean {
  return activeChagSpan(now, policy) !== null;
}

/** Latest chag date the hardcoded list covers (the honesty horizon). */
export const HOLIDAY_HORIZON_ISO: string = CHAG_SPANS.length
  ? CHAG_SPANS[CHAG_SPANS.length - 1].end
  : '1970-01-01';

/**
 * Loud note when `now` is within `withinDays` of the holiday list's horizon —
 * beyond it Yom-Tov is fail-open (Shabbat, being computed, never expires).
 */
export function holidayHorizonWarning(now: Date, withinDays = 60): string | null {
  const wc = ilWallClock(now);
  if (wc.dateISO < addDaysISO(HOLIDAY_HORIZON_ISO, -withinDays)) return null;
  return `IL_HOLIDAYS horizon ${HOLIDAY_HORIZON_ISO} is near (now ${wc.dateISO}) — ` +
    'refresh the chag list or Yom-Tov blocking goes fail-open past the horizon';
}

// ── Sending hours + next legal send time ─────────────────────────────────────

/** True when the IL wall clock is OUTSIDE the sending window (09:00–20:30). */
export function isQuietHours(now: Date, policy: RetentionPolicy): boolean {
  const { minutes } = ilWallClock(now);
  return minutes < policy.sendWindowStartMin || minutes >= policy.sendWindowEndMin;
}

/**
 * The next instant at which ALL timing windows allow a send: inside sending
 * hours, not Shabbat, not chag. Iterates window-by-window (a Friday-evening
 * candidate lands Sunday 09:00, not Saturday night). Deterministic; bounded.
 */
export function nextAllowedSendTime(from: Date, policy: RetentionPolicy): Date {
  let t = from;
  for (let i = 0; i < 40; i++) {
    const wc = ilWallClock(t);
    if (wc.minutes < policy.sendWindowStartMin) {
      t = ilToUtc(wc.dateISO, policy.sendWindowStartMin);
      continue;
    }
    if (wc.minutes >= policy.sendWindowEndMin) {
      t = ilToUtc(addDaysISO(wc.dateISO, 1), policy.sendWindowStartMin);
      continue;
    }
    if (isShabbatWindow(t, policy)) {
      t = shabbatWindowEnd(t, policy);
      continue;
    }
    const chag = activeChagSpan(t, policy);
    if (chag) {
      t = ilToUtc(chag.end, policy.chagEndMin);
      continue;
    }
    return t;
  }
  return t; // unreachable in practice; bounded for totality
}
