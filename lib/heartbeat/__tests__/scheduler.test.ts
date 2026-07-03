// Scheduler tests (§6.2 fan-out): attention rank = processing order,
// per-client isolation, fleet factors computed ONCE per daily run, and the
// claim-skip path. MOCKED Supabase + mocked fleet/attention loaders (the pure
// rankClients stays real — the ORDER is computed by the real scorer).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClientAttentionState } from '@/lib/attention';
import { runHeartbeat } from '../scheduler';
import type { ObservationsProvider } from '../types';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const OWNER = 'owner-1';
const NOW   = new Date('2026-07-01T06:00:00.000Z');

const fleetSpies = vi.hoisted(() => ({
  computeDailyFactors: vi.fn(),
  getShockState:       vi.fn(),
}));
vi.mock('@/lib/fleet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fleet')>();
  fleetSpies.computeDailyFactors.mockResolvedValue({
    date: '2026-06-30', platform: 'meta', factors: [], skipped_rows: 0, note: 'stubbed factors',
  });
  fleetSpies.getShockState.mockResolvedValue({ shocked: false, factor: null, direction: null, note: null });
  return {
    ...actual,
    computeDailyFactors: fleetSpies.computeDailyFactors,
    getShockState:       fleetSpies.getShockState,
  };
});

const attentionSpies = vi.hoisted(() => ({
  loadStatesForOwner: vi.fn(),
}));
vi.mock('@/lib/attention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attention')>();
  return { ...actual, loadStatesForOwner: attentionSpies.loadStatesForOwner };
});

/** A minimal attention state; `urgency` cranks the errors component. */
function state(clientId: string, urgency: 'none' | 'med' | 'high'): ClientAttentionState {
  return {
    clientId,
    ownerUserId: OWNER,
    anomalyFlags: [],
    openHypotheses: [],
    staleness: { daysSinceLastAtomEvent: 0, cadenceDays: 7 },
    calendar: [],
    errorStates: urgency === 'none' ? [] : [{ kind: 'connection_error', severity: urgency }],
    activeCampaigns: 0,
  };
}

function clientRow(id: string): MockRow {
  return { id, owner_user_id: OWNER, name: `Client ${id}` };
}

let db: SupabaseMock;

beforeEach(() => {
  db = mockSupabase();
  fleetSpies.computeDailyFactors.mockClear();
  fleetSpies.getShockState.mockClear();
  attentionSpies.loadStatesForOwner.mockReset();
  db.seed('clients', [clientRow('client-1'), clientRow('client-2'), clientRow('client-3')]);
});

describe('runHeartbeat — attention order is processing order (C-06)', () => {
  it('processes clients in rank order and stamps the attention snapshot on each run', async () => {
    // client-2 screams (high error), client-3 murmurs (med), client-1 is calm
    // → the REAL rankClients must order them 2, 3, 1.
    attentionSpies.loadStatesForOwner.mockResolvedValue([
      state('client-1', 'none'),
      state('client-2', 'high'),
      state('client-3', 'med'),
    ]);

    const summary = await runHeartbeat(db.client, { tick: 'daily', now: NOW });

    const processed = db.rows('heartbeat_runs').map((r) => r.client_id);
    expect(processed).toEqual(['client-2', 'client-3', 'client-1']);
    expect(summary.results.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);

    // Every run answers "why this client, now" — the C-06 snapshot.
    for (const run of db.rows('heartbeat_runs')) {
      const attention = run.attention;
      expect(attention).toHaveProperty('score');
      expect(attention).toHaveProperty('components');
    }
  });

  it('falls back to client-id order (noted) when the attention load fails — the fleet still ticks', async () => {
    attentionSpies.loadStatesForOwner.mockRejectedValue(new Error('attention query broke'));

    const summary = await runHeartbeat(db.client, { tick: 'daily', now: NOW });

    expect(db.rows('heartbeat_runs').map((r) => r.client_id))
      .toEqual(['client-1', 'client-2', 'client-3']);
    expect(summary.results.every((r) => r.status === 'succeeded')).toBe(true);
    expect(summary.notes.some((n) => n.includes('attention ranking failed') && n.includes('attention query broke'))).toBe(true);
  });
});

