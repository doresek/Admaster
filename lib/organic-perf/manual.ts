// lib/organic-perf/manual.ts
//
// The manual-ingestion path — works TODAY, before any live post exists.
// The owner (or an ops script) hands us the counters they read off the page;
// we validate, run the SAME verdict math as the Graph path, and write a
// content_performance row with source 'manual' (ad_id null — there is no
// Meta object we fetched this from).
//
// No per-day dedupe here by design: manual entry is a correction/override
// surface; the owner may legitimately re-enter better numbers.

import { computeOrganicVerdict } from './verdict';
import { toPerfMetrics } from './ingest';
import type { OrganicPostMetrics, OrganicVerdict, PerfStore, OrganicPerfRow, ItemLookup } from './types';

export interface ManualMetricsInput {
  reach: number;
  engaged: number;
  /** Optional counters — default 0 when omitted. */
  impressions?: number;
  reactions?: number;
  comments?: number;
  shares?: number;
}

export interface IngestManualMetricsParams {
  clientId: string;
  ownerUserId: string;
  campaignItemId?: string | null;
  artifactId?: string | null;
  metrics: ManualMetricsInput;
  /** The clock — defaults to now; keys period_start/end to the calendar day. */
  now?: Date;
  deps: {
    perfStore: PerfStore;
    /** Optional: resolve artifact from the item when artifactId not given. */
    itemLookup?: ItemLookup;
  };
}

export type ManualIngestResult =
  | { ok: true; verdict: OrganicVerdict; row: OrganicPerfRow }
  | { ok: false; error: string };

const COUNTER_FIELDS = ['reach', 'engaged', 'impressions', 'reactions', 'comments', 'shares'] as const;

/** Validate: every provided counter must be a non-negative integer. */
export function validateManualMetrics(input: ManualMetricsInput): string | null {
  if (input == null || typeof input !== 'object') return 'metrics object is required';
  if (input.reach === undefined || input.engaged === undefined) {
    return 'metrics.reach and metrics.engaged are required';
  }
  for (const field of COUNTER_FIELDS) {
    const v = (input as unknown as Record<string, unknown>)[field];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      return `metrics.${field} must be a non-negative integer`;
    }
  }
  return null;
}

export async function ingestManualMetrics(
  params: IngestManualMetricsParams,
): Promise<ManualIngestResult> {
  const { clientId, ownerUserId, metrics, deps } = params;

  const invalid = validateManualMetrics(metrics);
  if (invalid) return { ok: false, error: invalid };

  const full: OrganicPostMetrics = {
    reach: metrics.reach,
    engaged: metrics.engaged,
    impressions: metrics.impressions ?? 0,
    reactions: metrics.reactions ?? 0,
    comments: metrics.comments ?? 0,
    shares: metrics.shares ?? 0,
  };

  const campaignItemId = params.campaignItemId ?? null;
  let artifactId = params.artifactId ?? null;
  if (!artifactId && campaignItemId && deps.itemLookup) {
    artifactId = (await deps.itemLookup([campaignItemId])).get(campaignItemId) ?? null;
  }

  const day = (params.now ?? new Date()).toISOString().slice(0, 10);
  const row: OrganicPerfRow = {
    artifact_id: artifactId,
    campaign_item_id: campaignItemId,
    client_id: clientId,
    owner_user_id: ownerUserId,
    source: 'manual',
    ad_id: null,
    metrics: toPerfMetrics(full),
    period_start: day,
    period_end: day,
    verdict: computeOrganicVerdict(full), // SAME math as the Graph path
  };

  const ok = await deps.perfStore.insert(row);
  if (!ok) return { ok: false, error: 'content_performance insert failed' };
  return { ok: true, verdict: row.verdict, row };
}
