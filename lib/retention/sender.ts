// lib/retention/sender.ts
//
// sendSeriesTouch — one enrollment step through the full stack, in order:
//
//   1. COMPLIANCE GATE (checkSendAllowed) — refusal → log a refused touch +
//      persist the deferral (R7: not_before moves, next_position does NOT)
//      and return; a structural refusal (no defer) advances past the step.
//   2. AUTONOMY (routeAndLog, kind 'send_message' — the money path): in
//      propose modes the verdict is 'propose' and NOTHING sends — that is
//      CORRECT behavior, the proposal lives in autonomy_events.
//   3. TOUCH LOG FIRST (fail-closed, the INVERSE of route-and-log's
//      downgrade): the contact_touches row is written status='sent'
//      optimistically BEFORE the provider call. If that insert fails the send
//      is ABORTED — a send that can't be counted toward tomorrow's caps must
//      not happen (it would permanently corrupt the cap substrate).
//   4. DISPATCH — whatsapp via lib/whatsapp (InforU mock by default),
//      email/sms via the ChannelAdapter seam (mocks until providers land).
//      Provider failure flips the touch to 'failed' (best effort).
//   5. CURSOR — advance the enrollment, stamp contact.last_contact_at.
//
// This module is the ONLY caller of lib/whatsapp under lib/retention — the
// gate is structurally non-bypassable (asserted by tests/retention/no-bypass).

import type { SupabaseClient } from '@supabase/supabase-js';
import { routeAndLog as realRouteAndLog } from '@/lib/autonomy/route-and-log';
import { sendWhatsApp as realSendWhatsApp } from '@/lib/whatsapp';
import type { RetentionPolicy } from './policy';
import { buildRefusedTouch, checkSendAllowed } from './gate';
import { resolveChannel } from './invariants';
import { defaultAdapters } from './adapters';
import type {
  ChannelAdapter,
  ContactRow,
  EnrollmentRow,
  GateCandidate,
  GateVerdict,
  RefusalCode,
  RetentionChannel,
  RetentionStore,
  SeriesRow,
  SeriesStepRow,
  TouchRow,
} from './types';

export interface SendSeriesTouchInput {
  contact: ContactRow;
  enrollment: EnrollmentRow;
  step: SeriesStepRow;
  series: SeriesRow;
  /** The contact's touch history (sent rows = the cap substrate). */
  recentTouches: TouchRow[];
  /** Client-level sent count for the current IL day (R8). */
  clientSentToday: number;
  policy: RetentionPolicy;
  /** Injected — deterministic and testable. */
  now: Date;
  /** Estimated provider cost of THIS touch in ILS (autonomy impact). */
  estimatedCostIls?: number;
  /** ILS already moved today/this month (routeAndLog contract). */
  spendContext?: { todaySpendIls: number; monthSpendIls: number };
}

export interface SendSeriesTouchDeps {
  /** The touch/enrollment write seam (Supabase in prod, in-memory in tests). */
  store: RetentionStore;
  /** Needed by routeAndLog (autonomy state + audit live in the DB). */
  supabase: SupabaseClient;
  /** Injectable for tests; defaults to the real autonomy pipe. */
  routeAndLog?: typeof realRouteAndLog;
  /** Injectable for tests; defaults to the real (mock-by-default) WA pipe. */
  sendWhatsApp?: typeof realSendWhatsApp;
  /** email/sms adapters; defaults to dry-run mocks (providers are gated). */
  adapters?: Partial<Record<RetentionChannel, ChannelAdapter>>;
}

export type SendSeriesTouchResult =
  | { outcome: 'sent'; touchId: string; channel: RetentionChannel; providerMode: 'mock' | 'live' }
  | { outcome: 'failed'; touchId: string; channel: RetentionChannel; error: string }
  | { outcome: 'refused'; code: RefusalCode; reason: string; deferUntil?: string; touchLogged: boolean }
  | { outcome: 'proposed'; reason: string }
  | { outcome: 'blocked'; reason: string; touchLogged: boolean }
  | { outcome: 'aborted'; reason: string };

