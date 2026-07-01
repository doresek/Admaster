// lib/performance/ingest-live.ts
//
// LIVE performance ingestion (T10) — the network-facing front half of the
// MEASURE step. It fetches REAL ad-level Meta insights and hands them to the
// pure `ingestPerformance` core (lib/performance/ingest.ts) so the diagnosis
// loop runs on real numbers the moment creds land.
//
// Flow:
//   1. Resolve the client's decrypted Meta token + ad account (injectable
//      `getToken`; default = active meta_connections row + AES-GCM decrypt).
//      No token → return `{ ..., skipped: 'no_connection' }` — NO network, NO throw.
//   2. GET ad-level insights (injectable `fetchInsights`; default = global fetch
//      with the token in the `Authorization: Bearer` header — NEVER the URL).
//      Cursor-paging + the Graph error envelope are both handled.
//   3. Map each Graph row via `mapInsightsRowToPerformance` (+ `extractConversions`)
//      into a `PerformanceInputRow`, resolving the row's `ad_id` →
//      `artifact_id` + `campaign_item_id` through `campaign_items.meta_object_id`
//      (injectable `resolveArtifact`; default = admin-client lookup). Rows with
//      no match still ingest (ad_id only).
//   4. Delegate normalization + verdict + persistence to `ingestPerformance`.
//
// EVERY side effect (token, network, artifact lookup, DB) is injectable, so the
// whole module is testable with zero creds and the no-creds path is graceful.
import type { SupabaseClient } from '@supabase/supabase-js';
import { META_GRAPH_BASE } from '@/lib/meta-config';
import { getActiveConnection } from '@/lib/meta-connections';
import { getDecryptedMetaToken } from '@/lib/meta';
import {
  buildInsightsUrl,
  mapInsightsRowToPerformance,
  extractConversions,
  type GraphInsightsRow,
} from '@/lib/meta-insights';
import {
  ingestPerformance,
  type PerformanceInputRow,
  type IngestResult,
  type Baseline,
  type RawMetrics,
} from '@/lib/performance/ingest';

// A Graph insights row at ad level carries ad_id/ad_name too — the shared
// GraphInsightsRow type predates ad-level fetching, so widen it locally.
export type AdInsightsRow = GraphInsightsRow & { ad_id?: string; ad_name?: string };

// The Graph "data + paging + error" envelope for a single insights page.
export interface GraphInsightsEnvelope {
  data?: AdInsightsRow[];
  paging?: { next?: string; cursors?: { before?: string; after?: string } };
  error?: { message?: string; code?: number; type?: string; error_subcode?: number };
}

// The artifact linkage resolved for one Meta ad id.
export interface ArtifactLink {
  artifact_id: string | null;
  campaign_item_id: string | null;
}

