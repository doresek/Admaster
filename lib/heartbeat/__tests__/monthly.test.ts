// Monthly-tick tests: strategy re-synthesis (skip-on-identical respected),
// the D1 mode-SUGGESTION path (recorded + digested, never auto-switched), and
// the no-next-rung case. MOCKED Supabase + injected clock.

import { describe, it, expect, beforeEach } from 'vitest';
import { runMonthlyTick } from '../ticks/monthly';
import type { TickContext } from '../types';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';
const NOW    = new Date('2026-07-01T06:00:00.000Z');

const ctx = (): TickContext => ({
  clientId:    CLIENT,
  ownerUserId: OWNER,
  tick:        'monthly',
  runId:       'run-1',
  shock:       null,
  notes:       [],
});

function insightRow(id: string, kind: string, confidence: number): MockRow {
  return {
    id, client_id: CLIENT, owner_user_id: OWNER,
    layer: 'bridge', kind, content: `atom ${id} content`, structured: {},
    source: 'brief', source_ref: null, confidence, evidence_count: 2,
    status: 'active', superseded_by: null, superseded_reason: null,
    first_seen_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-15T00:00:00.000Z',
  };
}

function autonomyRow(mode: string, over: Partial<Record<string, unknown>> = {}): MockRow {
  return {
    id: 'aut-1', client_id: CLIENT, owner_user_id: OWNER, mode,
    caps: {}, approvals_total: 0, approvals_approved: 0,
    mode_since: '2026-06-01T00:00:00.000Z',
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

let db: SupabaseMock;

beforeEach(() => {
  db = mockSupabase();
  db.seed('client_insights', [
    insightRow('atom-1', 'desire', 0.8),
    insightRow('atom-2', 'objection', 0.6),
  ]);
});

describe('runMonthlyTick — strategy re-sync', () => {
  it('synthesizes and persists a message-architecture version, noted on the run', async () => {
    const result = await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });

    const versions = db.rows('message_architectures');
    expect(versions).toHaveLength(1);
    expect(result.notes.some((n) => n.includes('strategy re-synthesized'))).toBe(true);
  });

  it('respects skip-on-identical: a second run with unchanged atoms writes no new version', async () => {
    await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });
    const result = await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });

    expect(db.rows('message_architectures')).toHaveLength(1);
    expect(result.notes.some((n) => n.includes('strategy re-sync skipped') && n.includes('identical'))).toBe(true);
  });
});

describe('runMonthlyTick — mode suggestion (D1: suggest, never switch)', () => {
  it('an earned track record → suggestion recorded, propose_only action, and in the monthly digest', async () => {
    // 30 days in propose_approve, 19/20 approvals — clears every bar.
    db.seed('client_autonomy', [autonomyRow('propose_approve', { approvals_total: 20, approvals_approved: 19 })]);

    const result = await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });

    // The audit event the owner will actually see.
    const events = db.rows('autonomy_events');
    const suggestion = events.find((e) => e.event === 'mode_suggestion');
    expect(suggestion).toBeDefined();
    expect(suggestion?.to_mode).toBe('act_within_caps');

    // Recorded on the run as a proposal (propose_only asks by definition).
    const action = result.actions.find((a) => a.kind === 'propose_only');
    expect(action?.route).toBe('propose');
    expect(action?.rationale).toContain('95%');

    // And the digest — the felt surface — carries it as an approval request.
    const digests = db.rows('digests');
    expect(digests).toHaveLength(1);
    expect(digests[0].kind).toBe('monthly');
    expect(digests[0].period_start).toBe('2026-07-01');
    expect(digests[0].period_end).toBe('2026-07-31');
    expect(JSON.stringify(digests[0].content)).toContain('mode_suggestion');

    // THE MODE ITSELF NEVER MOVED — only the owner's setMode does that.
    expect(db.rows('client_autonomy')[0].mode).toBe('propose_approve');
  });

  it('act_within_caps client → no suggestion (nothing above the top rung)', async () => {
    db.seed('client_autonomy', [autonomyRow('act_within_caps', { approvals_total: 50, approvals_approved: 50 })]);

    const result = await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });

    expect(db.rows('autonomy_events').filter((e) => e.event === 'mode_suggestion')).toHaveLength(0);
    expect(result.actions.filter((a) => a.kind === 'propose_only')).toHaveLength(0);
    expect(result.notes.some((n) => n.includes('no mode suggestion'))).toBe(true);
    // The digest still composes — the monthly report is unconditional.
    expect(db.rows('digests')).toHaveLength(1);
  });

  it('an insufficient track record → no suggestion either', async () => {
    // Only 3 decided approvals — below SUGGESTION_MIN_APPROVALS.
    db.seed('client_autonomy', [autonomyRow('propose_approve', { approvals_total: 3, approvals_approved: 3 })]);

    const result = await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });
    expect(db.rows('autonomy_events').filter((e) => e.event === 'mode_suggestion')).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
  });
});

