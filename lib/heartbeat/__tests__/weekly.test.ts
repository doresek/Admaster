// Weekly-tick tests — THE HEADLINE: the Monday morning plan. Slate planned at
// the client's budget, ONE campaign created through the injected runner
// (one-per-week discipline), proposals landing in the weekly digest (the
// approval surface), and the draft-registration path. MOCKED Supabase,
// injected runner + clock — no DB, no LLM, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HypothesisRow } from '@/lib/capability-contracts';
import type { HypothesisCandidate, SlateSelection } from '@/lib/experiments';
import {
  runWeeklyTick,
  registerMissingSelections,
  draftRegistrationInput,
} from '../ticks/weekly';
import type { CampaignRunner, TickContext } from '../types';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';
// Wednesday; the ISO week runs Mon 2026-06-29 .. Sun 2026-07-05.
const NOW = new Date('2026-07-01T06:00:00.000Z');

const ctx = (): TickContext => ({
  clientId:    CLIENT,
  ownerUserId: OWNER,
  tick:        'weekly',
  runId:       'run-1',
  shock:       null,
  notes:       [],
});

function clientRow(): MockRow {
  return {
    id: CLIENT, owner_user_id: OWNER, name: 'מרפאת שיניים חיוך',
    email: null, phone: null, company: null, notes: null,
    connect_token: null, connect_expires_at: null, connect_consumed_at: null,
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
  };
}

function insightRow(id: string, confidence: number): MockRow {
  return {
    id, client_id: CLIENT, owner_user_id: OWNER,
    layer: 'bridge', kind: 'angle', content: `angle atom ${id}`, structured: {},
    source: 'brief', source_ref: null, confidence, evidence_count: 1,
    status: 'active', superseded_by: null, superseded_reason: null,
    first_seen_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
  };
}

/** An OPEN, registered, cheaply-resolvable candidate (₪40 to floor over 7 days). */
function candidateRow(id: string, insightId: string): MockRow {
  return {
    id, client_id: CLIENT, owner_user_id: OWNER,
    insight_ids: [insightId],
    claim:       `test ${id}: the ${insightId} angle beats control`,
    prediction:  { metric: 'ctr', comparator: 'gte', value: 0.005, arm: 'A', confidence: 0.7 },
    floor_spec:  { metric_grade: 'ctr', per_arm: { impressions: 500 } },
    horizon:     { max_days: 7 },
    verdict_map: {
      supported:    [{ insight_id: insightId, polarity: 'positive', weight: 0.4 }],
      refuted:      [{ insight_id: insightId, polarity: 'negative', weight: 0.3 }],
      inconclusive: [],
    },
    kill_rules:  {},
    test_refs:   [{ arm_label: 'A' }, { arm_label: 'B' }],
    domain:      'angle',
    status:      'open',
    resolution:  null,
    registered_at: '2026-06-28T00:00:00.000Z',
    resolved_at: null, superseded_by: null,
    created_at: '2026-06-28T00:00:00.000Z', updated_at: '2026-06-28T00:00:00.000Z',
  };
}

/** A daily run earlier this ISO week that left a pending proposal. */
function dailyRunWithProposal(): MockRow {
  return {
    id: 'run-daily-1', client_id: CLIENT, owner_user_id: OWNER,
    tick_type: 'daily', status: 'succeeded', attention: {},
    actions: [
      { kind: 'pause_paid', ref: 'hyp-9', rationale: 'kill: arm X below mercy floor', route: 'propose' },
      { kind: 'resolve_hypothesis', ref: 'hyp-8', rationale: 'floor met', route: 'execute' },
    ],
    notes: [], tokens_used: null, error: null, lease_until: null,
    started_at: '2026-06-30T06:00:00.000Z', finished_at: '2026-06-30T06:01:00.000Z',
    created_at: '2026-06-30T06:00:00.000Z',
  };
}

let db: SupabaseMock;
let runner: ReturnType<typeof vi.fn<CampaignRunner>>;

beforeEach(() => {
  db = mockSupabase();
  runner = vi.fn<CampaignRunner>(async () => ({
    campaignId: 'camp-9', status: 'assembled', dryRun: true, notes: ['dry-run assembly'],
  }));
  db.seed('clients', [clientRow()]);
  db.seed('client_insights', [insightRow('atom-1', 0.5), insightRow('atom-2', 0.45)]);
});

