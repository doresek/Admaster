// lib/measurement/reconciliation.ts
//
// Platform-claimed vs CRM-truth reconciliation (plan §1: "Platform-claimed vs
// our-truth divergence is itself a tracked metric… alert >2× = broken dedup").
// The honesty layer: every dashboard number sits on top of this ratio.
//
// ── Channel mapping (DESIGN DECISION) ────────────────────────────────────────
// CRM truth is bucketed into the channels of migration 060 §5
// (meta_paid | meta_organic | google | whatsapp | direct) from the lead's
// FIRST touchpoint — the acquisition touch: reconciliation answers "which
// channel BROUGHT this lead", so the first capture wins here even though
// stage-learning uses last-click (different questions, different keys).
// Mapping, in priority order:
//   1. gclid present                              → google  (gclid only exists on Google Ads clicks)
//   2. utm.source ∈ {google, adwords, youtube}    → google
//   3. utm.source ∈ {facebook, fb, meta, instagram, ig}
//        medium ∈ {cpc, ppc, paid, paid_social, ad, ads} → meta_paid
//        otherwise                                       → meta_organic
//   4. utm.source ∈ {whatsapp, wa} OR ctwa_clid   → whatsapp
//   5. fbclid without utm labels                  → meta_organic (fbclid is
//      appended to ALL outbound Facebook links, organic included — claiming
//      paid without a paid label would be exactly the inflation we measure)
//   6. anything else / no touchpoint              → direct
//
// ── Verdicts ─────────────────────────────────────────────────────────────────
// ratio = platform_claimed / crm_truth (null when truth = 0):
//   healthy  ratio ≤ 1.3  (Meta's known ~15–20% over-report, plan §1)
//   inflated 1.3 < ratio ≤ 2
//   broken   ratio > 2 — or claims with ZERO CRM truth (broken dedup/pixel)
// Under-claiming (ratio < 1) is healthy: platforms can't see every lead;
// only over-claiming sells certainty that isn't there. Notes are Hebrew —
// they surface verbatim in owner-facing dashboards/digests.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelReconciliationRow, LeadTouchpointRow } from '@/lib/capability-contracts';
import { TOUCHPOINT_COLUMNS } from './leads';

export type ReconciliationVerdict = 'healthy' | 'inflated' | 'broken';

export type ReconciliationChannel = 'meta_paid' | 'meta_organic' | 'google' | 'whatsapp' | 'direct';

export const RECONCILIATION_THRESHOLDS = {
  HEALTHY_MAX:  1.3,
  INFLATED_MAX: 2.0,
} as const;

export interface ReconciliationComputation {
  ratio:   number | null;
  verdict: ReconciliationVerdict;
  /** Hebrew, owner-facing — rendered verbatim in dashboards/digests. */
  note:    string;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * PURE verdict math. Boundaries are inclusive on the healthy side
 * (ratio 1.3 → healthy, ratio 2.0 → inflated).
 */
export function computeReconciliation(input: { platformClaimed: number; crmTruth: number }): ReconciliationComputation {
  const claimed = Number.isFinite(input.platformClaimed) ? Math.max(0, input.platformClaimed) : 0;
  const truth   = Number.isFinite(input.crmTruth) ? Math.max(0, input.crmTruth) : 0;

  if (truth === 0) {
    if (claimed === 0) {
      return { ratio: null, verdict: 'healthy', note: 'אין לידים בתקופה — אין פער למדוד' };
    }
    return {
      ratio: null, verdict: 'broken',
      note: `הפלטפורמה מדווחת על ${claimed} המרות אבל ב-CRM אין אף ליד — כנראה פיקסל/דדופליקציה שבורים`,
    };
  }

  const ratio = round4(claimed / truth);
  if (ratio <= RECONCILIATION_THRESHOLDS.HEALTHY_MAX) {
    return { ratio, verdict: 'healthy', note: `פער תקין בין דיווח הפלטפורמה ל-CRM (יחס ${ratio})` };
  }
  if (ratio <= RECONCILIATION_THRESHOLDS.INFLATED_MAX) {
    return { ratio, verdict: 'inflated', note: `הפלטפורמה מנפחת את הדיווח (יחס ${ratio}) — המספרים בדשבורד מבוססי CRM` };
  }
  return { ratio, verdict: 'broken', note: `פער חריג (יחס ${ratio}) — ככל הנראה דדופליקציה שבורה; לבדוק הגדרות המרות` };
}

/** The identity fields channel mapping needs (subset of a touchpoint row). */
export interface ChannelSignal {
  fbclid:    string | null;
  gclid:     string | null;
  ctwa_clid: string | null;
  utm:       Record<string, string>;
}

const GOOGLE_SOURCES = new Set(['google', 'adwords', 'youtube']);
const META_SOURCES   = new Set(['facebook', 'fb', 'meta', 'instagram', 'ig']);
const WA_SOURCES     = new Set(['whatsapp', 'wa']);
const PAID_MEDIUMS   = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'ad', 'ads']);

/** PURE: map one touchpoint's identity to a reconciliation channel (see header). */
export function mapChannel(signal: ChannelSignal | null): ReconciliationChannel {
  if (signal === null) return 'direct';
  if (signal.gclid) return 'google';

  const source = (signal.utm.source ?? '').toLowerCase();
  const medium = (signal.utm.medium ?? '').toLowerCase();

  if (GOOGLE_SOURCES.has(source)) return 'google';
  if (META_SOURCES.has(source)) return PAID_MEDIUMS.has(medium) ? 'meta_paid' : 'meta_organic';
  if (WA_SOURCES.has(source) || signal.ctwa_clid) return 'whatsapp';
  if (signal.fbclid) return 'meta_organic';
  return 'direct';
}

