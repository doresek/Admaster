// loadDigestInputs — one query per table (no N+1), period scoping,
// defensive row narrowing (malformed rows skipped with warnings).

import { describe, expect, it } from 'vitest';
import { loadDigestInputs } from '../load';
import { CLIENT_ID, OWNER_ID, PERIOD, dentalWeekInputs } from './fixtures';
import { mockSupabase, type SupabaseMock } from './mock-supabase';

const PARAMS = {
  clientId:    CLIENT_ID,
  ownerUserId: OWNER_ID,
  periodStart: PERIOD.start,
  periodEnd:   PERIOD.end,
} as const;

/** Seed the mock DB from the compose fixture rows (they mirror the schemas). */
function seedDentalWeek(mock: SupabaseMock): void {
  const f = dentalWeekInputs();
  mock.seed('campaigns', f.campaigns.map((r) => ({ ...r })));
  mock.seed('campaign_decisions', f.decisions.map((r) => ({ ...r })));
  mock.seed('campaign_items', f.items.map((r) => ({ ...r, client_id: CLIENT_ID, owner_user_id: OWNER_ID })));
  mock.seed('diagnoses', f.diagnoses.map((r) => ({ ...r })));
  mock.seed('hypotheses', [...f.hypotheses.resolved, ...f.hypotheses.open].map((r) => ({ ...r })));
  mock.seed('content_performance', f.performance.map((r) => ({ ...r })));
  mock.seed('client_insights', f.insights.map((r) => ({ ...r })));
}

