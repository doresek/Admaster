// lib/digest/load.ts
//
// Load everything the digest composer reads — ONE query per table (no N+1),
// every query explicitly scoped to client + owner (+ period where the table
// has period semantics), following the lib/intelligence/insights.ts data-layer
// conventions (SupabaseClient injected first, explicit scoping even under the
// service-role client, every DB error checked).
//
// Defensive row narrowing: rows are typed via .overrideTypes (repo convention,
// see lib/hypotheses/store.ts) and then RUNTIME-GUARDED — a malformed/partial
// row is skipped with a warning, never crashes composition and never reaches
// the narrative (the §1.3 audit-trail contract only narrates well-formed rows).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HYPOTHESIS_COLUMNS,
  type DigestKind,
  type HypothesisRow,
} from '@/lib/capability-contracts';
import { INSIGHT_COLUMNS, type ClientInsight } from '@/lib/intelligence/types';
import type {
  Campaign,
  CampaignDecision,
  CampaignDecisionType,
} from '@/lib/campaigns/types';
import type {
  DigestDiagnosisRow,
  DigestFailedLink,
  DigestInputs,
  DigestItemRef,
  DigestPerformanceRow,
  PerformanceVerdict,
} from './types';

export interface LoadDigestParams {
  clientId:    string;
  ownerUserId: string;
  /** YYYY-MM-DD inclusive. */
  periodStart: string;
  /** YYYY-MM-DD inclusive. */
  periodEnd:   string;
  /** Stamped onto inputs.period (defaults to 'weekly'). */
  kind?:       DigestKind;
}

export interface LoadDigestResult {
  /** approvalsNeeded is left empty — the caller (heartbeat/route) injects it. */
  inputs:   DigestInputs;
  warnings: string[];
}

// ── guards ────────────────────────────────────────────────────────────────────

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const DECISION_TYPES: readonly CampaignDecisionType[] =
  ['angle', 'audience', 'platform', 'budget', 'objective', 'funnel', 'channel', 'precedents'];
const isDecisionType = (v: unknown): v is CampaignDecisionType =>
  DECISION_TYPES.some((t) => t === v);

const FAILED_LINKS: readonly DigestFailedLink[] =
  ['hook', 'avatar', 'creative', 'funnel', 'offer', 'audience', 'none'];
const isFailedLink = (v: unknown): v is DigestFailedLink =>
  FAILED_LINKS.some((l) => l === v);

const VERDICTS: readonly PerformanceVerdict[] = ['worked', 'underperformed', 'failed'];
const isVerdictOrNull = (v: unknown): v is PerformanceVerdict | null =>
  v === null || VERDICTS.some((x) => x === v);

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

