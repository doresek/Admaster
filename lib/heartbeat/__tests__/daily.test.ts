// Daily-tick tests (§1.2 daily anatomy): the no-pipe default, the kill path
// through the autonomy modes (executed in propose_approve, proposed in
// draft_only), floor-met resolution (resolveAndLearn exactly once,
// replay-safe via the ledger claim), and the C-04 SHOCK SUPPRESSION headline.
// MOCKED Supabase + injected observations/now — no DB, no LLM, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShockState } from '@/lib/capability-contracts';
import type { ArmObservation } from '@/lib/hypotheses';
import { claimTick, markRunning, markSucceeded } from '../ledger';
import { runDailyTick } from '../ticks/daily';
import type { ObservationsProvider, TickContext } from '../types';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

// Spy on resolveAndLearn while DELEGATING to the real implementation — call
// counts are asserted AND the real CAS/persistence behavior stays under test.
const spies = vi.hoisted(() => ({
  resolveAndLearn: vi.fn(),
}));
vi.mock('@/lib/hypotheses', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hypotheses')>();
  spies.resolveAndLearn.mockImplementation(actual.resolveAndLearn);
  return { ...actual, resolveAndLearn: spies.resolveAndLearn };
});

const CLIENT = 'client-1';
const OWNER  = 'owner-1';
const NOW    = new Date('2026-07-01T06:00:00.000Z');

const ctx = (shock: ShockState | null = null): TickContext => ({
  clientId:    CLIENT,
  ownerUserId: OWNER,
  tick:        'daily',
  runId:       'run-1',
  shock,
  notes:       [],
});

let seq = 0;

/** An OPEN hypothesis row with sane frozen defaults (empty verdict-map moves). */
function hypRow(over: {
  id?:            string;
  kill_rules?:    Record<string, unknown>;
  registered_at?: string;
  insight_ids?:   string[];
} = {}): MockRow {
  return {
    id:            over.id ?? `hyp-${++seq}`,
    client_id:     CLIENT,
    owner_user_id: OWNER,
    insight_ids:   over.insight_ids ?? ['atom-1'],
    claim:         'variant beats control on ctr',
    prediction:    { metric: 'ctr', comparator: 'gte', value: 0.005, arm: 'A', confidence: 0.7 },
    floor_spec:    { metric_grade: 'ctr', per_arm: { impressions: 1000 } },
    horizon:       { max_days: 30 },
    verdict_map:   { supported: [], refuted: [], inconclusive: [] },
    kill_rules:    over.kill_rules ?? {},
    test_refs:     [{ arm_label: 'A' }, { arm_label: 'B' }],
    domain:        'angle',
    status:        'open',
    resolution:    null,
    registered_at: over.registered_at ?? '2026-06-29T00:00:00.000Z',
    resolved_at:   null,
    superseded_by: null,
    created_at:    '2026-06-29T00:00:00.000Z',
    updated_at:    '2026-06-29T00:00:00.000Z',
  };
}

/** Arm A is kill-eligible under mercy: 2× floor, 10% of leader B's ctr. */
const KILL_OBSERVATIONS: ArmObservation[] = [
  { arm: 'A', impressions: 2000, clicks: 2,  metrics: { ctr: 0.001 } },
  { arm: 'B', impressions: 2000, clicks: 20, metrics: { ctr: 0.01 } },
];
const MERCY = { mercy: { min_floor_multiple: 1, max_fraction_of_leader: 0.5 } };

const providerFor = (byId: Record<string, ArmObservation[]>): ObservationsProvider => ({
  forHypothesis: (id) => byId[id] ?? null,
});

let db: SupabaseMock;

beforeEach(() => {
  db = mockSupabase();
  spies.resolveAndLearn.mockClear();
});

