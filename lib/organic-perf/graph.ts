// lib/organic-perf/graph.ts
//
// The LIVE PostMetricsFetcher — Graph reads for one page post, ready for the
// moment real posts exist (pages_read_engagement is already granted; publishing
// is still dry-run until App Review, so nothing calls this against a dryrun id).
//
// Two GETs per post:
//   1. /{postId}/insights?metric=post_impressions,post_impressions_unique,post_engaged_users
//   2. /{postId}?fields=reactions.summary(true),comments.summary(true),shares
//
// Token discipline (same as lib/meta-publish/client.ts): the access token
// travels ONLY in the Authorization header — never in a URL, query string,
// or log line. Any Graph error / non-JSON response ⇒ null (logged), so a bad
// post degrades to one failed slot instead of crashing the batch.

import { META_GRAPH_VERSION } from '@/lib/meta-config';
import type { OrganicPostMetrics, PostMetricsFetcher } from './types';

export interface GraphMetricsFetcherOptions {
  graphVersion?: string;
  /** Injectable for unit tests; default = global fetch. */
  fetchImpl?: typeof fetch;
}

interface InsightsEnvelope {
  data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
  error?: { message?: string };
}

interface PostFieldsEnvelope {
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
  error?: { message?: string };
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Build the live fetcher for one client's page token. */
export function graphMetricsFetcher(
  accessToken: string,
  options: GraphMetricsFetcherOptions = {},
): PostMetricsFetcher {
  if (!accessToken) throw new Error('graphMetricsFetcher requires an accessToken');
  const version = (options.graphVersion || META_GRAPH_VERSION).trim();
  const base = `https://graph.facebook.com/${version}`;
  const fetchImpl = options.fetchImpl ?? fetch;

  // GET with the token in the header ONLY; null on any error / non-JSON body.
  async function getJson<T extends { error?: { message?: string } }>(url: string): Promise<T | null> {
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as T;
      if (json?.error) {
        console.error('[organic-perf.graph] Graph error:', json.error.message ?? 'unknown');
        return null;
      }
      if (!res.ok) {
        console.error(`[organic-perf.graph] HTTP ${res.status} from Graph`);
        return null;
      }
      return json;
    } catch (e: any) {
      console.error('[organic-perf.graph] fetch failed:', e?.message ?? e);
      return null;
    }
  }

  return async (postId: string): Promise<OrganicPostMetrics | null> => {
    const insights = await getJson<InsightsEnvelope>(
      `${base}/${encodeURIComponent(postId)}/insights?metric=post_impressions,post_impressions_unique,post_engaged_users`,
    );
    if (!insights) return null;

    const byName = new Map<string, number>();
    for (const m of insights.data ?? []) {
      if (m?.name) byName.set(m.name, asCount(m.values?.[0]?.value));
    }

    const fields = await getJson<PostFieldsEnvelope>(
      `${base}/${encodeURIComponent(postId)}?fields=reactions.summary(true),comments.summary(true),shares`,
    );
    if (!fields) return null;

    return {
      reach: byName.get('post_impressions_unique') ?? 0,
      impressions: byName.get('post_impressions') ?? 0,
      engaged: byName.get('post_engaged_users') ?? 0,
      reactions: asCount(fields.reactions?.summary?.total_count),
      comments: asCount(fields.comments?.summary?.total_count),
      shares: asCount(fields.shares?.count),
    };
  };
}
