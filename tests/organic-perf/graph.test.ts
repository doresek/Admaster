// tests/organic-perf/graph.test.ts — the live Graph fetcher over a stubbed fetch.
// Verifies the token-in-header discipline and graceful nulls on Graph errors.

import { describe, it, expect, vi } from 'vitest';
import { graphMetricsFetcher } from '@/lib/organic-perf';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const INSIGHTS_OK = {
  data: [
    { name: 'post_impressions', values: [{ value: 260 }] },
    { name: 'post_impressions_unique', values: [{ value: 200 }] },
    { name: 'post_engaged_users', values: [{ value: 12 }] },
  ],
};
const FIELDS_OK = {
  reactions: { summary: { total_count: 8 } },
  comments: { summary: { total_count: 2 } },
  shares: { count: 1 },
};

describe('graphMetricsFetcher', () => {
  it('requires an access token', () => {
    expect(() => graphMetricsFetcher('')).toThrow(/accessToken/);
  });

  it('maps insights + fields into OrganicPostMetrics', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/insights') ? jsonResponse(INSIGHTS_OK) : jsonResponse(FIELDS_OK));
    const fetcher = graphMetricsFetcher('tok-1', { fetchImpl: fetchImpl as unknown as typeof fetch, graphVersion: 'v21.0' });

    const metrics = await fetcher('page_post');
    expect(metrics).toEqual({
      reach: 200, impressions: 260, engaged: 12, reactions: 8, comments: 2, shares: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the token in the Authorization header, NEVER in the URL', async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.Authorization });
      return String(url).includes('/insights') ? jsonResponse(INSIGHTS_OK) : jsonResponse(FIELDS_OK);
    });
    const fetcher = graphMetricsFetcher('secret-token', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await fetcher('p_1');
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.url).not.toContain('secret-token');
      expect(call.auth).toBe('Bearer secret-token');
    }
  });

  it('returns null on a Graph error envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'nope' } }));
    const fetcher = graphMetricsFetcher('tok', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await fetcher('p_1')).toBeNull();
  });

  it('returns null on non-2xx / thrown fetch', async () => {
    const fetcher500 = graphMetricsFetcher('tok', {
      fetchImpl: (async () => jsonResponse({}, 500)) as unknown as typeof fetch,
    });
    expect(await fetcher500('p_1')).toBeNull();

    const fetcherThrow = graphMetricsFetcher('tok', {
      fetchImpl: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
    });
    expect(await fetcherThrow('p_1')).toBeNull();
  });

  it('missing metric values degrade to 0, not NaN', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/insights')
        ? jsonResponse({ data: [{ name: 'post_impressions', values: [] }] })
        : jsonResponse({}));
    const fetcher = graphMetricsFetcher('tok', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await fetcher('p_1')).toEqual({
      reach: 0, impressions: 0, engaged: 0, reactions: 0, comments: 0, shares: 0,
    });
  });
});