describe('runDailyTick — no metrics pipe (the MVP default)', () => {
  it('notes "no metrics pipe" per open hypothesis and takes zero actions', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-a' }), hypRow({ id: 'hyp-b' })]);

    const result = await runDailyTick(ctx(), { supabase: db.client, now: NOW });

    expect(result.actions).toEqual([]);
    expect(result.notes).toContain('hypothesis hyp-a: no metrics pipe — progress unknown');
    expect(result.notes).toContain('hypothesis hyp-b: no metrics pipe — progress unknown');
    // Nothing was routed, resolved, or written beyond reads.
    expect(db.rows('autonomy_events')).toHaveLength(0);
    expect(spies.resolveAndLearn).not.toHaveBeenCalled();
  });

  it('notes when there are no open hypotheses at all', async () => {
    const result = await runDailyTick(ctx(), { supabase: db.client, now: NOW });
    expect(result.notes).toContain('no open hypotheses — nothing to review today');
  });
});

describe('runDailyTick — kill rules through the autonomy modes', () => {
  it('propose_approve: kill → pause_paid routed AND EXECUTED (protective bypass), hypothesis killed_mercy', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-kill', kill_rules: MERCY })]);

    const result = await runDailyTick(ctx(), {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({ 'hyp-kill': KILL_OBSERVATIONS }),
    });

    const pause = result.actions.find((a) => a.kind === 'pause_paid');
    expect(pause).toBeDefined();
    expect(pause?.route).toBe('execute');
    expect(pause?.ref).toBe('hyp-kill');
    expect(pause?.rationale).toContain('kill early');

    // The autonomy audit landed BEFORE execution (routeAndLog invariant).
    const events = db.rows('autonomy_events');
    expect(events.some((e) => e.event === 'action_auto_executed')).toBe(true);

    // Execution = the protective resolution: killed_mercy through resolveAndLearn.
    expect(spies.resolveAndLearn).toHaveBeenCalledTimes(1);
    const hyp = db.rows('hypotheses')[0];
    expect(hyp.status).not.toBe('open');
    expect(hyp.resolution).toMatchObject({ resolved_by: 'killed_mercy' });
  });

  it('draft_only: the SAME scenario is PROPOSED, not executed — the mode gate is real', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-kill', kill_rules: MERCY })]);
    db.seed('client_autonomy', [{
      id: 'aut-1', client_id: CLIENT, owner_user_id: OWNER, mode: 'draft_only',
      caps: {}, approvals_total: 0, approvals_approved: 0,
      mode_since: '2026-06-01T00:00:00.000Z',
      created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
    }]);

    const result = await runDailyTick(ctx(), {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({ 'hyp-kill': KILL_OBSERVATIONS }),
    });

    const pause = result.actions.find((a) => a.kind === 'pause_paid');
    expect(pause?.route).toBe('propose');

    // Proposed, not executed: the audit says so and the hypothesis stays OPEN
    // for the owner's tap.
    const events = db.rows('autonomy_events');
    expect(events.some((e) => e.event === 'action_proposed')).toBe(true);
    expect(events.some((e) => e.event === 'action_auto_executed')).toBe(false);
    expect(spies.resolveAndLearn).not.toHaveBeenCalled();
    expect(db.rows('hypotheses')[0].status).toBe('open');
  });
});

