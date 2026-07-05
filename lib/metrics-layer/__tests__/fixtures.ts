// Typed fixture builders + the hand-math "clinic month" scenario every
// registry/compute test computes BY HAND in its assertions. All rows are fully
// typed spine rows (capability-contracts) — no `as`, no partial casting.

import type {
  ChannelReconciliationRow,
  ClientEconomicsRow,
  FunnelLeadRow,
  LeadStageEventRow,
} from '@/lib/capability-contracts';
import type { MetricCampaignRow, MetricInputs, MetricPeriod } from '../types';

export const CLIENT_ID = 'client-clinic-1';
export const OWNER_ID  = 'owner-1';

export const CURRENT_PERIOD: MetricPeriod = { start: '2026-06-22', end: '2026-06-28' }; // 7 days
export const PREVIOUS_PERIOD: MetricPeriod = { start: '2026-06-15', end: '2026-06-21' };

// ── builders ──────────────────────────────────────────────────────────────────

export function makeLead(over: Partial<FunnelLeadRow> & { id: string }): FunnelLeadRow {
  return {
    client_id:           CLIENT_ID,
    owner_user_id:       OWNER_ID,
    source:              'landing',
    source_ref:          {},
    name:                null,
    phone:               null,
    email:               null,
    consent_marketing:   false,
    consent_recorded_at: null,
    current_stage:       'new',
    value:               null,
    created_at:          '2026-06-22T08:00:00Z',
    updated_at:          '2026-06-22T08:00:00Z',
    ...over,
  };
}

export function makeEvent(over: Partial<LeadStageEventRow> & { id: string; lead_id: string }): LeadStageEventRow {
  return {
    client_id:     CLIENT_ID,
    owner_user_id: OWNER_ID,
    stage:         'contacted',
    value:         null,
    marked_via:    'ui',
    note:          null,
    created_at:    '2026-06-22T10:00:00Z',
    ...over,
  };
}

export function makeRecon(over: Partial<ChannelReconciliationRow> & { id: string }): ChannelReconciliationRow {
  return {
    client_id:        CLIENT_ID,
    owner_user_id:    OWNER_ID,
    channel:          'meta_paid',
    period_start:     CURRENT_PERIOD.start,
    period_end:       CURRENT_PERIOD.end,
    platform_claimed: 0,
    crm_truth:        0,
    ratio:            null,
    note:             null,
    created_at:       '2026-06-29T00:00:00Z',
    ...over,
  };
}

export function makeCampaign(over: Partial<MetricCampaignRow> & { id: string }): MetricCampaignRow {
  return {
    status:       'live',
    channel:      'meta_paid',
    daily_budget: null,
    dry_run:      false,
    created_at:   '2026-06-01T00:00:00Z',
    ...over,
  };
}

export function makeEconomics(over: Partial<ClientEconomicsRow> = {}): ClientEconomicsRow {
  return {
    id:                      'econ-1',
    client_id:               CLIENT_ID,
    owner_user_id:           OWNER_ID,
    contribution_margin_pct: 40,
    avg_deal_value:          3500,
    close_rate_pct:          25,
    payback_target_months:   6,
    currency:                'ILS',
    source:                  'owner',
    updated_at:              '2026-06-01T00:00:00Z',
    created_at:              '2026-06-01T00:00:00Z',
    ...over,
  };
}

// ── the clinic scenario (hand-math ground truth in comments) ──────────────────
//
// CURRENT period (7 days), 8 leads:
//   lead-1 qualified,   consent ✓, contacted 2h  after creation  (within 24h ✓)
//   lead-2 meeting,     consent ✗, first touch after 2 days      (✗)
//   lead-3 closed_won,  consent ✓, contacted 1h                  (✓)
//   lead-4 new,         consent ✗, no touch                      (✗)
//   lead-5 irrelevant,  consent ✗, marked irrelevant same day    (✓ — a mark IS a response)
//   lead-6 contacted,   consent ✗, touched after 36h             (✗)
//   lead-7 new,         consent ✓, no touch                      (✗)
//   lead-8 closed_lost, consent ✗, qualified event 23h after     (✓; qualified via EVENT)
//
// → leads_total 8 · leads_qualified 4 (1,2,3,8) · qualified_rate 50
// → irrelevant_rate 12.5 · consent_rate 37.5 · contacted_24h_rate 50
//
// Stage events also carry closes: lead-3 won ₪4200, lead-old (prev cohort) won
// ₪2800, lead-8 lost → close_rate 2/3 = 66.67 · closed_value 7000.
//
// Campaigns: live ₪100/day (counts) + live dry-run ₪500 (excluded) + paused
// ₪300 (excluded) → spend_total 100×7 = 700 · cost_per_lead 700/8 = 87.5.
// Economics cm 40% → break-even 2.5; ROAS 7000/700 = 10 → roas_vs_breakeven 4.
// Reconciliation: claimed 12+2=14 vs truth 8+2=10 → ratio 1.4.
//
// PREVIOUS period: 4 leads (one qualified), 1 contact event, recon 5/5 = 1,
// campaigns [] (no historical spend until H4) → prev spend null.

