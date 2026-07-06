// tests/retention/sender.test.ts — sendSeriesTouch over an IN-MEMORY store:
// dry-run send path, the fail-closed touch-log rule (log failure ABORTS the
// send), refusal logging + R7 deferral, autonomy propose/block behavior, and
// R5 rotation at dispatch. No network, no DB.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_RETENTION_POLICY as P } from '@/lib/retention/policy';
import { sendSeriesTouch, type SendSeriesTouchDeps, type SendSeriesTouchInput } from '@/lib/retention/sender';
import type {
  ContactRow,
  EnrollmentRow,
  RetentionStore,
  SeriesRow,
  SeriesStepRow,
  TouchRow,
} from '@/lib/retention/types';

const NOW = new Date('2026-07-07T12:00:00+03:00'); // Tue noon IL — legal window

// ── fixtures ──────────────────────────────────────────────────────────────────

const contact = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: 'c1', client_id: 'cl1', owner_user_id: 'u1',
  full_name: 'דנה כהן', phone: '+972501234567', email: 'dana@example.com',
  tags: [], consent_source: 'manual', consented_at: '2026-01-01T00:00:00Z',
  consent_evidence: null, opted_out_at: null, opt_out_channel: null,
  opt_out_reason: null, opt_out_token: 'tok-1', channel_prefs: {},
  last_purchase_at: null, last_contact_at: null, ...over,
});

const enrollment = (over: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
  id: 'e1', series_id: 's1', contact_id: 'c1', client_id: 'cl1',
  owner_user_id: 'u1', status: 'active', enrolled_at: '2026-07-01T09:00:00Z',
  next_position: 0, not_before: null, last_touch_at: null, last_channel: null,
  ...over,
});

const step = (over: Partial<SeriesStepRow> = {}): SeriesStepRow => ({
  id: 'sm1', series_id: 's1', day_offset: 0, channel: 'whatsapp',
  subject: null, body: 'היי דנה, מתגעגעים! יש לנו משהו בשבילך', position: 0,
  promo_key: null, grounded_in: ['atom-1'], ...over,
});

const series = (over: Partial<SeriesRow> = {}): SeriesRow => ({
  id: 's1', client_id: 'cl1', owner_user_id: 'u1', status: 'active',
  grounded_in: ['atom-0'], rationale: 'win-back ללקוחות רדומים', ...over,
});

interface MemStore extends RetentionStore {
  touches: Array<TouchRow & { id: string }>;
  updates: Array<{ op: string; args: unknown[] }>;
}

function memStore(overrides: Partial<RetentionStore> = {}): MemStore {
  const touches: Array<TouchRow & { id: string }> = [];
  const updates: Array<{ op: string; args: unknown[] }> = [];
  const log = (op: string) => (...args: unknown[]) => {
    updates.push({ op, args });
    return Promise.resolve();
  };
  return {
    touches,
    updates,
    async insertTouch(row) {
      const id = `t${touches.length + 1}`;
      touches.push({ ...row, id });
      return id;
    },
    markTouchFailed: async (id, error) => {
      const t = touches.find((x) => x.id === id);
      if (t) { t.status = 'failed'; t.rationale = error; }
      updates.push({ op: 'markTouchFailed', args: [id, error] });
    },
    setTouchProviderRef: log('setTouchProviderRef'),
    advanceEnrollment: log('advanceEnrollment'),
    deferEnrollment: log('deferEnrollment'),
    stopEnrollment: log('stopEnrollment'),
    completeEnrollment: log('completeEnrollment'),
    touchContact: log('touchContact'),
    ...overrides,
  };
}

const executeRoute = vi.fn(async () => ({
  route: { route: 'execute' as const, reason: 'act_within_caps: בתוך התקרות' },
  mode: 'act_within_caps' as const,
}));

const okWhatsApp = vi.fn(async () => ({
  ok: true, status: 'sent' as const, id: 'wa-row-1', providerMsgId: 'mock-abc',
  persisted: true, mode: 'mock' as const,
}));

function makeDeps(store: MemStore, over: Partial<SendSeriesTouchDeps> = {}): SendSeriesTouchDeps {
  return {
    store,
    supabase: {} as SupabaseClient,
    routeAndLog: executeRoute as unknown as SendSeriesTouchDeps['routeAndLog'],
    sendWhatsApp: okWhatsApp as unknown as SendSeriesTouchDeps['sendWhatsApp'],
    ...over,
  };
}

