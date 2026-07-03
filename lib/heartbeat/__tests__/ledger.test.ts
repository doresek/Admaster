// Ledger tests: the §6.2 claim-lease contract over heartbeat_runs.
// MOCKED Supabase, injected clocks — no DB, no network, fully deterministic.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimTick,
  markFailed,
  markRunning,
  markSkipped,
  markSucceeded,
  isoWeekStart,
  periodStart,
  utcDayStart,
  utcMonthStart,
} from '../ledger';
import { HeartbeatLedgerError } from '../types';
import { mockSupabase, type SupabaseMock } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';

// A Wednesday, mid-day UTC.
const NOW = new Date('2026-07-01T12:00:00.000Z');

let db: SupabaseMock;

beforeEach(() => {
  db = mockSupabase();
});

describe('period boundaries (pure)', () => {
  it('daily period = the UTC calendar day', () => {
    expect(utcDayStart(new Date('2026-07-01T23:59:59.999Z')).toISOString())
      .toBe('2026-07-01T00:00:00.000Z');
    expect(periodStart('daily', NOW).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('weekly period = the ISO week, Monday 00:00 UTC boundary', () => {
    // 2026-07-01 is a Wednesday → week starts Monday 2026-06-29.
    expect(isoWeekStart(NOW).toISOString()).toBe('2026-06-29T00:00:00.000Z');
    // A Monday is its own week start…
    expect(isoWeekStart(new Date('2026-06-29T00:00:00.000Z')).toISOString())
      .toBe('2026-06-29T00:00:00.000Z');
    // …and Sunday 23:59 still belongs to the PREVIOUS Monday's week.
    expect(isoWeekStart(new Date('2026-07-05T23:59:59.000Z')).toISOString())
      .toBe('2026-06-29T00:00:00.000Z');
    // One second later (Monday 00:00) a new ISO week opens.
    expect(isoWeekStart(new Date('2026-07-06T00:00:00.000Z')).toISOString())
      .toBe('2026-07-06T00:00:00.000Z');
  });

  it('monthly period = the UTC calendar month', () => {
    expect(utcMonthStart(new Date('2026-07-31T23:00:00.000Z')).toISOString())
      .toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('claimTick idempotency', () => {
  it('claims once, then returns null for the same period after success', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW });
    expect(run).not.toBeNull();
    expect(run?.status).toBe('claimed');
    expect(run?.lease_until).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString());

    await markRunning(db.client, run!.id, { now: NOW });
    await markSucceeded(db.client, run!.id, [], ['done'], { now: NOW });

    // Same UTC day, later → already succeeded this period.
    const later = new Date('2026-07-01T20:00:00.000Z');
    expect(await claimTick(db.client, CLIENT, OWNER, 'daily', { now: later })).toBeNull();

    // Next UTC day → a fresh period, a fresh claim.
    const nextDay = new Date('2026-07-02T05:00:00.000Z');
    const second = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: nextDay });
    expect(second).not.toBeNull();
    expect(second?.id).not.toBe(run?.id);
  });

  it('a live unexpired claim blocks a second claim (no double workers)', async () => {
    const first = await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: NOW });
    expect(first).not.toBeNull();

    const oneMinuteLater = new Date(NOW.getTime() + 60_000);
    expect(await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: oneMinuteLater })).toBeNull();
    // Only the one row exists.
    expect(db.rows('heartbeat_runs')).toHaveLength(1);
  });

  it('weekly success blocks re-claims until the NEXT ISO Monday', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: NOW });
    await markRunning(db.client, run!.id, { now: NOW });
    await markSucceeded(db.client, run!.id, [], [], { now: NOW });

    // Sunday of the same ISO week → blocked.
    expect(await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: new Date('2026-07-05T10:00:00.000Z') }))
      .toBeNull();
    // Monday 00:00 of the next ISO week → open.
    expect(await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: new Date('2026-07-06T00:00:00.000Z') }))
      .not.toBeNull();
  });

  it('monthly success blocks re-claims within the month only', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'monthly', { now: NOW });
    await markRunning(db.client, run!.id, { now: NOW });
    await markSucceeded(db.client, run!.id, [], [], { now: NOW });

    expect(await claimTick(db.client, CLIENT, OWNER, 'monthly', { now: new Date('2026-07-31T23:00:00.000Z') }))
      .toBeNull();
    expect(await claimTick(db.client, CLIENT, OWNER, 'monthly', { now: new Date('2026-08-01T00:00:00.000Z') }))
      .not.toBeNull();
  });

  it('ticks are independent per (client, tick): a daily success never blocks the weekly', async () => {
    const daily = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW });
    await markRunning(db.client, daily!.id, { now: NOW });
    await markSucceeded(db.client, daily!.id, [], [], { now: NOW });

    expect(await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: NOW })).not.toBeNull();
    expect(await claimTick(db.client, 'client-2', OWNER, 'daily', { now: NOW })).not.toBeNull();
  });

  it('a failed run does NOT block a retry within the period (only success does)', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW });
    await markRunning(db.client, run!.id, { now: NOW });
    await markFailed(db.client, run!.id, 'boom', { now: NOW });

    const retry = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: new Date(NOW.getTime() + 60_000) });
    expect(retry).not.toBeNull();
  });

  it('stamps the attention snapshot on the claimed row', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'daily', {
      now: NOW,
      attention: { score: 0.7, components: { anomaly: { value: 1, reason: 'spike' } } },
    });
    expect(run?.attention).toEqual({ score: 0.7, components: { anomaly: { value: 1, reason: 'spike' } } });
  });
});