describe('runHeartbeat — per-client isolation', () => {
  it("client 2's failure never stops clients 1 and 3; its run row is marked failed with the error", async () => {
    attentionSpies.loadStatesForOwner.mockResolvedValue([
      state('client-1', 'none'), state('client-2', 'none'), state('client-3', 'none'),
    ]);
    // Only client-2 has an open hypothesis; the injected observations provider
    // explodes when asked about it — the failure is client-2's alone.
    db.seed('hypotheses', [{
      id: 'hyp-c2', client_id: 'client-2', owner_user_id: OWNER,
      insight_ids: [], claim: 'x',
      prediction: { metric: 'ctr', comparator: 'gte', value: 0.005, arm: 'A', confidence: 0.7 },
      floor_spec: { metric_grade: 'ctr', per_arm: { impressions: 1000 } },
      horizon: { max_days: 30 },
      verdict_map: { supported: [], refuted: [], inconclusive: [] },
      kill_rules: {}, test_refs: [], domain: 'angle', status: 'open',
      resolution: null, registered_at: '2026-06-29T00:00:00.000Z',
      resolved_at: null, superseded_by: null,
      created_at: '2026-06-29T00:00:00.000Z', updated_at: '2026-06-29T00:00:00.000Z',
    }]);
    const explosive: ObservationsProvider = {
      forHypothesis: () => { throw new Error('metrics pipe exploded'); },
    };

    const summary = await runHeartbeat(db.client, {
      tick: 'daily', now: NOW, deps: { observations: explosive },
    });

    const byClient = new Map(summary.results.map((r) => [r.clientId, r]));
    expect(byClient.get('client-1')?.status).toBe('succeeded');
    expect(byClient.get('client-3')?.status).toBe('succeeded');
    expect(byClient.get('client-2')?.status).toBe('failed');
    expect(byClient.get('client-2')?.error).toContain('metrics pipe exploded');

    const failedRun = db.rows('heartbeat_runs').find((r) => r.client_id === 'client-2');
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.error).toContain('metrics pipe exploded');
  });
});

describe('runHeartbeat — fleet work once, claims respected', () => {
  it('computeDailyFactors runs exactly ONCE per daily heartbeat (never per client)', async () => {
    attentionSpies.loadStatesForOwner.mockResolvedValue([
      state('client-1', 'none'), state('client-2', 'none'), state('client-3', 'none'),
    ]);

    await runHeartbeat(db.client, { tick: 'daily', now: NOW });

    expect(fleetSpies.computeDailyFactors).toHaveBeenCalledTimes(1);
    // Factors for YESTERDAY, before any client tick.
    expect(fleetSpies.computeDailyFactors).toHaveBeenCalledWith(db.client, { date: '2026-06-30' });
    expect(fleetSpies.getShockState).toHaveBeenCalledTimes(1);
    expect(fleetSpies.getShockState).toHaveBeenCalledWith(db.client, '2026-06-30', 'cpm');
  });

  it('does not touch the fleet factors on weekly/monthly ticks', async () => {
    attentionSpies.loadStatesForOwner.mockResolvedValue([state('client-1', 'none')]);
    db.seed('clients', [{ ...clientRow('client-1'), email: null, phone: null, company: null, notes: null, connect_token: null, connect_expires_at: null, connect_consumed_at: null }]);

    await runHeartbeat(db.client, { tick: 'weekly', now: NOW });
    expect(fleetSpies.computeDailyFactors).not.toHaveBeenCalled();
  });

  it('a factor-computation failure is noted and the fleet still ticks (shock = unknown)', async () => {
    attentionSpies.loadStatesForOwner.mockResolvedValue([state('client-1', 'none')]);
    db.seed('clients', [clientRow('client-1')]);
    fleetSpies.computeDailyFactors.mockRejectedValueOnce(new Error('content_performance unavailable'));

    const summary = await runHeartbeat(db.client, { tick: 'daily', now: NOW });
    expect(summary.notes.some((n) => n.includes('fleet factor computation failed'))).toBe(true);
    expect(summary.results[0]?.status).toBe('succeeded');
  });

  it('claim-skip path: a client that already succeeded today is skipped, others tick', async () => {
    attentionSpies.loadStatesForOwner.mockResolvedValue([
      state('client-1', 'none'), state('client-2', 'none'), state('client-3', 'none'),
    ]);
    db.seed('heartbeat_runs', [{
      id: 'run-done', client_id: 'client-1', owner_user_id: OWNER,
      tick_type: 'daily', status: 'succeeded', attention: {}, actions: [], notes: [],
      tokens_used: null, error: null, lease_until: null,
      started_at: '2026-07-01T02:00:00.000Z', finished_at: '2026-07-01T02:01:00.000Z',
      created_at: '2026-07-01T02:00:00.000Z',
    }]);

    const summary = await runHeartbeat(db.client, { tick: 'daily', now: NOW });

    const byClient = new Map(summary.results.map((r) => [r.clientId, r]));
    expect(byClient.get('client-1')?.status).toBe('claim_skipped');
    expect(byClient.get('client-1')?.runId).toBeNull();
    expect(byClient.get('client-2')?.status).toBe('succeeded');
    expect(byClient.get('client-3')?.status).toBe('succeeded');
    // No second row for client-1 — the period check held.
    expect(db.rows('heartbeat_runs').filter((r) => r.client_id === 'client-1')).toHaveLength(1);
  });
});