function makeInput(over: Partial<SendSeriesTouchInput> = {}): SendSeriesTouchInput {
  return {
    contact: contact(),
    enrollment: enrollment(),
    step: step(),
    series: series(),
    recentTouches: [],
    clientSentToday: 0,
    policy: P,
    now: NOW,
    ...over,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('dry-run send path', () => {
  it('whatsapp: gate → autonomy → touch row FIRST → provider → cursor', async () => {
    const store = memStore();
    const wa = vi.fn(okWhatsApp.getMockImplementation()!);
    const res = await sendSeriesTouch(makeInput(), makeDeps(store, {
      sendWhatsApp: wa as unknown as SendSeriesTouchDeps['sendWhatsApp'],
    }));

    expect(res.outcome).toBe('sent');
    expect(store.touches).toHaveLength(1);
    expect(store.touches[0]).toMatchObject({
      contact_id: 'c1', client_id: 'cl1', owner_user_id: 'u1',
      series_id: 's1', series_message_id: 'sm1',
      channel: 'whatsapp', status: 'sent', refusal_code: null,
      provider: 'inforu', grounded_in: ['atom-1'],
      sent_at: NOW.toISOString(),
    });
    expect(wa).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'cl1', ownerUserId: 'u1', toPhone: '+972501234567',
      body: step().body, groundedIn: ['atom-1'],
    }));
    // cursor advanced, contact recency stamped
    expect(store.updates).toContainEqual({
      op: 'advanceEnrollment',
      args: ['e1', {
        next_position: 1,
        last_touch_at: NOW.toISOString(),
        last_channel: 'whatsapp',
        not_before: null,
      }],
    });
    expect(store.updates).toContainEqual({ op: 'touchContact', args: ['c1', NOW.toISOString()] });
  });

  it('email goes through the mock ChannelAdapter (dry-run) — no whatsapp call', async () => {
    const store = memStore();
    const wa = vi.fn();
    const res = await sendSeriesTouch(
      makeInput({ step: step({ channel: 'email', subject: 'מתגעגעים' }) }),
      makeDeps(store, { sendWhatsApp: wa as unknown as SendSeriesTouchDeps['sendWhatsApp'] }),
    );
    expect(res).toMatchObject({ outcome: 'sent', channel: 'email', providerMode: 'mock' });
    expect(wa).not.toHaveBeenCalled();
    expect(store.touches[0]).toMatchObject({ channel: 'email', provider: 'email-mock', status: 'sent' });
  });

  it('R5 rotation happens at dispatch: planned whatsapp after whatsapp → email', async () => {
    const store = memStore();
    const res = await sendSeriesTouch(
      makeInput({ enrollment: enrollment({ last_channel: 'whatsapp', next_position: 1 }) }),
      makeDeps(store),
    );
    expect(res).toMatchObject({ outcome: 'sent', channel: 'email' });
    expect(store.touches[0].channel).toBe('email');
  });
});

describe('fail-closed: the touch log gates the send', () => {
  it('touch-log INSERT failure ABORTS the send — provider never called', async () => {
    const store = memStore({
      insertTouch: async () => { throw new Error('db down'); },
    });
    const wa = vi.fn();
    const res = await sendSeriesTouch(makeInput(), makeDeps(store, {
      sendWhatsApp: wa as unknown as SendSeriesTouchDeps['sendWhatsApp'],
    }));
    expect(res.outcome).toBe('aborted');
    if (res.outcome === 'aborted') expect(res.reason).toContain('fail-closed');
    expect(wa).not.toHaveBeenCalled();
    expect(store.updates.map((u) => u.op)).not.toContain('advanceEnrollment');
  });

  it('provider failure flips the touch to failed and does NOT advance the cursor', async () => {
    const store = memStore();
    const failingWa = vi.fn(async () => ({
      ok: false, status: 'failed' as const, id: null, providerMsgId: null,
      persisted: false, mode: 'mock' as const, error: 'provider 500',
    }));
    const res = await sendSeriesTouch(makeInput(), makeDeps(store, {
      sendWhatsApp: failingWa as unknown as SendSeriesTouchDeps['sendWhatsApp'],
    }));
    expect(res.outcome).toBe('failed');
    expect(store.touches[0].status).toBe('failed');
    expect(store.updates.map((u) => u.op)).not.toContain('advanceEnrollment');
  });
});

