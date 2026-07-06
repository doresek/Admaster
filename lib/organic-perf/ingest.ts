// lib/organic-perf/ingest.ts
//
// The organic MEASURE step (P1-7): published organic_schedule slots →
// per-post metrics → one content_performance row per campaign_item per
// calendar day, stamped with a deterministic verdict (verdict.ts).
//
// Honesty rules baked in:
//   • dryrun_* post ids are SKIPPED with a note — dry-run posts have no real
//     metrics, and the fetcher is never even called for them.
//   • Dedupe is check-before-insert on (campaign_item_id | post id) × calendar
//     day, so re-running the ingester is idempotent per day.
//   • Per-slot failures (fetcher null/throw, insert false) count as failed and
//     the batch CONTINUES — one bad post never blocks the rest.

import { computeOrganicVerdict, organicEngagementRate } from './verdict';
import type {
  OrganicIngestDeps,
  OrganicIngestSummary,
  OrganicPerfRow,
  OrganicPostMetrics,
} from './types';

export const DRY_RUN_POST_ID_PREFIX = 'dryrun_';

export function isDryRunPostId(postId: string): boolean {
  return postId.startsWith(DRY_RUN_POST_ID_PREFIX);
}

/** Calendar day (UTC, YYYY-MM-DD) the measurement is keyed to. */
export function measurementDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Assemble the metrics jsonb: raw counters + the derived engagement_rate. */
export function toPerfMetrics(m: OrganicPostMetrics) {
  return { ...m, engagement_rate: organicEngagementRate(m.engaged, m.reach) };
}

export interface IngestOrganicPerformanceParams {
  ownerUserId: string;
  clientId: string;
  /** The clock — determines the calendar day rows are keyed to. */
  now: Date;
  deps: OrganicIngestDeps;
}

/**
 * Ingest today's metrics for every published organic slot of a client.
 * Deterministic given its seams; safe to re-run (per-day dedupe).
 */
export async function ingestOrganicPerformance(
  params: IngestOrganicPerformanceParams,
): Promise<OrganicIngestSummary> {
  const { ownerUserId, clientId, now, deps } = params;
  const summary: OrganicIngestSummary = {
    ingested: 0,
    skippedDryRun: 0,
    skippedDuplicates: 0,
    failed: 0,
    notes: [],
  };

  const slots = await deps.slots.listPublished({ ownerUserId, clientId });
  const day = measurementDay(now);

  // Resolve artifact linkage for all items in ONE batch (best-effort).
  const itemIds = Array.from(
    new Set(slots.map((s) => s.campaign_item_id).filter((x): x is string => !!x)),
  );
  const artifactByItem = deps.itemLookup && itemIds.length > 0
    ? await deps.itemLookup(itemIds)
    : new Map<string, string | null>();

  for (const slot of slots) {
    const postId = slot.meta_post_id;
    if (!postId) continue; // listPublished should exclude these; belt-and-braces

    try {
      // Dry-run posts have no real metrics — skip BEFORE touching the fetcher.
      if (isDryRunPostId(postId)) {
        summary.skippedDryRun++;
        summary.notes.push(`slot ${slot.id}: dry-run post id (${postId}) — no real metrics, skipped`);
        continue;
      }

      // Idempotency: one row per campaign_item (or post) per calendar day.
      const duplicate = await deps.perfStore.existsForDay({
        ownerUserId,
        campaignItemId: slot.campaign_item_id,
        adId: postId,
        day,
      });
      if (duplicate) {
        summary.skippedDuplicates++;
        summary.notes.push(`slot ${slot.id}: already ingested for ${day} — skipped`);
        continue;
      }

      const metrics = await deps.fetcher(postId);
      if (!metrics) {
        summary.failed++;
        summary.notes.push(`slot ${slot.id}: metrics unavailable for post ${postId}`);
        continue;
      }

      const perfMetrics = toPerfMetrics(metrics);
      const row: OrganicPerfRow = {
        artifact_id: slot.campaign_item_id
          ? artifactByItem.get(slot.campaign_item_id) ?? null
          : null,
        campaign_item_id: slot.campaign_item_id,
        client_id: clientId,
        owner_user_id: ownerUserId,
        source: 'meta',
        ad_id: postId,
        metrics: perfMetrics,
        period_start: day,
        period_end: day,
        verdict: computeOrganicVerdict(metrics),
      };

      const ok = await deps.perfStore.insert(row);
      if (!ok) {
        summary.failed++;
        summary.notes.push(`slot ${slot.id}: content_performance insert failed`);
        continue;
      }

      summary.ingested++;
      summary.notes.push(
        `slot ${slot.id}: ingested (reach ${metrics.reach}, er ${perfMetrics.engagement_rate.toFixed(4)}, verdict ${row.verdict ?? 'null'})`,
      );
    } catch (e: any) {
      // Per-slot failure NEVER stops the batch.
      summary.failed++;
      summary.notes.push(`slot ${slot.id}: ${e?.message ?? 'unexpected error'}`);
    }
  }

  return summary;
}