export function clinicInputs(): MetricInputs {
  const currentLeads: FunnelLeadRow[] = [
    makeLead({ id: 'lead-1', current_stage: 'qualified',   consent_marketing: true,  created_at: '2026-06-22T08:00:00Z' }),
    makeLead({ id: 'lead-2', current_stage: 'meeting',     created_at: '2026-06-23T08:00:00Z' }),
    makeLead({ id: 'lead-3', current_stage: 'closed_won',  consent_marketing: true,  created_at: '2026-06-23T08:00:00Z' }),
    makeLead({ id: 'lead-4', current_stage: 'new',         created_at: '2026-06-24T08:00:00Z' }),
    makeLead({ id: 'lead-5', current_stage: 'irrelevant',  created_at: '2026-06-24T08:00:00Z' }),
    makeLead({ id: 'lead-6', current_stage: 'contacted',   created_at: '2026-06-25T08:00:00Z' }),
    makeLead({ id: 'lead-7', current_stage: 'new',         consent_marketing: true,  created_at: '2026-06-26T08:00:00Z' }),
    makeLead({ id: 'lead-8', current_stage: 'closed_lost', created_at: '2026-06-26T08:00:00Z' }),
  ];

  const currentEvents: LeadStageEventRow[] = [
    makeEvent({ id: 'ev-1', lead_id: 'lead-1', stage: 'contacted',  created_at: '2026-06-22T10:00:00Z' }),
    makeEvent({ id: 'ev-2', lead_id: 'lead-2', stage: 'qualified',  created_at: '2026-06-25T09:00:00Z' }),
    makeEvent({ id: 'ev-3', lead_id: 'lead-3', stage: 'contacted',  created_at: '2026-06-23T09:00:00Z' }),
    makeEvent({ id: 'ev-4', lead_id: 'lead-3', stage: 'closed_won', value: 4200, created_at: '2026-06-27T12:00:00Z' }),
    makeEvent({ id: 'ev-5', lead_id: 'lead-5', stage: 'irrelevant', created_at: '2026-06-24T20:00:00Z' }),
    makeEvent({ id: 'ev-6', lead_id: 'lead-6', stage: 'contacted',  created_at: '2026-06-26T20:00:00Z' }),
    makeEvent({ id: 'ev-7', lead_id: 'lead-8', stage: 'qualified',  created_at: '2026-06-27T07:00:00Z' }),
    makeEvent({ id: 'ev-8', lead_id: 'lead-8', stage: 'closed_lost', created_at: '2026-06-28T10:00:00Z' }),
    // A close on a lead born BEFORE this period — decided-this-period truth.
    makeEvent({ id: 'ev-9', lead_id: 'lead-old', stage: 'closed_won', value: 2800, created_at: '2026-06-28T11:00:00Z' }),
  ];

  const currentRecon: ChannelReconciliationRow[] = [
    makeRecon({ id: 'rec-meta',   channel: 'meta_paid', platform_claimed: 12, crm_truth: 8, ratio: 1.5 }),
    makeRecon({ id: 'rec-google', channel: 'google',    platform_claimed: 2,  crm_truth: 2, ratio: 1 }),
  ];

  const campaigns: MetricCampaignRow[] = [
    makeCampaign({ id: 'camp-live',   status: 'live',   daily_budget: 100 }),
    makeCampaign({ id: 'camp-dry',    status: 'live',   daily_budget: 500, dry_run: true }),
    makeCampaign({ id: 'camp-paused', status: 'paused', daily_budget: 300 }),
  ];

  const previousLeads: FunnelLeadRow[] = [
    makeLead({ id: 'prev-1', current_stage: 'qualified', created_at: '2026-06-16T08:00:00Z' }),
    makeLead({ id: 'prev-2', created_at: '2026-06-17T08:00:00Z' }),
    makeLead({ id: 'prev-3', created_at: '2026-06-18T08:00:00Z' }),
    makeLead({ id: 'prev-4', created_at: '2026-06-19T08:00:00Z' }),
  ];

  return {
    current: {
      period:         CURRENT_PERIOD,
      leads:          currentLeads,
      stageEvents:    currentEvents,
      reconciliation: currentRecon,
      campaigns,
    },
    previous: {
      period:         PREVIOUS_PERIOD,
      leads:          previousLeads,
      stageEvents:    [makeEvent({ id: 'prev-ev-1', lead_id: 'prev-1', stage: 'contacted', created_at: '2026-06-16T09:00:00Z' })],
      reconciliation: [makeRecon({ id: 'rec-prev', period_start: PREVIOUS_PERIOD.start, period_end: PREVIOUS_PERIOD.end, platform_claimed: 5, crm_truth: 5, ratio: 1 })],
      campaigns:      [],
    },
    economics: makeEconomics(),
  };
}

/** A fully empty bundle — the totality grid's base case. */
export function emptyInputs(): MetricInputs {
  return {
    current:  { period: CURRENT_PERIOD,  leads: [], stageEvents: [], reconciliation: [], campaigns: [] },
    previous: { period: PREVIOUS_PERIOD, leads: [], stageEvents: [], reconciliation: [], campaigns: [] },
    economics: null,
  };
}