describe('refusals — logged first-class, R7 defer semantics', () => {
  it('a timing refusal logs a refused touch and DEFERS (not_before moves, cursor stays)', async () => {
    const store = memStore();
    const route = vi.fn();
    const res = await sendSeriesTouch(
      makeInput({ now: new Date('2026-07-03T16:00:00+03:00') }), // Shabbat
      makeDeps(store, { routeAndLog: route as unknown as SendSeriesTouchDeps['routeAndLog'] }),
    );
    expect(res).toMatchObject({
      outcome: 'refused', code: 'shabbat', touchLogged: true,
      deferUntil: '2026-07-05T06:00:00.000Z', // Sunday 09:00 IL
    });
    expect(store.touches[0]).toMatchObject({ status: 'refused', refusal_code: 'shabbat' });
    expect(store.updates).toContainEqual({
      op: 'deferEnrollment', args: ['e1', '2026-07-05T06:00:00.000Z'],
    });
    expect(store.updates.map((u) => u.op)).not.toContain('advanceEnrollment');
    expect(route).not.toHaveBeenCalled(); // gate runs BEFORE autonomy
  });

  it('an opted-out contact stops the enrollment — never sends, never re-routes', async () => {
    const store = memStore();
    const wa = vi.fn();
    const res = await sendSeriesTouch(
      makeInput({ contact: contact({ opted_out_at: '2026-06-01T00:00:00Z' }) }),
      makeDeps(store, { sendWhatsApp: wa as unknown as SendSeriesTouchDeps['sendWhatsApp'] }),
    );
    expect(res).toMatchObject({ outcome: 'refused', code: 'opted_out' });
    expect(store.touches[0]).toMatchObject({ status: 'refused', refusal_code: 'opted_out' });
    expect(store.updates).toContainEqual({ op: 'stopEnrollment', args: ['e1', 'opted_out'] });
    expect(wa).not.toHaveBeenCalled();
  });

  it('a structural refusal (promo duplicate) advances PAST the step without touching recency', async () => {
    const store = memStore();
    const res = await sendSeriesTouch(
      makeInput({
        step: step({ promo_key: 'summer26' }),
        recentTouches: [{
          contact_id: 'c1', client_id: 'cl1', owner_user_id: 'u1',
          series_id: 's1', series_message_id: 'sm0', channel: 'email',
          status: 'sent', refusal_code: null, promo_key: 'summer26',
          provider: null, provider_ref: null, grounded_in: [], rationale: null,
          sent_at: '2026-04-20T12:00:00+03:00', // clears every cap, hits R4
        }],
        enrollment: enrollment({ next_position: 3, last_channel: 'email', last_touch_at: '2026-04-20T09:00:00Z' }),
      }),
      makeDeps(store),
    );
    expect(res).toMatchObject({ outcome: 'refused', code: 'promo_duplicate' });
    expect(store.updates).toContainEqual({
      op: 'advanceEnrollment',
      args: ['e1', {
        next_position: 4,
        last_touch_at: '2026-04-20T09:00:00Z', // unchanged — nothing sent
        last_channel: 'email',
        not_before: null,
      }],
    });
  });

  it('refused-touch log failure still refuses (fail-closed direction) with touchLogged=false', async () => {
    const store = memStore({ insertTouch: async () => { throw new Error('db down'); } });
    const res = await sendSeriesTouch(
      makeInput({ now: new Date('2026-07-03T16:00:00+03:00') }),
      makeDeps(store),
    );
    expect(res).toMatchObject({ outcome: 'refused', code: 'shabbat', touchLogged: false });
  });
});

describe('autonomy tie-in — send_message is the money path', () => {
  it('propose mode: verdict propose → nothing sends, no touch row (the proposal IS the log)', async () => {
    const store = memStore();
    const proposeRoute = vi.fn(async () => ({
      route: { route: 'propose' as const, reason: 'propose_approve: ממתין לאישור' },
      mode: 'propose_approve' as const,
    }));
    const wa = vi.fn();
    const res = await sendSeriesTouch(makeInput(), makeDeps(store, {
      routeAndLog: proposeRoute as unknown as SendSeriesTouchDeps['routeAndLog'],
      sendWhatsApp: wa as unknown as SendSeriesTouchDeps['sendWhatsApp'],
    }));
    expect(res).toMatchObject({ outcome: 'proposed' });
    expect(store.touches).toHaveLength(0);
    expect(wa).not.toHaveBeenCalled();
  });

  it('block verdict: refused touch logged as autonomy_blocked, nothing sends', async () => {
    const store = memStore();
    const blockRoute = vi.fn(async () => ({
      route: { route: 'block' as const, reason: 'מעל תקרת ההוצאה היומית' },
      mode: 'act_within_caps' as const,
    }));
    const wa = vi.fn();
    const res = await sendSeriesTouch(makeInput(), makeDeps(store, {
      routeAndLog: blockRoute as unknown as SendSeriesTouchDeps['routeAndLog'],
      sendWhatsApp: wa as unknown as SendSeriesTouchDeps['sendWhatsApp'],
    }));
    expect(res).toMatchObject({ outcome: 'blocked', touchLogged: true });
    expect(store.touches[0]).toMatchObject({ status: 'refused', refusal_code: 'autonomy_blocked' });
    expect(wa).not.toHaveBeenCalled();
  });

  it('routes the action with kind send_message and the grounding intact', async () => {
    const store = memStore();
    const route = vi.fn(executeRoute.getMockImplementation()!);
    await sendSeriesTouch(makeInput({ estimatedCostIls: 0.4 }), makeDeps(store, {
      routeAndLog: route as unknown as SendSeriesTouchDeps['routeAndLog'],
    }));
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clientId: 'cl1',
      ownerUserId: 'u1',
      action: expect.objectContaining({
        kind: 'send_message',
        impact: { spend_ils: 0.4 },
        grounded_in: ['atom-1'],
      }),
      spendContext: { todaySpendIls: 0, monthSpendIls: 0 },
    }));
  });
});