/** Exclusive upper bound for created_at/timestamps: the day AFTER periodEnd. */
function nextDay(isoDate: string): string {
  const t = Date.parse(`${isoDate}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

// Campaign statuses considered "currently running" — combined (OR) with
// "touched during the period" (updated_at >= start) to define "active in period".
const RUNNING_STATUSES = 'live,paused,scheduled,publishing';

/**
 * Load the digest inputs for one client + period. One SELECT per table:
 * campaigns, campaign_decisions, campaign_items, diagnoses, hypotheses,
 * content_performance, client_insights (active).
 */
export async function loadDigestInputs(
  supabase: SupabaseClient,
  params:   LoadDigestParams,
): Promise<LoadDigestResult> {
  const { clientId, ownerUserId, periodStart, periodEnd } = params;
  const endExclusive = nextDay(periodEnd);
  const warnings: string[] = [];

  // 1) campaigns "active in period": created before the period ended AND
  //    (currently running OR touched during the period).
  const campaignsQ = await supabase
    .from('campaigns')
    .select('id, client_id, owner_user_id, name, objective, channel, status, daily_budget, funnel_stage, meta_campaign_id, dry_run, grounded_in, rationale, created_at, updated_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .lt('created_at', endExclusive)
    .or(`status.in.(${RUNNING_STATUSES}),updated_at.gte.${periodStart}`)
    .overrideTypes<Campaign[], { merge: false }>();
  if (campaignsQ.error) throw new Error(`loadDigestInputs(campaigns): ${campaignsQ.error.message}`);
  const campaigns = narrow(
    campaignsQ.data ?? [],
    'campaigns',
    (c) => nonEmptyString(c.id) && nonEmptyString(c.name)
        && nonEmptyString(c.channel) && nonEmptyString(c.status)
        && isStringArray(c.grounded_in),
    warnings,
  );

  // 2) campaign_decisions recorded during the period.
  const decisionsQ = await supabase
    .from('campaign_decisions')
    .select('id, campaign_id, client_id, owner_user_id, decision_type, decision, grounded_in, rationale, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', periodStart)
    .lt('created_at', endExclusive)
    .overrideTypes<CampaignDecision[], { merge: false }>();
  if (decisionsQ.error) throw new Error(`loadDigestInputs(campaign_decisions): ${decisionsQ.error.message}`);
  const decisions = narrow(
    decisionsQ.data ?? [],
    'campaign_decisions',
    (d) => nonEmptyString(d.id) && isDecisionType(d.decision_type)
        && nonEmptyString(d.rationale) && isRecord(d.decision)
        && isStringArray(d.grounded_in),
    warnings,
  );

  // 3) campaign_items — ONLY the item→campaign linkage for the period's
  //    campaigns (attributes content_performance rows to campaigns). One
  //    query, filtered by the campaign-id set (no per-campaign N+1).
  const campaignIds = campaigns.map((c) => c.id);
  let items: DigestItemRef[] = [];
  if (campaignIds.length > 0) {
    const itemsQ = await supabase
      .from('campaign_items')
      .select('id, campaign_id')
      .eq('client_id', clientId)
      .eq('owner_user_id', ownerUserId)
      .in('campaign_id', campaignIds)
      .overrideTypes<DigestItemRef[], { merge: false }>();
    if (itemsQ.error) throw new Error(`loadDigestInputs(campaign_items): ${itemsQ.error.message}`);
    items = narrow(
      itemsQ.data ?? [],
      'campaign_items',
      (i) => nonEmptyString(i.id) && nonEmptyString(i.campaign_id),
      warnings,
    );
  }

  // 4) diagnoses recorded during the period.
  const diagnosesQ = await supabase
    .from('diagnoses')
    .select('id, client_id, owner_user_id, scope_campaign_id, scope_item_id, failed_link, rationale, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', periodStart)
    .lt('created_at', endExclusive)
    .overrideTypes<DigestDiagnosisRow[], { merge: false }>();
  if (diagnosesQ.error) throw new Error(`loadDigestInputs(diagnoses): ${diagnosesQ.error.message}`);
  const diagnoses = narrow(
    diagnosesQ.data ?? [],
    'diagnoses',
    (d) => nonEmptyString(d.id) && isFailedLink(d.failed_link) && nonEmptyString(d.rationale),
    warnings,
  );

  // 5) hypotheses — ONE query for both buckets: open, OR resolved on/after the
  //    period start (the exact upper bound is applied in memory below —
  //    PostgREST or() can't nest the AND cleanly and the per-client ledger is
  //    small). registered_at < endExclusive keeps future registrations out of
  //    a retroactively-composed digest.
  const hypothesesQ = await supabase
    .from('hypotheses')
    .select(HYPOTHESIS_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .lt('registered_at', endExclusive)
    .or(`status.eq.open,resolved_at.gte.${periodStart}`)
    .overrideTypes<HypothesisRow[], { merge: false }>();
  if (hypothesesQ.error) throw new Error(`loadDigestInputs(hypotheses): ${hypothesesQ.error.message}`);
  const hypothesesAll = narrow(
    hypothesesQ.data ?? [],
    'hypotheses',
    (h) => nonEmptyString(h.id) && nonEmptyString(h.claim) && nonEmptyString(h.status),
    warnings,
  );
  const open = hypothesesAll.filter((h) => h.status === 'open');
  const resolved = hypothesesAll.filter((h) =>
    (h.status === 'supported' || h.status === 'refuted' || h.status === 'inconclusive' || h.status === 'killed')
    && h.resolved_at !== null && h.resolved_at >= periodStart && h.resolved_at < endExclusive,
  );

  // 6) content_performance — rows ingested since the period started (late
  //    ingestion after period end is legitimate for a recompose); narrowed in
  //    memory to rows whose OWN period overlaps the digest period, or — when
  //    the row carries no period — rows created inside it.
  const performanceQ = await supabase
    .from('content_performance')
    .select('id, client_id, owner_user_id, campaign_item_id, artifact_id, metrics, verdict, period_start, period_end, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', periodStart)
    .overrideTypes<DigestPerformanceRow[], { merge: false }>();
  if (performanceQ.error) throw new Error(`loadDigestInputs(content_performance): ${performanceQ.error.message}`);
  const performance = narrow(
    performanceQ.data ?? [],
    'content_performance',
    (p) => nonEmptyString(p.id) && isRecord(p.metrics) && isVerdictOrNull(p.verdict),
    warnings,
  ).filter((p) =>
    p.period_start !== null && p.period_end !== null
      ? p.period_start <= periodEnd && p.period_end >= periodStart
      : p.created_at < endExclusive,
  );

  // 7) client_insights — the ACTIVE atoms (current brain state) for grounding
  //    confidence citations. No period filter: citations reflect what the
  //    brain believes now, and a since-retired atom renders without confidence.
  const insightsQ = await supabase
    .from('client_insights')
    .select(INSIGHT_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'active')
    .overrideTypes<ClientInsight[], { merge: false }>();
  if (insightsQ.error) throw new Error(`loadDigestInputs(client_insights): ${insightsQ.error.message}`);
  const insights = narrow(
    insightsQ.data ?? [],
    'client_insights',
    (i) => nonEmptyString(i.id) && typeof i.content === 'string'
        && typeof i.confidence === 'number' && Number.isFinite(i.confidence),
    warnings,
  );

  return {
    inputs: {
      period:      { kind: params.kind ?? 'weekly', start: periodStart, end: periodEnd },
      campaigns,
      decisions,
      items,
      diagnoses,
      hypotheses:  { resolved, open },
      performance,
      insights,
      approvalsNeeded: [],
    },
    warnings,
  };
}