describe('runMonthlyTick — channel reconciliation (H4-gated seam)', () => {
  it('no platformClaims provider → honest skip note, no reconciliation rows', async () => {
    const result = await runMonthlyTick(ctx(), { supabase: db.client, now: NOW });
    expect(result.notes.some((n) => n.includes('reconciliation skipped') && n.includes('H4'))).toBe(true);
    expect(db.rows('channel_reconciliation')).toHaveLength(0);
  });

  it('provider returns null → skip note (no data for the period), no rows', async () => {
    const result = await runMonthlyTick(ctx(), {
      supabase: db.client, now: NOW,
      platformClaims: async () => null,
    });
    expect(result.notes.some((n) => n.includes('provider returned no data'))).toBe(true);
    expect(db.rows('channel_reconciliation')).toHaveLength(0);
  });

  it('provider returns claims → reconciliation runs, verdict noted with the numbers', async () => {
    // One CRM-truth lead this period, acquired via paid Meta.
    db.seed('funnel_leads', [{
      id: 'lead-1', client_id: CLIENT, owner_user_id: OWNER,
      source: 'landing', source_ref: {}, name: 'א', phone: '0501111111', email: null,
      consent_marketing: false, consent_recorded_at: null,
      current_stage: 'new', value: null,
      created_at: '2026-07-10T10:00:00.000Z', updated_at: '2026-07-10T10:00:00.000Z',
    }]);
    db.seed('lead_touchpoints', [{
      id: 'tp-1', lead_id: 'lead-1', client_id: CLIENT, owner_user_id: OWNER,
      fbclid: 'fb.1.x', gclid: null, ctwa_clid: null, meta_lead_id: null,
      utm: { source: 'facebook', medium: 'cpc' },
      landing_path: '/lp/x', referrer: null, user_agent: null,
      captured_at: '2026-07-10T10:00:00.000Z',
    }]);

    const seen: Array<{ clientId: string; period: { start: string; end: string } }> = [];
    const result = await runMonthlyTick(ctx(), {
      supabase: db.client, now: NOW,
      platformClaims: async (clientId, period) => {
        seen.push({ clientId, period });
        return { meta_paid: 2 };
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].clientId).toBe(CLIENT);
    expect(seen[0].period.start).toBe('2026-07-01');
    const note = result.notes.find((n) => n.startsWith('reconciliation meta_paid'));
    expect(note).toBeDefined();
    expect(note).toContain('claimed 2 / truth 1');
    expect(db.rows('channel_reconciliation').length).toBeGreaterThan(0);
  });

  it('provider throwing → failure note, the tick and its digest are unaffected', async () => {
    const result = await runMonthlyTick(ctx(), {
      supabase: db.client, now: NOW,
      platformClaims: async () => { throw new Error('meta api down'); },
    });
    expect(result.notes.some((n) => n.includes('reconciliation failed') && n.includes('meta api down'))).toBe(true);
    expect(result.notes.some((n) => n.includes('monthly digest'))).toBe(true);
  });
});
