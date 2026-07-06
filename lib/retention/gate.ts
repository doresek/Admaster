// lib/retention/gate.ts
//
// THE single compliance chokepoint (RETENTION-ENGINE-DESIGN.md §4): every
// retention send MUST pass `checkSendAllowed` — pure, TOTAL (garbage in →
// refuse, never throw), `now` injected. Check order (first hit wins, §4.1):
//
//   1. no_consent          — consented_at missing/unparsable (defense in depth)
//   2. opted_out           — tombstone; checked on EVERY send, not at enrollment
//   3. channel_pref / missing_address — the candidate channel is not receivable
//      (incl. the R5 rotation violation: same channel twice with ≥2 permitted)
//   4. shabbat / holiday / quiet_hours — timing windows (§4.3), DEFER
//   5. min_gap / daily_cap / weekly_cap / monthly_cap — R1–R3 + R8, DEFER
//   6. promo_duplicate     — R4, structural refusal
//
// Caps DEFER (verdict carries `deferUntil`, the next legal time) — never skip.
// Every refusal maps 1:1 to a loggable `contact_touches` refused row via
// `buildRefusedTouch`. Autonomy sits ABOVE this gate (sender routes through
// routeAndLog first); compliance can never be bypassed by an owner tap.

import type { RetentionPolicy } from './policy';
import type {
  ContactRow,
  GateCandidate,
  GateVerdict,
  RefusalCode,
  TouchRow,
} from './types';
import {
  checkClientDailyCap,
  checkDailyCap,
  checkMinGap,
  checkMonthlyCap,
  checkPromoDuplicate,
  checkWeeklyCap,
  permittedChannels,
  resolveChannel,
} from './invariants';
import {
  isChagWindow,
  isQuietHours,
  isShabbatWindow,
  nextAllowedSendTime,
  shabbatWindowEnd,
  activeChagSpan,
  ilToUtc,
} from './quiet-windows';

export interface GateInput {
  contact: ContactRow;
  candidate: GateCandidate;
  /** The contact's touches (status='sent' rows are the cap substrate). */
  recentTouches: TouchRow[];
  /** Client-level sent count for the current IL day (R8). Default 0. */
  clientSentToday?: number;
  /** Defaults ⊕ clients.retention_policy — resolve via resolvePolicy(). */
  policy: RetentionPolicy;
  /** Injected — deterministic and testable. */
  now: Date;
}

function refuse(code: RefusalCode, reason: string, deferUntil?: Date): GateVerdict {
  return deferUntil ? { allowed: false, code, reason, deferUntil } : { allowed: false, code, reason };
}

/**
 * May THIS message reach THIS person NOW? Pure and total — any internal
 * surprise refuses fail-closed rather than throwing.
 */
export function checkSendAllowed(input: GateInput): GateVerdict {
  try {
    return runChecks(input);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Fail-closed: an unverifiable send is a refused send.
    return refuse('no_consent', `נדחה: שגיאה פנימית בשער התאימות — חסימה מטעמי זהירות (${message})`);
  }
}