export interface LiveIngestParams {
  clientId: string;
  ownerUserId: string;
  /** Ad account to query. When omitted, falls back to the active connection's selection. */
  adAccountId?: string | null;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

/** Token + the ad account it can read — returned by `getToken`. */
export interface ResolvedToken {
  token: string;
  adAccountId: string;
}

export interface LiveIngestDeps {
  /**
   * Resolve the decrypted token + ad account for this client.
   * Default: active meta_connections row (getActiveConnection) + getDecryptedMetaToken,
   * using the admin/service client. Returns null when no usable connection exists.
   */
  getToken?: (params: LiveIngestParams) => Promise<ResolvedToken | null>;
  /**
   * GET a Graph insights page. Default: global fetch with the token in the
   * Authorization header (the token is NEVER put in the URL, so it can't leak
   * into logs/proxies).
   */
  fetchInsights?: (url: string, token: string) => Promise<GraphInsightsEnvelope>;
  /**
   * Resolve ad_id → { artifact_id, campaign_item_id } via
   * campaign_items.meta_object_id. Default: a single `.in(meta_object_id, ...)`
   * query on the admin client.
   */
  resolveArtifact?: (adIds: string[]) => Promise<Map<string, ArtifactLink>>;
  /** Service-role client for the default getToken/resolveArtifact and for persistence. */
  admin?: SupabaseClient | null;
  getAdmin?: () => SupabaseClient | null;
  /** Baseline forwarded to ingestPerformance for verdict scoring. */
  baseline?: Baseline;
  /** Graph base URL (default META_GRAPH_BASE). */
  graphBase?: string;
  /** Extra insights fields to request (default includes ad_id + the metric set). */
  fields?: string;
  /** Safety cap on the number of Graph pages to follow (default 50). */
  maxPages?: number;
}

/** Result of a live ingest — the ingest core result plus live-only diagnostics. */
export interface LiveIngestResult extends IngestResult {
  /** Set when we short-circuited: no usable connection, or the first page errored. */
  skipped?: 'no_connection' | 'graph_error';
  /** Redacted Graph error message when the envelope reported one. */
  error?: string;
  /** Graph pages fetched. */
  pages: number;
  /** Raw insights rows fetched across all pages. */
  fetched: number;
}

function resolveAdmin(deps: LiveIngestDeps): SupabaseClient | null {
  if (deps.admin) return deps.admin;
  if (deps.getAdmin) {
    try { return deps.getAdmin(); } catch { return null; }
  }
  return null;
}

// Default fields: the shared metric set + ad_id/ad_name so each row can be tied
// back to a campaign_item (and its artifact).
const DEFAULT_AD_FIELDS =
  'ad_id,ad_name,impressions,clicks,spend,reach,frequency,ctr,cpc,cpm,actions';

// Build the AD-LEVEL insights URL. We reuse buildInsightsUrl (single source of
// truth for time_range/limit/encoding) but that helper hard-codes level=account,
// which we may not edit — so we swap it to level=ad on the produced string. The
// token is not part of this URL by design (it travels in the Authorization header).
function buildAdInsightsUrl(deps: LiveIngestDeps, p: LiveIngestParams & { adAccountId: string }): string {
  const url = buildInsightsUrl({
    graphBase: deps.graphBase ?? META_GRAPH_BASE,
    adAccountId: p.adAccountId,
    since: p.since,
    until: p.until,
    fields: deps.fields ?? DEFAULT_AD_FIELDS,
  });
  return url.replace('level=account', 'level=ad');
}

// ── default dep implementations ──────────────────────────────────────────────

function defaultGetToken(deps: LiveIngestDeps): NonNullable<LiveIngestDeps['getToken']> {
  return async (params) => {
    const admin = resolveAdmin(deps);
    if (!admin) return null; // no service client → can't resolve → graceful no-op.
    const connection = await getActiveConnection(admin, params.clientId, params.ownerUserId);
    if (!connection) return null;
    const token = await getDecryptedMetaToken(admin, params.clientId, params.ownerUserId);
    if (!token) return null;
    const adAccountId = params.adAccountId ?? connection.selected_ad_account_id;
    if (!adAccountId) return null;
    return { token, adAccountId };
  };
}

function defaultFetchInsights(): NonNullable<LiveIngestDeps['fetchInsights']> {
  return async (url, token) => {
    // Token in the header ONLY — keeps it out of URLs, logs, and proxies.
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return (await res.json()) as GraphInsightsEnvelope;
  };
}

function defaultResolveArtifact(deps: LiveIngestDeps): NonNullable<LiveIngestDeps['resolveArtifact']> {
  return async (adIds) => {
    const map = new Map<string, ArtifactLink>();
    const admin = resolveAdmin(deps);
    if (!admin || adIds.length === 0) return map;
    // One batched lookup: campaign_items whose meta_object_id is one of the ads.
    const { data, error } = await admin
      .from('campaign_items')
      .select('id, artifact_id, meta_object_id')
      .in('meta_object_id', adIds);
    if (error || !data) return map; // best-effort: no linkage → rows still ingest by ad_id.
    for (const r of data as Array<{ id: string; artifact_id: string | null; meta_object_id: string | null }>) {
      if (r.meta_object_id) {
        map.set(r.meta_object_id, {
          artifact_id: r.artifact_id ?? null,
          campaign_item_id: r.id ?? null,
        });
      }
    }
    return map;
  };
}

// Extract the RawMetrics subset ingestPerformance understands from a mapped
// AdPerformanceRecord. We keep the raw counts + ctr and let normalizeMetrics
// derive conversion_rate / cpa. (roas needs action_values — out of scope, T-later.)
function toRawMetrics(row: AdInsightsRow, adAccountId: string, ownerUserId: string, clientId: string): RawMetrics {
  const rec = mapInsightsRowToPerformance(row, {
    userId: ownerUserId,
    clientId,
    adAccountId,
    fetchedAt: new Date().toISOString(),
  });
  return {
    impressions: rec.impressions,
    clicks: rec.clicks,
    ctr: rec.ctr,
    reach: rec.reach,
    frequency: rec.frequency,
    // conversions derived from the actions array (mapInsightsRowToPerformance
    // uses extractConversions internally; recompute defensively for clarity).
    conversions: extractConversions(row.actions),
    spend: rec.spend,
  };
}

/**
 * Fetch live Meta ad-level insights for a client/window and ingest them into
 * content_performance, keyed to the artifact that produced each ad.
 *
 * Graceful by construction: with no connection/token it returns empty and
 * `skipped: 'no_connection'` without touching the network; a Graph error on the
 * first page returns `skipped: 'graph_error'`.
 */
export async function ingestLivePerformance(
  params: LiveIngestParams,
  deps: LiveIngestDeps = {},
): Promise<LiveIngestResult> {
  const empty = (extra: Partial<LiveIngestResult>): LiveIngestResult => ({
    rows: [], persisted: 0, persistedTable: false, pages: 0, fetched: 0, ...extra,
  });

  // 1) Resolve the token + ad account. No token → graceful no-op, no network.
  const getToken = deps.getToken ?? defaultGetToken(deps);
  const resolved = await getToken(params);
  if (!resolved || !resolved.token || !resolved.adAccountId) {
    return empty({ skipped: 'no_connection' });
  }
  const { token, adAccountId } = resolved;

  // 2) Fetch ad-level insights, following cursor paging.
  const fetchInsights = deps.fetchInsights ?? defaultFetchInsights();
  const maxPages = deps.maxPages ?? 50;

  const rawRows: AdInsightsRow[] = [];
  let pages = 0;
  let graphError: string | undefined;

  let url: string | null = buildAdInsightsUrl(deps, { ...params, adAccountId });
  while (url && pages < maxPages) {
    const env = await fetchInsights(url, token);
    pages++;
    if (env?.error) {
      graphError = env.error.message ?? 'unknown Graph error';
      break;
    }
    if (Array.isArray(env?.data)) rawRows.push(...env.data);
    // paging.next is a full cursor URL WITHOUT the token (we auth via header),
    // so it's safe to follow with the same Authorization header.
    url = env?.paging?.next ?? null;
  }

  // First-page error with nothing collected → surface it, don't persist noise.
  if (graphError && rawRows.length === 0) {
    return empty({ skipped: 'graph_error', error: graphError, pages });
  }

  if (rawRows.length === 0) {
    return empty({ pages });
  }

  // 3) Resolve ad_id → artifact/campaign_item linkage in one batch.
  const adIds = Array.from(
    new Set(rawRows.map((r) => r.ad_id).filter((x): x is string => typeof x === 'string' && x.length > 0)),
  );
  const resolveArtifact = deps.resolveArtifact ?? defaultResolveArtifact(deps);
  const linkage = adIds.length > 0 ? await resolveArtifact(adIds) : new Map<string, ArtifactLink>();

  const inputRows: PerformanceInputRow[] = rawRows.map((row) => {
    const adId = typeof row.ad_id === 'string' && row.ad_id.length > 0 ? row.ad_id : null;
    const link = adId ? linkage.get(adId) : undefined;
    // time_increment=1 → each row is a single day; period_start == period_end.
    const day = row.date_start ?? row.date_stop ?? null;
    return {
      artifact_id: link?.artifact_id ?? null,
      campaign_item_id: link?.campaign_item_id ?? null,
      ad_id: adId,
      client_id: params.clientId,
      owner_user_id: params.ownerUserId,
      source: 'meta',
      metrics: toRawMetrics(row, adAccountId, params.ownerUserId, params.clientId),
      period_start: day,
      period_end: day,
    };
  });

  // 4) Normalize + score + (best-effort) persist via the ingest core.
  const result = await ingestPerformance(inputRows, {
    admin: deps.admin,
    getAdmin: deps.getAdmin,
    baseline: deps.baseline,
  });

  return { ...result, pages, fetched: rawRows.length, ...(graphError ? { error: graphError } : {}) };
}
