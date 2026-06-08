// Tests for advanceJourneyOnBrief (lib/journey.ts) — the journey advance that
// fires from /api/briefs/submit when a brief comes in. Supabase is mocked.

import { describe, it, expect } from 'vitest';
import { advanceJourneyOnBrief } from '@/lib/journey';

// ── Mock Supabase for the journey tables ────────────────────────
// client_journeys: getJourney → select.eq.eq.maybeSingle
//                  ensureJourney insert → insert.select.single
//                  transition update → update.eq.select.single
// journey_events:  logEvent → insert
function makeSupabase(opts: { existingJourney?: any }) {
  const events: any[] = [];
  const updates: any[] = [];
  const fromTables: string[] = [];
  let insertedJourney: any = null;

  const supabase: any = {
    _events: events,
    _updates: updates,
    _fromTables: fromTables,
    get _insertedJourney() { return insertedJourney; },
    from(table: string) {
      fromTables.push(table);
      if (table === 'client_journeys') {
        let mode: 'insert' | 'update' | null = null;
        let payload: any = null;
        const b: any = {
          select: () => b,
          eq: () => b,
          is: () => b,
          maybeSingle: () => Promise.resolve({ data: opts.existingJourney ?? null }),
          insert: (row: any) => { mode = 'insert'; payload = row; return b; },
          update: (row: any) => { mode = 'update'; payload = row; updates.push(row); return b; },
          single: () => {
            if (mode === 'insert') {
              insertedJourney = { id: 'journey-1', ...payload };
              return Promise.resolve({ data: insertedJourney, error: null });
            }
            const base = opts.existingJourney ?? insertedJourney ?? { id: 'journey-1' };
            return Promise.resolve({ data: { ...base, ...payload }, error: null });
          },
        };
        return b;
      }
      if (table === 'journey_events') {
        const b: any = {
          insert: (row: any) => { events.push(row); return Promise.resolve({ error: null }); },
        };
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return supabase;
}

describe('advanceJourneyOnBrief', () => {
  it('creates a journey if none exists and transitions it to brief_in', async () => {
    const supabase = makeSupabase({ existingJourney: null });
    await advanceJourneyOnBrief(supabase, 'user-1', 'client-1', 'brief-77');

    // a journey was created for this user/client
    expect(supabase._insertedJourney).toMatchObject({ user_id: 'user-1', client_id: 'client-1' });
    // and moved to brief_in, pointing at the brief
    expect(supabase._updates[0]).toMatchObject({ state: 'brief_in', brief_id: 'brief-77' });
    // audit event recorded
    expect(supabase._events).toHaveLength(1);
    expect(supabase._events[0]).toMatchObject({ to_state: 'brief_in', step: 'brief_submitted' });
  });

  it('reuses an existing journey and transitions it to brief_in', async () => {
    const supabase = makeSupabase({
      existingJourney: { id: 'journey-9', user_id: 'user-1', client_id: 'client-1', state: 'needs_brief' },
    });
    await advanceJourneyOnBrief(supabase, 'user-1', 'client-1', 'brief-88');

    expect(supabase._insertedJourney).toBeNull();             // no new journey created
    expect(supabase._updates[0]).toMatchObject({ state: 'brief_in', brief_id: 'brief-88' });
    expect(supabase._events[0]).toMatchObject({
      journey_id: 'journey-9',
      from_state: 'needs_brief',
      to_state: 'brief_in',
    });
  });

  it('skips cleanly when client_id is null (no DB calls, no throw)', async () => {
    const supabase = makeSupabase({ existingJourney: null });
    await expect(
      advanceJourneyOnBrief(supabase, 'user-1', null, 'brief-99'),
    ).resolves.toBeUndefined();
    expect(supabase._fromTables).toHaveLength(0);
    expect(supabase._events).toHaveLength(0);
    expect(supabase._updates).toHaveLength(0);
  });
});