// ── store ─────────────────────────────────────────────────────────────────────

export interface UpsertReconciliationInput {
  clientId:        string;
  ownerUserId:     string;
  channel:         string;
  periodStart:     string;   // ISO date 'YYYY-MM-DD'
  periodEnd:       string;   // ISO date 'YYYY-MM-DD'
  platformClaimed: number;
  crmTruth:        number;
  ratio:           number | null;
  note:            string | null;
}

/**
 * Upsert one channel/period row (unique (client_id, channel, period_start),
 * migration 060 §5) — re-running a period refreshes, never duplicates.
 */
export async function upsertReconciliation(
  supabase: SupabaseClient,
  input:    UpsertReconciliationInput,
): Promise<ChannelReconciliationRow> {
  const { data, error } = await supabase
    .from('channel_reconciliation')
    .upsert(
      {
        client_id:        input.clientId,
        owner_user_id:    input.ownerUserId,
        channel:          input.channel,
        period_start:     input.periodStart,
        period_end:       input.periodEnd,
        platform_claimed: input.platformClaimed,
        crm_truth:        input.crmTruth,
        ratio:            input.ratio,
        note:             input.note,
      },
      { onConflict: 'client_id,channel,period_start' },
    )
    .select('id, client_id, owner_user_id, channel, period_start, period_end, platform_claimed, crm_truth, ratio, note, created_at')
    .single()
    .overrideTypes<ChannelReconciliationRow, { merge: false }>();
  if (error || !data) throw new Error(`upsertReconciliation: ${error?.message ?? 'no row returned'}`);
  return data;
}

// ── run (counts CRM truth, compares to caller-supplied platform claims) ───────

export interface ReconciliationPeriod {
  /** ISO date 'YYYY-MM-DD' (inclusive). */
  start: string;
  /** ISO date 'YYYY-MM-DD' (exclusive upper bound). */
  end:   string;
}

export interface RunReconciliationInput {
  period: ReconciliationPeriod;
  /**
   * Platform-claimed conversions per channel. Arrives as an input parameter —
   * live numbers land at the H4 flip; until then callers pass fixtures/manual
   * reads. Channels absent here but present in CRM reconcile against 0.
   */
  platformClaimed: Partial<Record<ReconciliationChannel, number>>;
}

export interface RunReconciliationResult {
  channel:  ReconciliationChannel;
  claimed:  number;
  truth:    number;
  computed: ReconciliationComputation;
  row:      ChannelReconciliationRow;
}

/** Runtime-narrow the jsonb utm column (never structurally trusted). */
function narrowUtm(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/**
 * Count CRM truth by channel for the period (funnel_leads created in-window,
 * channel from each lead's FIRST touchpoint — see header; leads with no
 * touchpoint count as 'direct'), compare against the platform's claims, and
 * upsert one row per channel. Returns the per-channel results.
 */
export async function runReconciliation(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  input:       RunReconciliationInput,
): Promise<RunReconciliationResult[]> {
  const { data: leadRows, error: leadsError } = await supabase
    .from('funnel_leads')
    .select('id')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', input.period.start)
    .lt('created_at', input.period.end)
    .overrideTypes<Array<{ id: string }>, { merge: false }>();
  if (leadsError) throw new Error(`runReconciliation leads: ${leadsError.message}`);
  const leadIds = (leadRows ?? []).map((r) => r.id);

  // First touchpoint per lead → channel. Ascending order so the first row we
  // see per lead_id IS the acquisition touch.
  const firstTouch = new Map<string, ChannelSignal>();
  if (leadIds.length > 0) {
    const { data: tps, error: tpError } = await supabase
      .from('lead_touchpoints')
      .select(TOUCHPOINT_COLUMNS)
      .eq('client_id', clientId)
      .eq('owner_user_id', ownerUserId)
      .in('lead_id', leadIds)
      .order('captured_at', { ascending: true })
      .overrideTypes<LeadTouchpointRow[], { merge: false }>();
    if (tpError) throw new Error(`runReconciliation touchpoints: ${tpError.message}`);
    for (const tp of tps ?? []) {
      if (!firstTouch.has(tp.lead_id)) {
        firstTouch.set(tp.lead_id, {
          fbclid: tp.fbclid, gclid: tp.gclid, ctwa_clid: tp.ctwa_clid, utm: narrowUtm(tp.utm),
        });
      }
    }
  }

  const truthByChannel = new Map<ReconciliationChannel, number>();
  for (const id of leadIds) {
    const channel = mapChannel(firstTouch.get(id) ?? null);
    truthByChannel.set(channel, (truthByChannel.get(channel) ?? 0) + 1);
  }

  // Reconcile the union: channels the platform claims + channels the CRM saw.
  const channels = new Set<ReconciliationChannel>([
    ...truthByChannel.keys(),
    ...Object.keys(input.platformClaimed).filter((k): k is ReconciliationChannel =>
      k === 'meta_paid' || k === 'meta_organic' || k === 'google' || k === 'whatsapp' || k === 'direct'),
  ]);

  const results: RunReconciliationResult[] = [];
  for (const channel of channels) {
    const claimed = input.platformClaimed[channel] ?? 0;
    const truth   = truthByChannel.get(channel) ?? 0;
    const computed = computeReconciliation({ platformClaimed: claimed, crmTruth: truth });
    const row = await upsertReconciliation(supabase, {
      clientId, ownerUserId, channel,
      periodStart:     input.period.start,
      periodEnd:       input.period.end,
      platformClaimed: claimed,
      crmTruth:        truth,
      ratio:           computed.ratio,
      note:            computed.note,
    });
    results.push({ channel, claimed, truth, computed, row });
  }
  return results;
}