describe('stale-lease reclaim', () => {
  it('marks the expired claim failed ("lease expired") and claims fresh', async () => {
    const dead = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW, leaseMinutes: 10 });
    expect(dead).not.toBeNull();

    // 11 minutes later the lease is past — the worker is presumed dead.
    const later = new Date(NOW.getTime() + 11 * 60_000);
    const fresh = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: later });
    expect(fresh).not.toBeNull();
    expect(fresh?.id).not.toBe(dead?.id);

    const rows = db.rows('heartbeat_runs');
    const deadRow = rows.find((r) => r.id === dead?.id);
    expect(deadRow?.status).toBe('failed');
    expect(deadRow?.error).toBe('lease expired');
    expect(JSON.stringify(deadRow?.notes)).toContain('lease expired');
  });

  it('reclaims a RUNNING row too when its lease expired (crash mid-run)', async () => {
    const dead = await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: NOW, leaseMinutes: 5 });
    await markRunning(db.client, dead!.id, { now: NOW });

    const later = new Date(NOW.getTime() + 6 * 60_000);
    const fresh = await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: later });
    expect(fresh).not.toBeNull();
    expect(db.rows('heartbeat_runs').find((r) => r.id === dead?.id)?.status).toBe('failed');
  });
});

describe('transition guards (every transition checked)', () => {
  it('happy path: claimed → running → succeeded, stamping timestamps + payload', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW });
    const running = await markRunning(db.client, run!.id, { now: NOW });
    expect(running.status).toBe('running');
    expect(running.started_at).toBe(NOW.toISOString());

    const actions = [{ kind: 'pause_paid', rationale: 'why', route: 'execute' as const }];
    const done = await markSucceeded(db.client, run!.id, actions, ['a note'], { now: NOW });
    expect(done.status).toBe('succeeded');
    expect(done.actions).toEqual(actions);
    expect(done.notes).toEqual(['a note']);
    expect(done.finished_at).toBe(NOW.toISOString());
  });

  it('refuses running→running and succeeded→succeeded (illegal source states throw)', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW });
    await markRunning(db.client, run!.id, { now: NOW });
    await expect(markRunning(db.client, run!.id, { now: NOW })).rejects.toThrow(HeartbeatLedgerError);

    await markSucceeded(db.client, run!.id, [], [], { now: NOW });
    await expect(markSucceeded(db.client, run!.id, [], [], { now: NOW })).rejects.toThrow(HeartbeatLedgerError);
    await expect(markFailed(db.client, run!.id, 'late error', { now: NOW })).rejects.toThrow(HeartbeatLedgerError);
  });

  it('markSkipped records the reason and terminates the run', async () => {
    const run = await claimTick(db.client, CLIENT, OWNER, 'weekly', { now: NOW });
    const skipped = await markSkipped(db.client, run!.id, 'client deleted mid-fanout', { now: NOW });
    expect(skipped.status).toBe('skipped');
    expect(skipped.notes).toEqual(['client deleted mid-fanout']);
    // A skip is terminal too.
    await expect(markRunning(db.client, run!.id, { now: NOW })).rejects.toThrow(HeartbeatLedgerError);
  });

  it('surfaces DB errors with the failing operation name', async () => {
    db.failOn.add('select:heartbeat_runs');
    await expect(claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW }))
      .rejects.toThrow('claimTick.liveClaims');
  });
});