describe('runWeeklyTick — the headline', () => {
  it('plans the slate, creates exactly ONE dry-run campaign, and composes the digest with pending approvals', async () => {
    db.seed('hypotheses', [candidateRow('hyp-1', 'atom-1'), candidateRow('hyp-2', 'atom-2')]);
    db.seed('heartbeat_runs', [dailyRunWithProposal()]);

    const result = await runWeeklyTick(ctx(), { supabase: db.client, now: NOW, campaignRunner: runner });

    // Slate planned at the conservative default budget (no monthly_budget on prod).
    expect(result.notes.some((n) => n.includes('slate: 2 selected'))).toBe(true);
    expect(result.notes.some((n) => n.includes('₪50/day'))).toBe(true);

    // ONE campaign, dry-run, paid, PAUSED-by-construction (enforced in runCampaign).
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith({ clientId: CLIENT, ownerUserId: OWNER, channel: 'meta_paid' });
    const create = result.actions.find((a) => a.kind === 'create_paid_paused');
    expect(create?.route).toBe('execute'); // PAUSED creation moves no money → executes in propose_approve
    expect(result.notes.some((n) => n.includes('camp-9') && n.includes('dryRun=true'))).toBe(true);

    // One-per-week: the second selected test is queued as a note, not launched.
    expect(result.notes.some((n) => n.includes('one-per-week discipline') && n.includes('queued for next week'))).toBe(true);

    // The digest is the approval surface: the week's daily proposal landed in it.
    const digests = db.rows('digests');
    expect(digests).toHaveLength(1);
    expect(digests[0].kind).toBe('weekly');
    expect(digests[0].period_start).toBe('2026-06-29');
    expect(digests[0].period_end).toBe('2026-07-05');
    const content = JSON.stringify(digests[0].content);
    expect(content).toContain('kill: arm X below mercy floor');
    // The executed daily action is NOT an approval request.
    expect(content).not.toContain('floor met');
  });

  it('does not create a second campaign when one is already live (note instead)', async () => {
    db.seed('hypotheses', [candidateRow('hyp-1', 'atom-1')]);
    db.seed('campaigns', [{
      id: 'camp-old', client_id: CLIENT, owner_user_id: OWNER, status: 'live',
      created_at: '2026-06-10T00:00:00.000Z',
    }]);

    const result = await runWeeklyTick(ctx(), { supabase: db.client, now: NOW, campaignRunner: runner });

    expect(runner).not.toHaveBeenCalled();
    expect(result.actions.filter((a) => a.kind === 'create_paid_paused')).toHaveLength(0);
    expect(result.notes.some((n) => n.includes('one-per-week discipline') && n.includes('live'))).toBe(true);
  });

  it('does not create when ANY campaign was already created this ISO week (even a failed one)', async () => {
    db.seed('hypotheses', [candidateRow('hyp-1', 'atom-1')]);
    db.seed('campaigns', [{
      id: 'camp-mon', client_id: CLIENT, owner_user_id: OWNER, status: 'failed',
      created_at: '2026-06-29T09:00:00.000Z',
    }]);

    const result = await runWeeklyTick(ctx(), { supabase: db.client, now: NOW, campaignRunner: runner });
    expect(runner).not.toHaveBeenCalled();
    expect(result.notes.some((n) => n.includes('already created this ISO week'))).toBe(true);
  });

  it('draft_only: creation is PROPOSED — runner NOT called, proposal lands in the digest approvals', async () => {
    db.seed('hypotheses', [candidateRow('hyp-1', 'atom-1')]);
    db.seed('client_autonomy', [{
      id: 'aut-1', client_id: CLIENT, owner_user_id: OWNER, mode: 'draft_only',
      caps: {}, approvals_total: 0, approvals_approved: 0,
      mode_since: '2026-06-01T00:00:00.000Z',
      created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
    }]);

    const result = await runWeeklyTick(ctx(), { supabase: db.client, now: NOW, campaignRunner: runner });

    expect(runner).not.toHaveBeenCalled();
    const create = result.actions.find((a) => a.kind === 'create_paid_paused');
    expect(create?.route).toBe('propose');
    // The audit says proposed; the digest carries the ask.
    expect(db.rows('autonomy_events').some((e) => e.event === 'action_proposed')).toBe(true);
    const content = JSON.stringify(db.rows('digests')[0].content);
    expect(content).toContain('weekly slate top pick');
  });

  it('skips (with the reason) when the client row is gone', async () => {
    db.seed('clients', []);
    const result = await runWeeklyTick(ctx(), { supabase: db.client, now: NOW, campaignRunner: runner });
    expect(result.skipped).toContain('not found');
    expect(runner).not.toHaveBeenCalled();
  });

  it('a runner failure after an execute verdict is noted loudly, never swallowed', async () => {
    db.seed('hypotheses', [candidateRow('hyp-1', 'atom-1')]);
    runner.mockRejectedValueOnce(new Error('meta sandbox exploded'));

    const result = await runWeeklyTick(ctx(), { supabase: db.client, now: NOW, campaignRunner: runner });
    expect(result.notes.some((n) => n.includes('campaign creation FAILED') && n.includes('meta sandbox exploded'))).toBe(true);
  });
});

