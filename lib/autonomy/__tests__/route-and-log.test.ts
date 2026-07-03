// Tests for routeAndLog — the composition the heartbeat calls for everything.
// The one test that matters most: THE FAIL-SAFE — an audit-write failure must
// downgrade 'execute' to 'propose' and leave NO 'action_auto_executed' event.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutonomyAction } from '@/lib/capability-contracts';
import { routeAndLog } from '../route-and-log';
import { mockSupabase, type MockRow } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'user-1';
const SPEND  = { todaySpendIls: 0, monthSpendIls: 0 };

const act = (
  kind:    AutonomyAction['kind'],
  impact?: { spend_ils?: number; delta_pct?: number },
): AutonomyAction => ({
  kind,
  rationale:   'digest tick: proven winner',
  grounded_in: ['insight-1', 'hypothesis-2'],
  ...(impact !== undefined ? { impact } : {}),
});

const autonomyRow = (over: Partial<MockRow> = {}): MockRow => ({
  id:                 'aut-1',
  client_id:          CLIENT,
  owner_user_id:      OWNER,
  mode:               'propose_approve',
  caps:               {},
  approvals_total:    0,
  approvals_approved: 0,
  mode_since:         '2026-06-01T00:00:00.000Z',
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('routeAndLog — event per route', () => {
  it('execute: writes action_auto_executed carrying the WHOLE action payload', async () => {
    const db = mockSupabase();
    const action = act('publish_organic');

    const result = await routeAndLog(db.client, { clientId: CLIENT, ownerUserId: OWNER, action, spendContext: SPEND });
    expect(result.route.route).toBe('execute');
    expect(result.mode).toBe('propose_approve');

    const events = db.rows('autonomy_events');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('action_auto_executed');
    expect(events[0].action).toEqual(action);
    expect(events[0].reason).toBe(result.route.reason);
  });

  it('propose: writes action_proposed', async () => {
    const db = mockSupabase();
    const result = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, action: act('unpause_paid', { spend_ils: 30 }), spendContext: SPEND,
    });
    expect(result.route.route).toBe('propose');
    expect(db.rows('autonomy_events').map((e) => e.event)).toEqual(['action_proposed']);
  });

  it('block: writes action_blocked (malformed input still gets audited)', async () => {
    const db = mockSupabase();
    const result = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, action: { ...act('publish_organic'), rationale: '' }, spendContext: SPEND,
    });
    expect(result.route.route).toBe('block');
    expect(db.rows('autonomy_events').map((e) => e.event)).toEqual(['action_blocked']);
  });
});

describe('routeAndLog — THE FAIL-SAFE: no un-audited execution, ever', () => {
  it('audit-write failure downgrades execute → propose and records no auto-execution', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = mockSupabase();
    db.seed('client_autonomy', [autonomyRow()]);
    db.failOn.add('insert:autonomy_events');

    const result = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, action: act('publish_organic'), spendContext: SPEND,
    });

    // The returned route is the downgrade, with the why.
    expect(result.route.route).toBe('propose');
    expect(result.route.reason).toContain('audit unavailable');
    expect(result.mode).toBe('propose_approve');

    // And NO 'action_auto_executed' event exists anywhere.
    const executed = db.rows('autonomy_events').filter((e) => e.event === 'action_auto_executed');
    expect(executed).toHaveLength(0);

    // The failure is loud, not silent.
    expect(errorSpy).toHaveBeenCalled();
  });

  it('audit-write failure on a propose verdict returns the ORIGINAL verdict (no execution risk)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = mockSupabase();
    db.seed('client_autonomy', [autonomyRow()]);
    db.failOn.add('insert:autonomy_events');

    const result = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, action: act('unpause_paid', { spend_ils: 30 }), spendContext: SPEND,
    });
    expect(result.route.route).toBe('propose');
    expect(result.route.reason).not.toContain('audit unavailable');
  });
});

describe('routeAndLog — state loading', () => {
  it('creates the propose_approve default row exactly once across calls', async () => {
    const db = mockSupabase();
    await routeAndLog(db.client, { clientId: CLIENT, ownerUserId: OWNER, action: act('propose_only'), spendContext: SPEND });
    await routeAndLog(db.client, { clientId: CLIENT, ownerUserId: OWNER, action: act('propose_only'), spendContext: SPEND });

    expect(db.rows('client_autonomy')).toHaveLength(1);
    expect(db.log.filter((l) => l === 'insert:client_autonomy')).toHaveLength(1);
    expect(db.rows('client_autonomy')[0].mode).toBe('propose_approve');
  });

  it('enforces the rate limit from the audit log, while pause still executes', async () => {
    const db = mockSupabase();
    db.seed('client_autonomy', [autonomyRow()]);
    const today = new Date().toISOString();
    db.seed('autonomy_events', Array.from({ length: 20 }, (): MockRow => ({
      client_id: CLIENT, owner_user_id: OWNER, event: 'action_auto_executed', created_at: today,
    })));

    const blocked = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, action: act('publish_organic'), spendContext: SPEND,
    });
    expect(blocked.route.route).toBe('block');

    const pause = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, action: act('pause_paid'), spendContext: SPEND,
    });
    expect(pause.route.route).toBe('execute');
  });

  it('uses the caller-supplied spend context for act_within_caps decisions', async () => {
    const db = mockSupabase();
    db.seed('client_autonomy', [autonomyRow({ mode: 'act_within_caps' })]);

    const within = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER,
      action: act('unpause_paid', { spend_ils: 50 }),
      spendContext: { todaySpendIls: 50, monthSpendIls: 100 },
    });
    expect(within.route.route).toBe('execute'); // 50 ≤ remaining 50 of default daily 100

    const over = await routeAndLog(db.client, {
      clientId: CLIENT, ownerUserId: OWNER,
      action: act('unpause_paid', { spend_ils: 50.01 }),
      spendContext: { todaySpendIls: 50, monthSpendIls: 100 },
    });
    expect(over.route.route).toBe('propose');
  });
});
