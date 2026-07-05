// loadMetricInputs — the loader contract:
//   • ONE query per table (5 total; no N+1) — enforced by stub op counts;
//   • both periods split correctly from a single range read;
//   • prev campaigns deliberately empty (no historical spend until H4);
//   • malformed rows narrowed out with warnings; DB errors thrown with the
//     table name (never swallowed).

import { describe, expect, it } from 'vitest';
import { loadMetricInputs, previousPeriod } from '../load';
import {
  CLIENT_ID,
  CURRENT_PERIOD,
  OWNER_ID,
  makeCampaign,
  makeEconomics,
  makeEvent,
  makeLead,
  makeRecon,
} from './fixtures';
import { mockSupabase } from './mock-supabase';

const PARAMS = {
  clientId:    CLIENT_ID,
  ownerUserId: OWNER_ID,
  periodStart: CURRENT_PERIOD.start, // 2026-06-22
  periodEnd:   CURRENT_PERIOD.end,   // 2026-06-28
};

function seededMock() {
  const mock = mockSupabase();
  mock.seed('funnel_leads', [
    makeLead({ id: 'lead-cur',    created_at: '2026-06-23T08:00:00Z' }),
    makeLead({ id: 'lead-prev',   created_at: '2026-06-16T08:00:00Z' }),
    makeLead({ id: 'lead-old',    created_at: '2026-06-10T08:00:00Z' }), // before the range
    makeLead({ id: 'lead-future', created_at: '2026-06-29T05:00:00Z' }), // after the range
  ]);
  mock.seed('lead_stage_events', [
    makeEvent({ id: 'ev-cur',  lead_id: 'lead-cur',  created_at: '2026-06-24T09:00:00Z' }),
    makeEvent({ id: 'ev-prev', lead_id: 'lead-prev', created_at: '2026-06-17T09:00:00Z' }),
  ]);
  mock.seed('channel_reconciliation', [
    makeRecon({ id: 'rec-cur',  period_start: '2026-06-22', period_end: '2026-06-28' }),
    makeRecon({ id: 'rec-prev', period_start: '2026-06-15', period_end: '2026-06-21' }),
    makeRecon({ id: 'rec-old',  period_start: '2026-06-01', period_end: '2026-06-07' }),
    makeRecon({ id: 'rec-span', period_start: '2026-06-18', period_end: '2026-06-24' }), // straddles both
  ]);
  mock.seed('client_economics', [makeEconomics()]);
  // MetricCampaignRow is the loader's SELECT slice; the seeded DB rows also
  // carry the scoping columns the loader filters on.
  mock.seed('campaigns', [
    { ...makeCampaign({ id: 'camp-1', daily_budget: 100 }), client_id: CLIENT_ID, owner_user_id: OWNER_ID },
    { ...makeCampaign({ id: 'camp-2', status: 'paused', daily_budget: 50 }), client_id: CLIENT_ID, owner_user_id: OWNER_ID },
  ]);
  return mock;
}

describe('loadMetricInputs — query discipline', () => {
  it('issues exactly ONE query per table (5 total, no N+1)', async () => {
    const mock = seededMock();
    await loadMetricInputs(mock.client, PARAMS);
    expect(mock.log).toHaveLength(5);
    expect([...mock.log].sort()).toEqual([
      'select:campaigns',
      'select:channel_reconciliation',
      'select:client_economics',
      'select:funnel_leads',
      'select:lead_stage_events',
    ]);
  });

  it('propagates a DB error with the failing table named (never swallowed)', async () => {
    const mock = seededMock();
    mock.fail('lead_stage_events');
    await expect(loadMetricInputs(mock.client, PARAMS))
      .rejects.toThrow(/lead_stage_events.*injected failure/);
  });
});

describe('loadMetricInputs — period assembly', () => {
  it('splits leads/events into current vs previous; out-of-range rows never load', async () => {
    const mock = seededMock();
    const { inputs } = await loadMetricInputs(mock.client, PARAMS);
    expect(inputs.current.period).toEqual(CURRENT_PERIOD);
    expect(inputs.previous.period).toEqual({ start: '2026-06-15', end: '2026-06-21' });
    expect(inputs.current.leads.map((l) => l.id)).toEqual(['lead-cur']);
    expect(inputs.previous.leads.map((l) => l.id)).toEqual(['lead-prev']);
    expect(inputs.current.stageEvents.map((e) => e.id)).toEqual(['ev-cur']);
    expect(inputs.previous.stageEvents.map((e) => e.id)).toEqual(['ev-prev']);
  });

  it('reconciliation rows attach by OVERLAP — a straddling row reaches both slices', async () => {
    const mock = seededMock();
    const { inputs } = await loadMetricInputs(mock.client, PARAMS);
    expect(inputs.current.reconciliation.map((r) => r.id).sort()).toEqual(['rec-cur', 'rec-span']);
    expect(inputs.previous.reconciliation.map((r) => r.id).sort()).toEqual(['rec-prev', 'rec-span']);
  });

  it('previous.campaigns is EMPTY by design — planned spend has no history until H4, so the delta stays honestly null', async () => {
    const mock = seededMock();
    const { inputs } = await loadMetricInputs(mock.client, PARAMS);
    expect(inputs.current.campaigns.map((c) => c.id).sort()).toEqual(['camp-1', 'camp-2']);
    expect(inputs.previous.campaigns).toEqual([]);
  });

  it('economics: loads the single row; absent → null (not an error)', async () => {
    const seeded = seededMock();
    const withEcon = await loadMetricInputs(seeded.client, PARAMS);
    expect(withEcon.inputs.economics?.contribution_margin_pct).toBe(40);

    const bare = mockSupabase();
    const withoutEcon = await loadMetricInputs(bare.client, PARAMS);
    expect(withoutEcon.inputs.economics).toBeNull();
  });
});

describe('loadMetricInputs — runtime narrowing', () => {
  it('skips malformed rows with a warning; well-formed rows still load', async () => {
    const mock = seededMock();
    mock.seed('funnel_leads', [
      makeLead({ id: 'lead-cur', created_at: '2026-06-23T08:00:00Z' }),
      // stage outside the CHECK vocabulary — must not reach a formula
      { ...makeLead({ id: 'lead-bad', created_at: '2026-06-23T09:00:00Z' }), current_stage: 'exploded' },
    ]);
    const { inputs, warnings } = await loadMetricInputs(mock.client, PARAMS);
    expect(inputs.current.leads.map((l) => l.id)).toEqual(['lead-cur']);
    expect(warnings).toEqual(['funnel_leads: skipped malformed row (id=lead-bad)']);
  });

  it('malformed economics row → null + warning (money math never runs on garbage)', async () => {
    const mock = seededMock();
    mock.seed('client_economics', [
      { ...makeEconomics(), contribution_margin_pct: 'forty' },
    ]);
    const { inputs, warnings } = await loadMetricInputs(mock.client, PARAMS);
    expect(inputs.economics).toBeNull();
    expect(warnings).toEqual(['client_economics: skipped malformed row (id=econ-1)']);
  });
});

describe('previousPeriod', () => {
  it('mirrors the period length immediately before (week + month boundary)', () => {
    expect(previousPeriod({ start: '2026-06-22', end: '2026-06-28' }))
      .toEqual({ start: '2026-06-15', end: '2026-06-21' });
    expect(previousPeriod({ start: '2026-07-01', end: '2026-07-07' }))
      .toEqual({ start: '2026-06-24', end: '2026-06-30' });
    expect(previousPeriod({ start: '2026-06-01', end: '2026-06-30' }))
      .toEqual({ start: '2026-05-02', end: '2026-05-31' });
  });
});
