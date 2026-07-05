// lib/metrics-layer/load.ts
//
// loadMetricInputs — assemble the ONE MetricInputs bundle the compute layer
// consumes. ONE query per table (no N+1; test-enforced by stub op counts),
// every query explicitly scoped to client + owner (lib/intelligence data-layer
// conventions), rows typed via .overrideTypes and then RUNTIME-NARROWED — a
// malformed row is skipped with a warning, never crashes computation and never
// poisons a dashboard number.
//
// Both periods (current + previous) are fetched in a single range read per
// table and split in memory — comparison data costs no extra round-trips.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChannelReconciliationRow,
  ClientEconomicsRow,
  FunnelLeadRow,
  LeadStage,
  LeadStageEventRow,
} from '@/lib/capability-contracts';
import { periodDaysInclusive } from './compute';
import type { MetricCampaignRow, MetricInputs, MetricPeriod } from './types';

export interface LoadMetricParams {
  clientId:    string;
  ownerUserId: string;
  /** YYYY-MM-DD inclusive. */
  periodStart: string;
  /** YYYY-MM-DD inclusive. */
  periodEnd:   string;
}

export interface LoadMetricResult {
  inputs:   MetricInputs;
  warnings: string[];
}

// ── guards (runtime narrowing — .overrideTypes is a claim, not a proof) ───────

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isNumberOrNull = (v: unknown): boolean => v === null || isFiniteNumber(v);

const LEAD_STAGES: readonly LeadStage[] =
  ['new', 'contacted', 'qualified', 'meeting', 'closed_won', 'closed_lost', 'irrelevant'];
const isLeadStage = (v: unknown): v is LeadStage => LEAD_STAGES.some((s) => s === v);

/** Keep only rows the guard accepts; warn (never throw) on the rest. */
function narrow<T>(
  rows:     readonly T[],
  table:    string,
  guard:    (row: T) => boolean,
  warnings: string[],
): T[] {
  const kept: T[] = [];
  for (const row of rows) {
    if (guard(row)) {
      kept.push(row);
    } else {
      const id = isRecord(row) && nonEmptyString(row['id']) ? row['id'] : '?';
      warnings.push(`${table}: skipped malformed row (id=${id})`);
    }
  }
  return kept;
}

// ── date helpers (deterministic, UTC-anchored — no Date.now / locale) ────────

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00.000Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Exclusive upper bound for timestamptz ranges: the day AFTER the last day. */
const nextDay = (isoDate: string): string => shiftDays(isoDate, 1);

/** The equal-length period immediately before [start..end]. */
export function previousPeriod(period: MetricPeriod): MetricPeriod {
  const days = Math.max(periodDaysInclusive(period), 1);
  const prevEnd = shiftDays(period.start, -1);
  return { start: shiftDays(prevEnd, -(days - 1)), end: prevEnd };
}

/** created_at (ISO timestamptz) falls inside a YYYY-MM-DD inclusive period. */
const inPeriod = (createdAt: string, period: MetricPeriod): boolean =>
  createdAt >= period.start && createdAt < nextDay(period.end);

/** Date-ranged reconciliation row overlaps the period. */
const overlapsPeriod = (row: ChannelReconciliationRow, period: MetricPeriod): boolean =>
  row.period_start <= period.end && row.period_end >= period.start;

// ── loader ────────────────────────────────────────────────────────────────────

const CAMPAIGN_COLUMNS = 'id, status, channel, daily_budget, dry_run, created_at';

/**
 * Load both periods' spine rows in 5 queries total: funnel_leads,
 * lead_stage_events, channel_reconciliation, client_economics, campaigns.
 */