describe('registerMissingSelections — the draft-registration path', () => {
  const draftCandidate: HypothesisCandidate = {
    id:          'draft-1',
    claim:       'הזווית של ביטחון רגשי תנצח את זווית המחיר',
    insight_ids: ['atom-1'],
    domain:      'angle',
    kind:        'contested_atom',
    floor_spec:  { metric_grade: 'ctr', per_arm: { impressions: 500 } },
    horizon:     { max_days: 7 },
    arm_count:   2,
    // no `hypothesis` — this is a draft from a future candidate source
  };
  const selection: SlateSelection = {
    candidate:        draftCandidate,
    score:            { decision_weight: 1.5, belief_movement: 1, est_cost_to_floor_ils: 40, info_value: 0.0375 },
    daily_budget:     6,
    min_viable_daily: 6,
  };

  it('registers the draft via registerHypothesisChecked (frozen minimal A/B claim)', async () => {
    const notes: string[] = [];
    await registerMissingSelections(db.client, CLIENT, OWNER, [selection], notes);

    const rows = db.rows('hypotheses');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('open');
    expect(rows[0].claim).toBe(draftCandidate.claim);
    const prediction = rows[0].prediction;
    expect(prediction).toMatchObject({ comparator: 'ratio_gte', value: 1.0, arm: 'variant', baseline_arm: 'control' });
    expect(notes.some((n) => n.includes('registered hypothesis'))).toBe(true);
  });

  it('surfaces "already tried" priors as notes', async () => {
    const resolved: MockRow = {
      ...candidateRow('hyp-old', 'atom-1'),
      status: 'refuted',
      resolved_at: '2026-06-20T00:00:00.000Z',
    };
    db.seed('hypotheses', [resolved]);

    const notes: string[] = [];
    await registerMissingSelections(db.client, CLIENT, OWNER, [selection], notes);
    expect(notes.some((n) => n.startsWith('prior:') && n.includes('hyp-old'))).toBe(true);
  });

  it('never re-registers an already-registered selection', async () => {
    db.seed('hypotheses', [candidateRow('hyp-1', 'atom-1')]);
    // A typed hypothesis row on the candidate — the tick only checks presence.
    const hypothesis: HypothesisRow = {
      id: 'hyp-1', client_id: CLIENT, owner_user_id: OWNER, insight_ids: ['atom-1'],
      claim: 'test hyp-1', domain: 'angle', status: 'open',
      prediction:  { metric: 'ctr', comparator: 'gte', value: 0.005, arm: 'A', confidence: 0.7 },
      floor_spec:  { metric_grade: 'ctr', per_arm: { impressions: 500 } },
      horizon:     { max_days: 7 },
      verdict_map: {
        supported:    [{ insight_id: 'atom-1', polarity: 'positive', weight: 0.4 }],
        refuted:      [{ insight_id: 'atom-1', polarity: 'negative', weight: 0.3 }],
        inconclusive: [],
      },
      kill_rules: {}, test_refs: [{ arm_label: 'A' }, { arm_label: 'B' }],
      resolution: null, registered_at: '2026-06-28T00:00:00.000Z', resolved_at: null,
      superseded_by: null, created_at: '2026-06-28T00:00:00.000Z', updated_at: '2026-06-28T00:00:00.000Z',
    };
    const registered: SlateSelection = {
      ...selection,
      candidate: { ...draftCandidate, id: 'hyp-1', hypothesis },
    };
    const notes: string[] = [];
    await registerMissingSelections(db.client, CLIENT, OWNER, [registered], notes);
    expect(db.rows('hypotheses')).toHaveLength(1);
  });

  it('draftRegistrationInput flips to ratio_lte for cost grades (cpa: lower is better)', () => {
    const input = draftRegistrationInput(
      { ...draftCandidate, floor_spec: { metric_grade: 'cpa', per_arm: { conversions: 20 } } },
      CLIENT,
      OWNER,
    );
    expect(input.prediction.comparator).toBe('ratio_lte');
  });
});