describe('loadDigestInputs', () => {
  it('issues exactly ONE select per table (no N+1)', async () => {
    const mock = mockSupabase();
    seedDentalWeek(mock);

    await loadDigestInputs(mock.client, PARAMS);

    const selects = mock.log.filter((op) => op.startsWith('select:'));
    expect(selects.sort()).toEqual([
      'select:campaign_decisions',
      'select:campaign_items',
      'select:campaigns',
      'select:client_insights',
      'select:content_performance',
      'select:diagnoses',
      'select:hypotheses',
    ]);
  });

  it('loads the full fixture week, split into the compose input shape', async () => {
    const mock = mockSupabase();
    seedDentalWeek(mock);

    const { inputs, warnings } = await loadDigestInputs(mock.client, PARAMS);
    expect(warnings).toEqual([]);
    expect(inputs.campaigns.map((c) => c.id).sort()).toEqual(['camp-price', 'camp-safety']);
    expect(inputs.decisions).toHaveLength(4);
    expect(inputs.items).toHaveLength(2);
    expect(inputs.diagnoses.map((d) => d.id)).toEqual(['diag-funnel']);
    expect(inputs.hypotheses.resolved.map((h) => h.id)).toEqual(['hyp-supported']);
    expect(inputs.hypotheses.open.map((h) => h.id)).toEqual(['hyp-lookalike']);
    expect(inputs.performance.map((p) => p.id)).toEqual(['perf-safety-1']);
    expect(inputs.insights).toHaveLength(2);
    expect(inputs.period).toEqual({ kind: 'weekly', start: PERIOD.start, end: PERIOD.end });
    expect(inputs.approvalsNeeded).toEqual([]);
  });

  it('applies period filters: out-of-period rows are excluded', async () => {
    const mock = mockSupabase();
    seedDentalWeek(mock);
    // decision recorded BEFORE the period
    mock.rows('campaign_decisions').push({
      id: 'dec-old', campaign_id: 'camp-safety', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      decision_type: 'angle', decision: { angle: 'ישן' }, grounded_in: [],
      rationale: 'החלטה ישנה', created_at: '2026-06-01T08:00:00Z',
    });
    // diagnosis AFTER the period
    mock.rows('diagnoses').push({
      id: 'diag-late', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      scope_campaign_id: null, scope_item_id: null, failed_link: 'hook',
      rationale: 'מאוחר מדי', created_at: '2026-07-05T08:00:00Z',
    });
    // hypothesis resolved BEFORE the period → excluded from both buckets
    mock.rows('hypotheses').push({
      id: 'hyp-old', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      claim: 'השערה ישנה', status: 'refuted', resolution: null,
      registered_at: '2026-05-01T08:00:00Z', resolved_at: '2026-06-10T08:00:00Z',
    });
    // completed campaign untouched since long before the period → not "active in period"
    mock.rows('campaigns').push({
      id: 'camp-history', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      name: 'קמפיין היסטורי', objective: null, channel: 'meta_paid', status: 'completed',
      daily_budget: null, funnel_stage: null, meta_campaign_id: null, dry_run: true,
      grounded_in: [], rationale: null,
      created_at: '2026-04-01T08:00:00Z', updated_at: '2026-04-20T08:00:00Z',
    });
    // another client's row never leaks in
    mock.rows('campaign_decisions').push({
      id: 'dec-foreign', campaign_id: null, client_id: 'someone-else-client',
      owner_user_id: 'someone-else', decision_type: 'angle', decision: {},
      grounded_in: [], rationale: 'לא שלך', created_at: '2026-06-24T08:00:00Z',
    });

    const { inputs } = await loadDigestInputs(mock.client, PARAMS);
    expect(inputs.decisions.map((d) => d.id)).not.toContain('dec-old');
    expect(inputs.decisions.map((d) => d.id)).not.toContain('dec-foreign');
    expect(inputs.diagnoses.map((d) => d.id)).not.toContain('diag-late');
    expect(inputs.hypotheses.resolved.map((h) => h.id)).not.toContain('hyp-old');
    expect(inputs.hypotheses.open.map((h) => h.id)).not.toContain('hyp-old');
    expect(inputs.campaigns.map((c) => c.id)).not.toContain('camp-history');
  });

  it('skips malformed rows with warnings instead of throwing', async () => {
    const mock = mockSupabase();
    seedDentalWeek(mock);
    // campaign missing its name; decision with an unknown type; perf with bad metrics
    mock.rows('campaigns').push({
      id: 'camp-broken', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      name: null, objective: null, channel: 'meta_paid', status: 'live',
      daily_budget: null, funnel_stage: null, meta_campaign_id: null, dry_run: true,
      grounded_in: [], rationale: null,
      created_at: '2026-06-24T08:00:00Z', updated_at: '2026-06-24T08:00:00Z',
    });
    mock.rows('campaign_decisions').push({
      id: 'dec-weird', campaign_id: 'camp-safety', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      decision_type: 'vibes', decision: {}, grounded_in: [], rationale: 'סתם',
      created_at: '2026-06-24T08:00:00Z',
    });
    mock.rows('content_performance').push({
      id: 'perf-broken', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      campaign_item_id: 'item-safety-1', artifact_id: null, metrics: 'not-an-object',
      verdict: 'worked', period_start: PERIOD.start, period_end: PERIOD.end,
      created_at: '2026-06-28T08:00:00Z',
    });

    const { inputs, warnings } = await loadDigestInputs(mock.client, PARAMS);
    expect(warnings).toEqual([
      'campaigns: skipped malformed row (id=camp-broken)',
      'campaign_decisions: skipped malformed row (id=dec-weird)',
      'content_performance: skipped malformed row (id=perf-broken)',
    ]);
    expect(inputs.campaigns.map((c) => c.id)).not.toContain('camp-broken');
    expect(inputs.decisions.map((d) => d.id)).not.toContain('dec-weird');
    expect(inputs.performance.map((p) => p.id)).not.toContain('perf-broken');
  });

  it('performance rows outside the period window are narrowed out', async () => {
    const mock = mockSupabase();
    seedDentalWeek(mock);
    // next week's row (created after, period after) — excluded
    mock.rows('content_performance').push({
      id: 'perf-next-week', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      campaign_item_id: 'item-safety-1', artifact_id: null,
      metrics: { impressions: 999 }, verdict: null,
      period_start: '2026-06-29', period_end: '2026-07-05',
      created_at: '2026-07-06T08:00:00Z',
    });
    // late-ingested row FOR this period (created after period end) — included
    mock.rows('content_performance').push({
      id: 'perf-late-ingest', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      campaign_item_id: 'item-price-1', artifact_id: null,
      metrics: { impressions: 100 }, verdict: null,
      period_start: PERIOD.start, period_end: PERIOD.end,
      created_at: '2026-06-30T08:00:00Z',
    });

    const { inputs } = await loadDigestInputs(mock.client, PARAMS);
    const ids = inputs.performance.map((p) => p.id).sort();
    expect(ids).toEqual(['perf-late-ingest', 'perf-safety-1']);
  });
});