export async function loadMetricInputs(
  supabase: SupabaseClient,
  params:   LoadMetricParams,
): Promise<LoadMetricResult> {
  const { clientId, ownerUserId } = params;
  const current: MetricPeriod = { start: params.periodStart, end: params.periodEnd };
  const previous = previousPeriod(current);
  const rangeStart    = previous.start;
  const rangeEndExcl  = nextDay(current.end);
  const warnings: string[] = [];

  // 1) funnel_leads — created anywhere in [prev.start .. current.end].
  const leadsQ = await supabase
    .from('funnel_leads')
    .select('id, client_id, owner_user_id, source, source_ref, name, phone, email, consent_marketing, consent_recorded_at, current_stage, value, created_at, updated_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', rangeStart)
    .lt('created_at', rangeEndExcl)
    .overrideTypes<FunnelLeadRow[], { merge: false }>();
  if (leadsQ.error) throw new Error(`loadMetricInputs(funnel_leads): ${leadsQ.error.message}`);
  const leads = narrow(
    leadsQ.data ?? [],
    'funnel_leads',
    (l) => nonEmptyString(l.id) && isLeadStage(l.current_stage)
        && nonEmptyString(l.created_at) && typeof l.consent_marketing === 'boolean'
        && isNumberOrNull(l.value),
    warnings,
  );

  // 2) lead_stage_events — recorded anywhere in the combined range.
  const eventsQ = await supabase
    .from('lead_stage_events')
    .select('id, lead_id, client_id, owner_user_id, stage, value, marked_via, note, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', rangeStart)
    .lt('created_at', rangeEndExcl)
    .overrideTypes<LeadStageEventRow[], { merge: false }>();
  if (eventsQ.error) throw new Error(`loadMetricInputs(lead_stage_events): ${eventsQ.error.message}`);
  const stageEvents = narrow(
    eventsQ.data ?? [],
    'lead_stage_events',
    (e) => nonEmptyString(e.id) && nonEmptyString(e.lead_id)
        && isLeadStage(e.stage) && nonEmptyString(e.created_at)
        && isNumberOrNull(e.value),
    warnings,
  );

  // 3) channel_reconciliation — rows whose own period overlaps the range.
  const reconQ = await supabase
    .from('channel_reconciliation')
    .select('id, client_id, owner_user_id, channel, period_start, period_end, platform_claimed, crm_truth, ratio, note, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('period_end', rangeStart)
    .lte('period_start', current.end)
    .overrideTypes<ChannelReconciliationRow[], { merge: false }>();
  if (reconQ.error) throw new Error(`loadMetricInputs(channel_reconciliation): ${reconQ.error.message}`);
  const reconciliation = narrow(
    reconQ.data ?? [],
    'channel_reconciliation',
    (r) => nonEmptyString(r.id) && nonEmptyString(r.period_start)
        && nonEmptyString(r.period_end)
        && isFiniteNumber(r.platform_claimed) && isFiniteNumber(r.crm_truth),
    warnings,
  );

  // 4) client_economics — one row per client (unique client_id).
  const econQ = await supabase
    .from('client_economics')
    .select('id, client_id, owner_user_id, contribution_margin_pct, avg_deal_value, close_rate_pct, payback_target_months, currency, source, updated_at, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<ClientEconomicsRow | null, { merge: false }>();
  if (econQ.error) throw new Error(`loadMetricInputs(client_economics): ${econQ.error.message}`);
  let economics: ClientEconomicsRow | null = econQ.data;
  if (economics !== null
      && !(nonEmptyString(economics.id)
        && isNumberOrNull(economics.contribution_margin_pct)
        && isNumberOrNull(economics.avg_deal_value)
        && isNumberOrNull(economics.close_rate_pct))) {
    warnings.push(`client_economics: skipped malformed row (id=${nonEmptyString(economics.id) ? economics.id : '?'})`);
    economics = null;
  }

  // 5) campaigns — the planned-spend slice (created before the range ends).
  const campaignsQ = await supabase
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .lt('created_at', rangeEndExcl)
    .overrideTypes<MetricCampaignRow[], { merge: false }>();
  if (campaignsQ.error) throw new Error(`loadMetricInputs(campaigns): ${campaignsQ.error.message}`);
  const campaigns = narrow(
    campaignsQ.data ?? [],
    'campaigns',
    (c) => nonEmptyString(c.id) && nonEmptyString(c.status)
        && typeof c.dry_run === 'boolean' && isNumberOrNull(c.daily_budget),
    warnings,
  );

  return {
    inputs: {
      current: {
        period:         current,
        leads:          leads.filter((l) => inPeriod(l.created_at, current)),
        stageEvents:    stageEvents.filter((e) => inPeriod(e.created_at, current)),
        reconciliation: reconciliation.filter((r) => overlapsPeriod(r, current)),
        campaigns,
      },
      previous: {
        period:         previous,
        leads:          leads.filter((l) => inPeriod(l.created_at, previous)),
        stageEvents:    stageEvents.filter((e) => inPeriod(e.created_at, previous)),
        reconciliation: reconciliation.filter((r) => overlapsPeriod(r, previous)),
        // WHY empty: campaign status/daily_budget are CURRENT-state fields —
        // we have no record of what ran last period until live spend lands
        // (H4). An empty slice makes prev spend null → delta honestly "no
        // comparison" instead of a fabricated 0% change.
        campaigns:      [],
      },
      economics,
    },
    warnings,
  };
}