describe('runDailyTick — floor-met resolution (the loop closing)', () => {
  const FLOOR_MET: ArmObservation[] = [
    { arm: 'A', impressions: 1500, clicks: 15, metrics: { ctr: 0.01 } },
    { arm: 'B', impressions: 1500, clicks: 6,  metrics: { ctr: 0.004 } },
  ];

  it('resolves via resolveAndLearn exactly once and records a knowledge action (route execute, NOT autonomy-routed)', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-floor' })]);

    const result = await runDailyTick(ctx(), {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({ 'hyp-floor': FLOOR_MET }),
    });

    expect(spies.resolveAndLearn).toHaveBeenCalledTimes(1);
    const resolveAction = result.actions.find((a) => a.kind === 'resolve_hypothesis');
    expect(resolveAction).toBeDefined();
    expect(resolveAction?.route).toBe('execute');
    expect(resolveAction?.ref).toBe('hyp-floor');

    // Knowledge, not money: NO autonomy event for the resolution.
    expect(db.rows('autonomy_events')).toHaveLength(0);

    const hyp = db.rows('hypotheses')[0];
    expect(hyp.status).toBe('supported'); // A: ctr 0.01 ≥ 0.005, floor met
    expect(hyp.resolution).toMatchObject({ resolved_by: 'floor_met' });
  });

  it('is replay-safe: after a succeeded run, the same day cannot claim again — nothing double-fires', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-floor' })]);
    const deps = {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({ 'hyp-floor': FLOOR_MET }),
    };

    // First run, through the ledger like the scheduler would.
    const run = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: NOW });
    expect(run).not.toBeNull();
    await markRunning(db.client, run!.id, { now: NOW });
    const first = await runDailyTick(ctx(), deps);
    await markSucceeded(db.client, run!.id, first.actions, first.notes, { now: NOW });
    expect(spies.resolveAndLearn).toHaveBeenCalledTimes(1);

    // Same UTC day, retry fires: the claim is refused — the tick never runs.
    const retry = await claimTick(db.client, CLIENT, OWNER, 'daily', { now: new Date('2026-07-01T18:00:00.000Z') });
    expect(retry).toBeNull();
    expect(spies.resolveAndLearn).toHaveBeenCalledTimes(1);

    // And even a direct re-run (belt AND suspenders) is a no-op: the resolved
    // hypothesis is no longer 'open', so the review loop has nothing to touch.
    const second = await runDailyTick(ctx(), deps);
    expect(second.actions.filter((a) => a.kind === 'resolve_hypothesis')).toHaveLength(0);
    expect(second.notes).toContain('no open hypotheses — nothing to review today');
    expect(spies.resolveAndLearn).toHaveBeenCalledTimes(1);
  });

  it('notes running progress when the floor is not met yet', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-slow' })]);
    const result = await runDailyTick(ctx(), {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({
        'hyp-slow': [{ arm: 'A', impressions: 400, metrics: { ctr: 0.01 } }],
      }),
    });
    expect(result.actions).toEqual([]);
    expect(result.notes.some((n) => n.includes('floor progress 40%'))).toBe(true);
  });
});

describe('runDailyTick — SHOCK SUPPRESSION (the C-04 headline)', () => {
  const SHOCK: ShockState = { shocked: true, factor: 0.42, direction: 'up', note: 'chag window' };

  it('shocked day + kill-eligible arm → NO kill action, "שוק, לא אתה" noted', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-kill', kill_rules: MERCY })]);

    const result = await runDailyTick(ctx(SHOCK), {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({ 'hyp-kill': KILL_OBSERVATIONS }),
    });

    // No pause action, no autonomy routing, no resolution — the market did
    // this, not the campaign (C-04's whole purpose).
    expect(result.actions.filter((a) => a.kind === 'pause_paid')).toHaveLength(0);
    expect(db.rows('autonomy_events')).toHaveLength(0);
    expect(db.rows('hypotheses')[0].status).toBe('open');

    expect(result.notes.some((n) => n.includes('שוק, לא אתה'))).toBe(true);
    expect(result.notes.some((n) => n.includes('suppressed'))).toBe(true);
  });

  it('a non-shocked ShockState does not suppress', async () => {
    db.seed('hypotheses', [hypRow({ id: 'hyp-kill', kill_rules: MERCY })]);
    const calm: ShockState = { shocked: false, factor: null, direction: null, note: null };

    const result = await runDailyTick(ctx(calm), {
      supabase:     db.client,
      now:          NOW,
      observations: providerFor({ 'hyp-kill': KILL_OBSERVATIONS }),
    });
    expect(result.actions.some((a) => a.kind === 'pause_paid' && a.route === 'execute')).toBe(true);
  });
});
