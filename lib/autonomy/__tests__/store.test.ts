// Tests for the autonomy persistence layer against the in-memory stub:
// first-touch L1 creation (once), level changes with from/to audit, approval
// counter math, route-event mapping, and the auto-executions-only rate count.

import { describe, expect, it } from 'vitest';
import type { AutonomyAction, AutonomyRoute } from '@/lib/capability-contracts';
import { AutonomyStoreError } from '../types';
import {
  countTodayActions,
  getOrCreateAutonomy,
  logRouteEvent,
  recordApprovalOutcome,
  recordProposal,
  setLevel,
} from '../store';
import { mockSupabase, type MockRow } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'user-1';

const action: AutonomyAction = {
  kind:        'unpause_paid',
  ref:         'item-7',
  impact:      { spend_ils: 40 },
  rationale:   'winner arm confirmed at 2× floor',
  grounded_in: ['insight-3'],
};

const seededRow = (over: Partial<MockRow> = {}): MockRow => ({
  id:                 'aut-1',
  client_id:          CLIENT,
  owner_user_id:      OWNER,
  level:              'L1',
  caps:               {},
  approvals_total:    0,
  approvals_approved: 0,
  level_since:        '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('getOrCreateAutonomy', () => {
  it('creates the row at L1 (the default) on first touch, then reads on the second', async () => {
    const db = mockSupabase();

    const first = await getOrCreateAutonomy(db.client, CLIENT, OWNER);
    expect(first.level).toBe('L1');
    expect(first.caps).toEqual({});
    expect(first.approvals_total).toBe(0);
    expect(first.approvals_approved).toBe(0);
    expect(typeof first.level_since).toBe('string');

    const second = await getOrCreateAutonomy(db.client, CLIENT, OWNER);
    expect(second.id).toBe(first.id);
    expect(db.log.filter((l) => l === 'insert:client_autonomy')).toHaveLength(1);
  });

  it('throws a typed error when the select fails', async () => {
    const db = mockSupabase();
    db.failOn.add('select:client_autonomy');
    await expect(getOrCreateAutonomy(db.client, CLIENT, OWNER)).rejects.toBeInstanceOf(AutonomyStoreError);
  });

  it('throws a typed error when the insert fails and no concurrent row appeared', async () => {
    const db = mockSupabase();
    db.failOn.add('insert:client_autonomy');
    await expect(getOrCreateAutonomy(db.client, CLIENT, OWNER)).rejects.toBeInstanceOf(AutonomyStoreError);
  });
});

describe('setLevel', () => {
  it('writes level + level_since and a level_changed event carrying from/to + reason', async () => {
    const db = mockSupabase();
    db.seed('client_autonomy', [seededRow()]);

    const updated = await setLevel(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, level: 'L2', reason: 'graduation accepted',
    });
    expect(updated.level).toBe('L2');
    expect(updated.level_since).not.toBe('2026-06-01T00:00:00.000Z');

    const events = db.rows('autonomy_events');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('level_changed');
    expect(events[0].from_level).toBe('L1');
    expect(events[0].to_level).toBe('L2');
    expect(events[0].reason).toBe('graduation accepted');
  });

  it('is idempotent on the same level: no write, no event, level_since untouched', async () => {
    const db = mockSupabase();
    db.seed('client_autonomy', [seededRow()]);

    const row = await setLevel(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, level: 'L1', reason: 'no-op',
    });
    expect(row.level).toBe('L1');
    expect(row.level_since).toBe('2026-06-01T00:00:00.000Z');
    expect(db.rows('autonomy_events')).toHaveLength(0);
    expect(db.log.some((l) => l.startsWith('update:client_autonomy'))).toBe(false);
  });
});

describe('recordApprovalOutcome', () => {
  it('bumps the counters correctly and logs approved/rejected events', async () => {
    const db = mockSupabase();
    db.seed('client_autonomy', [seededRow()]);

    const afterApprove = await recordApprovalOutcome(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, approved: true, ref: 'evt-9',
    });
    expect(afterApprove.approvals_total).toBe(1);
    expect(afterApprove.approvals_approved).toBe(1);

    const afterReject = await recordApprovalOutcome(db.client, {
      clientId: CLIENT, ownerUserId: OWNER, approved: false,
    });
    expect(afterReject.approvals_total).toBe(2);
    expect(afterReject.approvals_approved).toBe(1);

    const events = db.rows('autonomy_events');
    expect(events.map((e) => e.event)).toEqual(['action_approved', 'action_rejected']);
    expect(events[0].action).toEqual({ ref: 'evt-9' });
  });
});

describe('recordProposal', () => {
  it('logs an action_proposed event carrying the full action', async () => {
    const db = mockSupabase();
    await recordProposal(db.client, { clientId: CLIENT, ownerUserId: OWNER, action });

    const events = db.rows('autonomy_events');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('action_proposed');
    expect(events[0].action).toEqual(action);
    expect(events[0].reason).toBe(action.rationale);
  });
});

describe('logRouteEvent', () => {
  it('maps every route verdict to its audit event, action jsonb intact', async () => {
    const db = mockSupabase();
    const routes: AutonomyRoute[] = [
      { route: 'execute', reason: 'within caps' },
      { route: 'propose', reason: 'L1 asks' },
      { route: 'block',   reason: 'rate limit' },
    ];
    for (const route of routes) {
      await logRouteEvent(db.client, { clientId: CLIENT, ownerUserId: OWNER, action, route });
    }
    const events = db.rows('autonomy_events');
    expect(events.map((e) => e.event)).toEqual(['action_auto_executed', 'action_proposed', 'action_blocked']);
    expect(events.map((e) => e.reason)).toEqual(['within caps', 'L1 asks', 'rate limit']);
    for (const e of events) expect(e.action).toEqual(action);
  });

  it('throws a typed error on insert failure (routeAndLog depends on this being loud)', async () => {
    const db = mockSupabase();
    db.failOn.add('insert:autonomy_events');
    await expect(
      logRouteEvent(db.client, { clientId: CLIENT, ownerUserId: OWNER, action, route: { route: 'execute', reason: 'x' } }),
    ).rejects.toBeInstanceOf(AutonomyStoreError);
  });
});

describe('countTodayActions', () => {
  it('counts only auto-executions, only today, only this client/owner', async () => {
    const db = mockSupabase();
    const today     = new Date().toISOString();
    const yesterday = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const evt = (over: Partial<MockRow>): MockRow => ({
      client_id: CLIENT, owner_user_id: OWNER, event: 'action_auto_executed', created_at: today, ...over,
    });
    db.seed('autonomy_events', [
      evt({}),                                        // counts
      evt({}),                                        // counts
      evt({ created_at: yesterday }),                 // wrong day
      evt({ event: 'action_proposed' }),              // proposals are speech, not action
      evt({ event: 'action_blocked' }),               // went nowhere
      evt({ client_id: 'other-client' }),             // wrong client
      evt({ owner_user_id: 'other-owner' }),          // wrong owner
    ]);

    expect(await countTodayActions(db.client, CLIENT, OWNER)).toBe(2);
  });

  it('throws a typed error when the count query fails (never route blind)', async () => {
    const db = mockSupabase();
    db.failOn.add('select:autonomy_events');
    await expect(countTodayActions(db.client, CLIENT, OWNER)).rejects.toBeInstanceOf(AutonomyStoreError);
  });
});