function runChecks(input: GateInput): GateVerdict {
  const { contact, candidate, recentTouches, policy, now } = input;

  // 1. consent (defense in depth — the schema already forbids consent-less rows)
  if (!contact?.consented_at || !Number.isFinite(Date.parse(contact.consented_at))) {
    return refuse('no_consent', 'נדחה: לא קיימת עדות הסכמה תקפה לאיש הקשר');
  }

  // 2. opt-out tombstone — every send, no exceptions
  if (contact.opted_out_at) {
    return refuse('opted_out', 'נדחה: איש הקשר הסיר את עצמו מרשימת התפוצה (opt-out)');
  }

  // 3. channel receivable + R5 rotation
  const permitted = permittedChannels(contact);
  if (!permitted.includes(candidate.channel)) {
    const hasAnyAddress = Boolean(contact.phone) || Boolean(contact.email);
    const missingAddr =
      (candidate.channel === 'email' && !contact.email) ||
      (candidate.channel !== 'email' && !contact.phone);
    if (missingAddr && !hasAnyAddress) {
      return refuse('missing_address', 'נדחה: אין כתובת (טלפון/אימייל) לאיש הקשר');
    }
    return refuse(
      missingAddr ? 'missing_address' : 'channel_pref',
      missingAddr
        ? `נדחה: אין כתובת לערוץ ${candidate.channel} עבור איש הקשר`
        : `נדחה: איש הקשר ביטל את ערוץ ${candidate.channel}`,
    );
  }
  if (
    candidate.lastChannel &&
    candidate.channel === candidate.lastChannel &&
    permitted.length >= 2
  ) {
    // R5: consecutive touches must vary channel when ≥2 are permitted. The
    // sender resolves rotation via resolveChannel() BEFORE gating; reaching
    // here means the rotation was skipped — refuse rather than silently allow.
    const rotation = resolveChannel(candidate.channel, contact, candidate.lastChannel);
    const hint = rotation.ok ? ` (הערוץ הבא בסבב: ${rotation.channel})` : '';
    return refuse(
      'channel_pref',
      `נדחה: אותו ערוץ (${candidate.channel}) פעמיים ברצף כאשר קיימים ≥2 ערוצים מותרים${hint}`,
    );
  }

  // 4. timing windows — Shabbat, Yom-Tov, sending hours (all DEFER, R7)
  if (isShabbatWindow(now, policy)) {
    const after = nextAllowedSendTime(shabbatWindowEnd(now, policy), policy);
    return refuse('shabbat', 'נדחה: חלון שבת — יידחה לחלון השליחה החוקי הבא', after);
  }
  const chag = activeChagSpan(now, policy);
  if (isChagWindow(now, policy) && chag) {
    const after = nextAllowedSendTime(ilToUtc(chag.end, policy.chagEndMin), policy);
    return refuse('holiday', `נדחה: חלון חג (${chag.name}) — יידחה לחלון השליחה החוקי הבא`, after);
  }
  if (isQuietHours(now, policy)) {
    const after = nextAllowedSendTime(now, policy);
    return refuse('quiet_hours', 'נדחה: מחוץ לשעות השליחה (09:00–20:30) — יידחה לחלון הבא', after);
  }

  // 5. frequency caps — R2 first (it usually defers furthest), then R1, R3, R8
  const minGap = checkMinGap(recentTouches, policy, now);
  if (!minGap.ok) return refuse(minGap.code, minGap.reason, minGap.deferUntil);
  const daily = checkDailyCap(recentTouches, policy, now);
  if (!daily.ok) return refuse(daily.code, daily.reason, daily.deferUntil);
  const weekly = checkWeeklyCap(recentTouches, policy, now);
  if (!weekly.ok) return refuse(weekly.code, weekly.reason, weekly.deferUntil);
  const monthly = checkMonthlyCap(recentTouches, policy, now);
  if (!monthly.ok) return refuse(monthly.code, monthly.reason, monthly.deferUntil);
  const clientCap = checkClientDailyCap(input.clientSentToday ?? 0, policy, now);
  if (!clientCap.ok) return refuse(clientCap.code, clientCap.reason, clientCap.deferUntil);

  // 6. promo dedup — R4 (structural: refuse, cursor advances, no defer)
  const promo = checkPromoDuplicate(recentTouches, candidate.promoKey, policy, now);
  if (!promo.ok) return refuse(promo.code, promo.reason);

  return { allowed: true };
}

/**
 * The loggable `contact_touches` refused row for a gate refusal (doc §4.2):
 * one row per refusal — the "what we did NOT send, and why" compliance trail.
 */
export function buildRefusedTouch(args: {
  contact: ContactRow;
  candidate: GateCandidate;
  verdict: Extract<GateVerdict, { allowed: false }>;
  groundedIn?: string[];
  now: Date;
}): Omit<TouchRow, 'id'> {
  const { contact, candidate, verdict, now } = args;
  const deferNote = verdict.deferUntil ? ` — יישלח לא לפני ${verdict.deferUntil.toISOString()}` : '';
  return {
    contact_id: contact.id,
    client_id: contact.client_id,
    owner_user_id: contact.owner_user_id,
    series_id: candidate.seriesId ?? null,
    series_message_id: candidate.seriesMessageId ?? null,
    channel: candidate.channel,
    status: 'refused',
    refusal_code: verdict.code,
    promo_key: candidate.promoKey,
    provider: null,
    provider_ref: null,
    grounded_in: args.groundedIn ?? [],
    rationale: `${verdict.reason}${deferNote}`,
    sent_at: now.toISOString(),
  };
}