/** Send one series step to one enrolled contact — gate → autonomy → log → dispatch. */
export async function sendSeriesTouch(
  input: SendSeriesTouchInput,
  deps: SendSeriesTouchDeps,
): Promise<SendSeriesTouchResult> {
  const { contact, enrollment, step, series, policy, now } = input;
  const store = deps.store;
  const routeAndLog = deps.routeAndLog ?? realRouteAndLog;
  const sendWhatsAppFn = deps.sendWhatsApp ?? realSendWhatsApp;
  const adapters = { ...defaultAdapters(), ...(deps.adapters ?? {}) };
  const groundedIn = step.grounded_in?.length ? step.grounded_in : series.grounded_in ?? [];

  // ── channel resolution (R5 rotation happens HERE, before the gate) ─────────
  const resolution = resolveChannel(step.channel, contact, enrollment.last_channel);
  const candidate: GateCandidate = {
    channel: resolution.ok ? resolution.channel : step.channel,
    promoKey: step.promo_key,
    seriesId: series.id,
    seriesMessageId: step.id,
    lastChannel: enrollment.last_channel,
  };

  // ── 1. the compliance gate — the non-bypassable chokepoint ─────────────────
  const verdict: GateVerdict = resolution.ok
    ? checkSendAllowed({
        contact,
        candidate,
        recentTouches: input.recentTouches,
        clientSentToday: input.clientSentToday,
        policy,
        now,
      })
    : { allowed: false, code: resolution.code, reason: resolution.reason };

  if (!verdict.allowed) {
    let touchLogged = true;
    try {
      await store.insertTouch(buildRefusedTouch({ contact, candidate, verdict, groundedIn, now }));
    } catch (err: unknown) {
      touchLogged = false; // nothing sent — fail-closed direction preserved
      console.error('[retention] refused-touch log failed:', err instanceof Error ? err.message : err);
    }
    try {
      if (verdict.deferUntil) {
        // R7: defer, never skip — not_before moves, next_position stays.
        await store.deferEnrollment(enrollment.id, verdict.deferUntil.toISOString());
      } else if (verdict.code === 'opted_out' || verdict.code === 'no_consent') {
        // The whole enrollment is dead, not just this step.
        await store.stopEnrollment(enrollment.id, verdict.code === 'opted_out' ? 'opted_out' : 'stopped');
      } else {
        // Structural refusal (no channel / promo dup): the step is unreachable
        // for this contact — cursor advances past it (doc §3.3), not deferred.
        // last_touch_at/last_channel unchanged: nothing was actually sent.
        await store.advanceEnrollment(enrollment.id, {
          next_position: enrollment.next_position + 1,
          last_touch_at: enrollment.last_touch_at,
          last_channel: enrollment.last_channel,
          not_before: null,
        });
      }
    } catch (err: unknown) {
      console.error('[retention] enrollment update after refusal failed:', err instanceof Error ? err.message : err);
    }
    return {
      outcome: 'refused',
      code: verdict.code,
      reason: verdict.reason,
      deferUntil: verdict.deferUntil?.toISOString(),
      touchLogged,
    };
  }

  // ── 2. autonomy — send_message is a money kind; propose modes propose ──────
  const { route } = await routeAndLog(deps.supabase, {
    clientId: series.client_id,
    ownerUserId: series.owner_user_id,
    action: {
      kind: 'send_message',
      ref: `${series.id}:${step.id}:${contact.id}`,
      impact: { spend_ils: input.estimatedCostIls ?? 0 },
      rationale: `מגע רטנציה: סדרה ${series.id} צעד ${step.position} (${candidate.channel}) לאיש קשר ${contact.id}`,
      grounded_in: groundedIn,
    },
    spendContext: input.spendContext ?? { todaySpendIls: 0, monthSpendIls: 0 },
  });

  if (route.route === 'propose') {
    // CORRECT in propose modes: the proposal is the autonomy_events row; no
    // touch is written (nothing was sent OR compliance-refused).
    return { outcome: 'proposed', reason: route.reason };
  }
  if (route.route === 'block') {
    let touchLogged = true;
    try {
      await store.insertTouch(buildRefusedTouch({
        contact,
        candidate,
        verdict: { allowed: false, code: 'autonomy_blocked', reason: `נדחה: חסימת אוטונומיה — ${route.reason}` },
        groundedIn,
        now,
      }));
    } catch {
      touchLogged = false;
    }
    return { outcome: 'blocked', reason: route.reason, touchLogged };
  }

  // ── 3. TOUCH LOG FIRST — fail-closed: no counted row, no send ──────────────
  const sentRow: Omit<TouchRow, 'id'> = {
    contact_id: contact.id,
    client_id: contact.client_id,
    owner_user_id: contact.owner_user_id,
    series_id: series.id,
    series_message_id: step.id,
    channel: candidate.channel,
    status: 'sent',
    refusal_code: null,
    promo_key: step.promo_key,
    provider: candidate.channel === 'whatsapp' ? 'inforu' : adapters[candidate.channel]?.provider ?? null,
    provider_ref: null,
    grounded_in: groundedIn,
    rationale: series.rationale ?? null,
    sent_at: now.toISOString(),
  };
  let touchId: string;
  try {
    touchId = await store.insertTouch(sentRow);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // THE fail-closed rule: an uncounted send corrupts tomorrow's caps — abort.
    return { outcome: 'aborted', reason: `touch-log write failed — send aborted (fail-closed): ${message}` };
  }

  // ── 4. dispatch ─────────────────────────────────────────────────────────────
  let ok = false;
  let providerMode: 'mock' | 'live' = 'mock';
  let providerRef: string | null = null;
  let providerError: string | undefined;
  try {
    if (candidate.channel === 'whatsapp') {
      const res = await sendWhatsAppFn({
        clientId: contact.client_id,
        ownerUserId: contact.owner_user_id,
        toPhone: contact.phone!,
        body: step.body,
        groundedIn,
      });
      ok = res.ok;
      providerMode = res.mode;
      providerRef = res.id ?? res.providerMsgId;
      providerError = res.error;
    } else {
      const adapter = adapters[candidate.channel];
      if (!adapter) throw new Error(`no adapter for channel ${candidate.channel}`);
      const res = await adapter.send({
        to: candidate.channel === 'email' ? contact.email! : contact.phone!,
        subject: step.subject,
        body: step.body,
      });
      ok = res.ok;
      providerMode = res.mode;
      providerRef = res.providerRef;
      providerError = res.error;
    }
  } catch (err: unknown) {
    ok = false;
    providerError = err instanceof Error ? err.message : String(err);
  }

  if (!ok) {
    const error = providerError ?? 'provider send failed';
    try { await store.markTouchFailed(touchId, error); } catch { /* best effort */ }
    return { outcome: 'failed', touchId, channel: candidate.channel, error };
  }
  if (providerRef) {
    try { await store.setTouchProviderRef(touchId, sentRow.provider ?? 'unknown', providerRef); } catch { /* best effort */ }
  }

  // ── 5. cursor + contact recency ─────────────────────────────────────────────
  try {
    await store.advanceEnrollment(enrollment.id, {
      next_position: enrollment.next_position + 1,
      last_touch_at: now.toISOString(),
      last_channel: candidate.channel,
      not_before: null,
    });
    await store.touchContact(contact.id, now.toISOString());
  } catch (err: unknown) {
    // The send happened and IS counted (the touch row exists) — cursor drift
    // is recoverable and must not un-send anything; log loudly.
    console.error('[retention] cursor update after send failed:', err instanceof Error ? err.message : err);
  }

  return { outcome: 'sent', touchId, channel: candidate.channel, providerMode };
}
