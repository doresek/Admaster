// lib/journey.ts
// Helpers for the per-client journey state machine (client_journeys +
// journey_events, migration 013). The journey is the source of truth for
// "where is this client in the funnel"; journey_events is the audit timeline
// and the seam the judge writes verdicts into.

import type { SupabaseClient } from '@supabase/supabase-js';

export type JourneyState =
  | 'needs_client'
  | 'needs_brief'
  | 'brief_in'
  | 'generating'
  | 'scoring'
  | 'awaiting_approval'
  | 'ready_to_launch'
  | 'live'
  | 'analyzing'
  | 'optimizing'
  | 'needs_attention';

export interface Journey {
  id: string;
  user_id: string;
  client_id: string | null;
  state: JourneyState;
  mode: 'manual' | 'autopilot';
  brief_id: string | null;
  approval_id: string | null;
  launched_ad_id: string | null;
  current_run_id: string | null;
  next_action: Record<string, unknown>;
}

// Human-facing next-best-action per state (Hebrew). Drives the cockpit card.
export const NEXT_ACTION_HE: Record<JourneyState, { label: string; hint: string }> = {
  needs_client:      { label: 'חבר לקוח ראשון',        hint: 'חבר חשבון Meta כדי להתחיל' },
  needs_brief:       { label: 'מלא בריף',                hint: 'ספר לנו על העסק כדי שה-AI יבין מה לעשות' },
  brief_in:          { label: 'צור מודעות',              hint: 'יש בריף — אפשר לייצר מודעות' },
  generating:        { label: 'מייצר…',                  hint: 'ה-AI כותב מודעות' },
  scoring:           { label: 'מנקד ומשפר…',             hint: 'בודק ביצועים ומשפר' },
  awaiting_approval: { label: 'ממתין לאישור',            hint: 'שלח ללקוח לאישור' },
  ready_to_launch:   { label: 'מוכן להשקה',              hint: 'אושר — אפשר להשיק' },
  live:              { label: 'באוויר',                  hint: 'המודעה רצה' },
  analyzing:         { label: 'מנתח ביצועים',            hint: 'בודק מה עובד' },
  optimizing:        { label: 'משפר',                    hint: 'משפר טרגוט/תקציב/קריאייטיב' },
  needs_attention:   { label: 'דורש תשומת לב',           hint: 'משהו נתקע — בדוק' },
};

export async function getJourney(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
): Promise<Journey | null> {
  let q = supabase.from('client_journeys').select('*').eq('user_id', userId);
  q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);
  const { data } = await q.maybeSingle();
  return (data as Journey) ?? null;
}

export async function ensureJourney(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
  initialState: JourneyState = 'needs_brief',
): Promise<Journey> {
  const existing = await getJourney(supabase, userId, clientId);
  if (existing) return existing;
  const { data, error } = await supabase
    .from('client_journeys')
    .insert({
      user_id: userId,
      client_id: clientId,
      state: initialState,
      next_action: NEXT_ACTION_HE[initialState],
    })
    .select('*')
    .single();
  if (error) throw new Error(`ensureJourney: ${error.message}`);
  return data as Journey;
}

export async function logEvent(
  supabase: SupabaseClient,
  ev: {
    journeyId: string;
    userId: string;
    step?: string;
    fromState?: JourneyState;
    toState?: JourneyState;
    status?: 'ok' | 'error' | 'skipped' | 'gate';
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from('journey_events').insert({
    journey_id: ev.journeyId,
    user_id: ev.userId,
    step: ev.step ?? null,
    from_state: ev.fromState ?? null,
    to_state: ev.toState ?? null,
    status: ev.status ?? 'ok',
    payload: ev.payload ?? {},
  });
  if (error) console.error('[journey.logEvent] insert failed:', error.message);
}

/**
 * Advance a client's journey to `brief_in` when a brief is submitted.
 * - No-op when `clientId` is null (a brief from a legacy code with no client).
 * - Resilient: never throws — a journey hiccup must not fail the brief submission
 *   itself (the brief row is already saved by the time this runs).
 */
export async function advanceJourneyOnBrief(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
  briefId: string,
): Promise<void> {
  if (!clientId) return;
  try {
    const journey = await ensureJourney(supabase, userId, clientId);
    await transition(supabase, journey, 'brief_in', {
      step: 'brief_submitted',
      patch: { brief_id: briefId },
    });
  } catch (err) {
    console.error('[journey.advanceJourneyOnBrief] failed:', (err as Error).message);
  }
}

/** Transition a journey to a new state, patch pointers, and log the event. */
export async function transition(
  supabase: SupabaseClient,
  journey: Journey,
  toState: JourneyState,
  opts: {
    step?: string;
    status?: 'ok' | 'error' | 'skipped' | 'gate';
    payload?: Record<string, unknown>;
    patch?: Partial<Pick<Journey, 'brief_id' | 'approval_id' | 'launched_ad_id' | 'current_run_id'>>;
  } = {},
): Promise<Journey> {
  const fromState = journey.state;
  const next_action = NEXT_ACTION_HE[toState];
  const { data, error } = await supabase
    .from('client_journeys')
    .update({ state: toState, next_action, updated_at: new Date().toISOString(), ...(opts.patch ?? {}) })
    .eq('id', journey.id)
    .select('*')
    .single();
  if (error) throw new Error(`transition: ${error.message}`);

  await logEvent(supabase, {
    journeyId: journey.id,
    userId: journey.user_id,
    step: opts.step,
    fromState,
    toState,
    status: opts.status ?? 'ok',
    payload: opts.payload,
  });
  return data as Journey;
}
