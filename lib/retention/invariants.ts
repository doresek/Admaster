// lib/retention/invariants.ts
//
// The 8 "don't nag" invariants (RETENTION-ENGINE-DESIGN.md §3.4) as PURE,
// individually-testable predicates over `contact_touches` rows + a policy.
// Only status='sent' rows count toward caps — refusals are audit, not usage.
// Cap blocks DEFER (verdict carries `deferUntil`, the next legal time — R7);
// structural blocks (promo duplicate, no channel) refuse without a defer.
// `now` is injected everywhere — no Date.now(), fully deterministic.

import type { RetentionPolicy } from './policy';
import {
  CHANNEL_ROTATION,
  type ContactRow,
  type InvariantVerdict,
  type RetentionChannel,
  type TouchRow,
} from './types';
import { ilToUtc, ilWallClock, addDaysISO, nextAllowedSendTime } from './quiet-windows';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only sent rows count toward caps (defensive re-filter). */
function sentRows(touches: TouchRow[]): TouchRow[] {
  return touches.filter((t) => t.status === 'sent');
}

function parseTs(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Defer to the next legal send time at/after `base` (clamps into windows). */
function defer(base: Date, policy: RetentionPolicy): Date {
  return nextAllowedSendTime(base, policy);
}

/** Start of the NEXT Israel calendar day, at the sending-window open. */
function nextIlDayWindowStart(now: Date, policy: RetentionPolicy): Date {
  const wc = ilWallClock(now);
  return ilToUtc(addDaysISO(wc.dateISO, 1), policy.sendWindowStartMin);
}

// ── R1 — ≤ dailyCapPerContact sent touches per IL calendar day ───────────────

export function checkDailyCap(
  touches: TouchRow[],
  policy: RetentionPolicy,
  now: Date,
): InvariantVerdict {
  const today = ilWallClock(now).dateISO;
  const count = sentRows(touches).filter((t) => {
    const ts = parseTs(t.sent_at);
    return ts !== null && ilWallClock(new Date(ts)).dateISO === today;
  }).length;
  if (count < policy.dailyCapPerContact) return { ok: true };
  return {
    ok: false,
    code: 'daily_cap',
    reason: `נדחה: תקרת מגעים יומית לאיש קשר (${policy.dailyCapPerContact}/יום) — יידחה למחר`,
    deferUntil: defer(nextIlDayWindowStart(now, policy), policy),
  };
}

// ── R2 — min gap between consecutive sent touches ────────────────────────────

export function checkMinGap(
  touches: TouchRow[],
  policy: RetentionPolicy,
  now: Date,
): InvariantVerdict {
  let last = -Infinity;
  for (const t of sentRows(touches)) {
    const ts = parseTs(t.sent_at);
    if (ts !== null && ts > last) last = ts;
  }
  if (last === -Infinity) return { ok: true };
  const eligible = last + policy.minGapDays * DAY_MS;
  if (now.getTime() >= eligible) return { ok: true };
  return {
    ok: false,
    code: 'min_gap',
    reason: `נדחה: מרווח מינימלי של ${policy.minGapDays} ימים בין מגעים טרם חלף`,
    deferUntil: defer(new Date(eligible), policy),
  };
}

// ── R3a / R3b — rolling weekly / monthly caps ────────────────────────────────

function checkRollingCap(
  touches: TouchRow[],
  policy: RetentionPolicy,
  now: Date,
  windowDays: number,
  cap: number,
  code: 'weekly_cap' | 'monthly_cap',
  label: string,
): InvariantVerdict {
  const windowStart = now.getTime() - windowDays * DAY_MS;
  const inWindow = sentRows(touches)
    .map((t) => parseTs(t.sent_at))
    .filter((ts): ts is number => ts !== null && ts > windowStart && ts <= now.getTime())
    .sort((a, b) => a - b);
  if (inWindow.length < cap) return { ok: true };
  // The window frees up when its OLDEST counted touch ages past windowDays.
  // (cap ≤ 0 is a degenerate override — defer a full window from now.)
  const oldestCounted = inWindow[Math.max(0, inWindow.length - Math.max(cap, 1))] ?? now.getTime();
  return {
    ok: false,
    code,
    reason: `נדחה: תקרת מגעים ${label} (${cap}/${windowDays} ימים) — יידחה עד שהחלון יתפנה`,
    deferUntil: defer(new Date(oldestCounted + windowDays * DAY_MS), policy),
  };
}

export function checkWeeklyCap(
  touches: TouchRow[], policy: RetentionPolicy, now: Date,
): InvariantVerdict {
  return checkRollingCap(touches, policy, now, 7, policy.weeklyCap, 'weekly_cap', 'שבועית');
}

export function checkMonthlyCap(
  touches: TouchRow[], policy: RetentionPolicy, now: Date,
): InvariantVerdict {
  return checkRollingCap(touches, policy, now, 30, policy.monthlyCap, 'monthly_cap', 'חודשית');
}

// ── R4 — never the same promo twice (any channel, within promoDedupDays) ─────

export function checkPromoDuplicate(
  touches: TouchRow[],
  promoKey: string | null,
  policy: RetentionPolicy,
  now: Date,
): InvariantVerdict {
  if (!promoKey) return { ok: true };
  const windowStart = now.getTime() - policy.promoDedupDays * DAY_MS;
  const dup = sentRows(touches).some((t) => {
    if (t.promo_key !== promoKey) return false;
    const ts = parseTs(t.sent_at);
    return ts !== null && ts > windowStart;
  });
  if (!dup) return { ok: true };
  // Structural refusal — the same offer must not chase the contact on another
  // channel; the step is unreachable, not deferred (doc §3.3/§3.4 R4).
  return {
    ok: false,
    code: 'promo_duplicate',
    reason: `נדחה: אותו מבצע (promo_key="${promoKey}") כבר נשלח לאיש הקשר ב-${policy.promoDedupDays} הימים האחרונים`,
  };
}

// ── R5 — channel permittedness + rotation ────────────────────────────────────

/** Channels this contact can actually receive (address present, pref not false). */
export function permittedChannels(contact: ContactRow): RetentionChannel[] {
  return CHANNEL_ROTATION.filter((ch) => {
    if (contact.channel_prefs?.[ch] === false) return false;
    if (ch === 'email') return typeof contact.email === 'string' && contact.email.length > 0;
    return typeof contact.phone === 'string' && contact.phone.length > 0; // sms + whatsapp
  });
}

export type ChannelResolution =
  | { ok: true; channel: RetentionChannel; rotated: boolean }
  | { ok: false; code: 'channel_pref' | 'missing_address'; reason: string };

/**
 * Resolve the actual channel for a planned step (doc §3.3):
 *  1. drop channels the contact can't receive / explicitly refused;
 *  2. rotation (R5): if the resolved channel equals `lastChannel` and ≥2
 *     channels are permitted, rotate to the NEXT permitted channel in the
 *     fixed order whatsapp → email → sms → whatsapp (deterministic);
 *  3. none left → refusal (missing_address when no address at all,
 *     channel_pref otherwise).
 */
export function resolveChannel(
  planned: RetentionChannel,
  contact: ContactRow,
  lastChannel: RetentionChannel | null,
): ChannelResolution {
  const permitted = permittedChannels(contact);
  if (permitted.length === 0) {
    const hasAnyAddress = Boolean(contact.phone) || Boolean(contact.email);
    return hasAnyAddress
      ? { ok: false, code: 'channel_pref', reason: 'נדחה: איש הקשר ביטל את כל הערוצים המותרים' }
      : { ok: false, code: 'missing_address', reason: 'נדחה: אין כתובת (טלפון/אימייל) לאיש הקשר' };
  }

  let channel = permitted.includes(planned) ? planned : permitted[0];
  let rotated = channel !== planned;

  if (channel === lastChannel && permitted.length >= 2) {
    const idx = CHANNEL_ROTATION.indexOf(channel);
    for (let step = 1; step <= CHANNEL_ROTATION.length; step++) {
      const next = CHANNEL_ROTATION[(idx + step) % CHANNEL_ROTATION.length];
      if (permitted.includes(next) && next !== channel) {
        channel = next;
        rotated = true;
        break;
      }
    }
  }
  return { ok: true, channel, rotated };
}

// ── R6 — offer density at series-BUILD time (≤1 hard offer per any 4 steps) ──

/**
 * Build-time lint (not a send-time gate): in every window of 4 consecutive
 * steps, at most 1 is a hard offer (step with a promo_key). Mirrors the
 * organic ROTATION discipline.
 */
export function checkOfferDensity(
  steps: Array<{ promo_key?: string | null; position?: number }>,
): { ok: true } | { ok: false; reason: string } {
  const ordered = [...steps].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const offers = ordered.map((s) => (s.promo_key ? 1 : 0));
  for (let i = 0; i < offers.length; i++) {
    const window = offers.slice(i, i + 4);
    const count = window.reduce((a: number, b) => a + b, 0);
    if (count > 1) {
      return {
        ok: false,
        reason: `צפיפות מבצעים גבוהה מדי: יותר ממבצע אחד ב-4 צעדים רצופים (החל מצעד ${i + 1})`,
      };
    }
  }
  return { ok: true };
}

// ── R7 — defer-never-skip is a SHAPE, asserted here for reuse ────────────────
// Every cap verdict above carries `deferUntil` (the next legal time) and the
// caller (sender) moves `not_before` WITHOUT advancing `next_position`.
// Exported so callers/tests share one definition of "is this a deferral".

export function isDeferral(v: InvariantVerdict): v is Extract<InvariantVerdict, { ok: false }> & { deferUntil: Date } {
  return !v.ok && v.deferUntil instanceof Date;
}

// ── R8 — per-client daily volume cap ─────────────────────────────────────────

/**
 * ≤ clientDailySendCap sent touches per CLIENT per IL day (runaway guard).
 * `clientSentToday` is the caller-loaded count of the client's sent touches
 * for the current IL calendar day. Uses refusal code 'daily_cap' (the 052
 * CHECK has no client-level code); the reason string carries the distinction.
 */
export function checkClientDailyCap(
  clientSentToday: number,
  policy: RetentionPolicy,
  now: Date,
): InvariantVerdict {
  if (clientSentToday < policy.clientDailySendCap) return { ok: true };
  return {
    ok: false,
    code: 'daily_cap',
    reason: `נדחה: תקרת שליחות יומית ללקוח (${policy.clientDailySendCap}/יום) הושגה — עודף נדחה למחר`,
    deferUntil: defer(nextIlDayWindowStart(now, policy), policy),
  };
}
