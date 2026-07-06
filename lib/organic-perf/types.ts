// lib/organic-perf/types.ts
//
// P1-7 organic performance ingestion — domain types + the seams.
// One published `organic_schedule` slot (P1-4) → one `content_performance`
// row per calendar day (migration 030), stamped with a deterministic verdict.
// Everything non-deterministic (slot reads, Graph, DB writes, item lookup)
// lives behind seams so unit tests run fully offline — and so the manual
// path works TODAY while publishing is still dry-run (no real page posts).

import type { OrganicSlot } from '@/lib/organic-publish/types';

// ── metrics ────────────────────────────────────────────────────────────────────

/** Raw per-post counters, whether fetched from Graph or entered manually. */
export interface OrganicPostMetrics {
  /** Unique people reached (Graph: post_impressions_unique). */
  reach: number;
  /** Total impressions (Graph: post_impressions). */
  impressions: number;
  /** Unique people who engaged (Graph: post_engaged_users). */
  engaged: number;
  reactions: number;
  comments: number;
  shares: number;
}

/** What lands in content_performance.metrics (raw counters + the derived rate). */
export interface OrganicPerfMetrics extends OrganicPostMetrics {
  /** engaged / reach (0 when reach is 0). The verdict input. */
  engagement_rate: number;
}

export type OrganicVerdict = 'worked' | 'underperformed' | 'failed' | null;

// ── the content_performance row we write (mirrors migration 030 exactly) ──────

export interface OrganicPerfRow {
  artifact_id: string | null;
  campaign_item_id: string | null;
  client_id: string;
  owner_user_id: string;
  source: 'meta' | 'manual';
  /**
   * For organic Graph rows: the Meta post id. Reuses the ad_id linkage column
   * (mig 030) so the mig-033 unique index (client_id, ad_id, period_start,
   * period_end) also backstops dedupe at the DB. Manual rows: null.
   */
  ad_id: string | null;
  metrics: OrganicPerfMetrics;
  /** Calendar day of the measurement (YYYY-MM-DD). Same value in both. */
  period_start: string | null;
  period_end: string | null;
  verdict: OrganicVerdict;
}

// ── seams ──────────────────────────────────────────────────────────────────────

/**
 * Fetch metrics for one page post. Returns null when metrics are unavailable
 * (Graph error, deleted post, insights not ready) — the ingester counts that
 * slot as failed and continues. NEVER called for dryrun_* ids.
 */
export type PostMetricsFetcher = (postId: string) => Promise<OrganicPostMetrics | null>;

/** Where published slots come from (real impl reads organic_schedule). */
export interface SlotSource {
  /** status='published' AND meta_post_id NOT NULL, owner+client scoped. */
  listPublished(params: { ownerUserId: string; clientId: string }): Promise<OrganicSlot[]>;
}

/** content_performance persistence. Doctrine: never throw; degrade + log. */
export interface PerfStore {
  /**
   * Dedupe check — is there already a row for this item on this calendar day?
   * Keyed by campaign_item_id when present, else by ad_id (the meta post id).
   */
  existsForDay(params: {
    ownerUserId: string;
    campaignItemId: string | null;
    adId: string | null;
    day: string; // YYYY-MM-DD
  }): Promise<boolean>;

  /** Insert one row. false = write failed (logged); the batch continues. */
  insert(row: OrganicPerfRow): Promise<boolean>;

  /** Recent rows for the GET surface (owner-scoped, organic items + manual). */
  listRecent(params: {
    ownerUserId: string;
    clientId: string;
    limit?: number;
  }): Promise<Array<OrganicPerfRow & { id?: string; created_at?: string }>>;
}

/** campaign_item id → artifact_id (batched). Missing ids simply resolve null. */
export type ItemLookup = (campaignItemIds: string[]) => Promise<Map<string, string | null>>;

// ── ingestion shapes ───────────────────────────────────────────────────────────

export interface OrganicIngestDeps {
  slots: SlotSource;
  fetcher: PostMetricsFetcher;
  perfStore: PerfStore;
  /** Optional: resolve artifact linkage. Omitted → artifact_id null. */
  itemLookup?: ItemLookup;
}

export interface OrganicIngestSummary {
  ingested: number;
  skippedDryRun: number;
  skippedDuplicates: number;
  failed: number;
  /** Human-readable per-slot notes — the audit surface of the batch. */
  notes: string[];
}
