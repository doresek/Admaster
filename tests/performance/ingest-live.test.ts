// Tests for lib/performance/ingest-live.ts — LIVE Meta ad-level ingestion (T10).
//
// Everything network/DB is injected: a MOCKED Graph insights response and a
// MOCKED campaign_items mapping. We assert:
//   • correct PerformanceInputRows with ad_id → artifact/campaign_item linkage,
//   • verdicts computed AND persisted to content_performance,
//   • Graph cursor paging is followed,
//   • graceful no-op when there's no connection (no network, no throw),
//   • the token never leaks into the built insights URL,
//   • rows whose ad_id has no match still ingest (ad_id only),
//   • a Graph error envelope is handled.
import { describe, it, expect, vi } from 'vitest';
import {
  ingestLivePerformance,
  type GraphInsightsEnvelope,
  type ArtifactLink,
  type LiveIngestDeps,
  type LiveIngestParams,
} from '@/lib/performance/ingest-live';
import { makeFakeSupabase } from './fake-supabase';

const PARAMS: LiveIngestParams = {
  clientId: 'c1',
  ownerUserId: 'u1',
  adAccountId: 'act_123',
  since: '2026-06-01',
  until: '2026-06-30',
};

const SECRET = 'SECRET_TOKEN_should_never_leak';

// A healthy ad (high ROAS via strong funnel) and a dud (many impressions, no clicks).
function pageOne(): GraphInsightsEnvelope {
  return {
    data: [
      {
        ad_id: 'ad_alpha', ad_name: 'Alpha',
        date_start: '2026-06-01', date_stop: '2026-06-01',
        impressions: '5000', clicks: '150', spend: '300', reach: '4000', frequency: '1.25',
        ctr: '0.03',
        actions: [{ action_type: 'purchase', value: '30' }],
      },
      {
        ad_id: 'ad_beta', ad_name: 'Beta',
        date_start: '2026-06-01', date_stop: '2026-06-01',
        impressions: '5000', clicks: '10', spend: '120', // ctr 0.002 → failed
        actions: [],
      },
    ],
    paging: { next: 'https://graph.facebook.com/v21.0/act_123/insights?after=CURSOR2' },
  };
}

function pageTwo(): GraphInsightsEnvelope {
  return {
    data: [
      {
        ad_id: 'ad_orphan', ad_name: 'Orphan (no campaign_item)',
        date_start: '2026-06-02', date_stop: '2026-06-02',
        impressions: '3000', clicks: '90', spend: '90',
        ctr: '0.03',
        actions: [{ action_type: 'lead', value: '9' }],
      },
    ],
    // no paging.next → last page
  };
}

// campaign_items seeded so meta_object_id links two of the three ads.
function seededAdmin() {
  return makeFakeSupabase({
    campaign_items: [
      { id: 'ci_alpha', artifact_id: 'art_alpha', meta_object_id: 'ad_alpha', client_id: 'c1', owner_user_id: 'u1' },
      { id: 'ci_beta',  artifact_id: 'art_beta',  meta_object_id: 'ad_beta',  client_id: 'c1', owner_user_id: 'u1' },
    ],
  });
}

describe('ingestLivePerformance — happy path with paging + linkage', () => {
  it('fetches all pages, links ad_id → artifact, scores + persists', async () => {
    const fake = seededAdmin();
    const urls: string[] = [];
    const fetchInsights = vi.fn(async (url: string, token: string) => {
      urls.push(url);
      expect(token).toBe(SECRET); // token arrives via the dep, not the URL
      return url.includes('after=CURSOR2') ? pageTwo() : pageOne();
    });

    const deps: LiveIngestDeps = {
      admin: fake.client as any,
      getToken: async () => ({ token: SECRET, adAccountId: 'act_123' }),
      fetchInsights,
    };

    const res = await ingestLivePerformance(PARAMS, deps);

    // Two pages followed (cursor paging handled).
    expect(res.pages).toBe(2);
    expect(res.fetched).toBe(3);
    expect(fetchInsights).toHaveBeenCalledTimes(2);

    // The token NEVER appears in any built/followed URL.
    for (const u of urls) expect(u).not.toContain(SECRET);
    // The first URL targets ad-level insights (level swapped from account).
    expect(urls[0]).toContain('level=ad');
    expect(urls[0]).not.toContain('level=account');

    // Three normalized+scored rows.
    expect(res.rows).toHaveLength(3);
    const byAd = Object.fromEntries(res.rows.map((r) => [r.ad_id, r]));

    // Linkage resolved from campaign_items.meta_object_id.
    expect(byAd['ad_alpha']).toMatchObject({ artifact_id: 'art_alpha', campaign_item_id: 'ci_alpha' });
    expect(byAd['ad_beta']).toMatchObject({ artifact_id: 'art_beta', campaign_item_id: 'ci_beta' });
    // Orphan ad still ingests, by ad_id only.
    expect(byAd['ad_orphan']).toMatchObject({ artifact_id: null, campaign_item_id: null, ad_id: 'ad_orphan' });

    // Verdicts: strong funnel → worked, dead CTR w/ 5000 impressions → failed.
    expect(byAd['ad_alpha'].verdict).toBe('worked');
    expect(byAd['ad_beta'].verdict).toBe('failed');
    expect(byAd['ad_alpha'].source).toBe('meta');

    // Persisted to content_performance.
    expect(res.persisted).toBe(3);
    expect(res.persistedTable).toBe(true);
    const written = fake.tables['content_performance'];
    expect(written).toHaveLength(3);
    const alpha = written.find((w: any) => w.ad_id === 'ad_alpha');
    expect(alpha).toMatchObject({ artifact_id: 'art_alpha', campaign_item_id: 'ci_alpha', verdict: 'worked' });
    expect(alpha.metrics.ctr).toBeCloseTo(0.03, 6);
    // period_start == period_end for time_increment=1 daily rows.
    expect(alpha.period_start).toBe('2026-06-01');
    expect(alpha.period_end).toBe('2026-06-01');
  });
});

describe('ingestLivePerformance — default resolveArtifact via admin client', () => {
  it('resolves linkage from campaign_items when no resolveArtifact dep is given', async () => {
    const fake = seededAdmin();
    const res = await ingestLivePerformance(PARAMS, {
      admin: fake.client as any,
      getToken: async () => ({ token: SECRET, adAccountId: 'act_123' }),
      fetchInsights: async () => ({ data: pageOne().data }), // single page, no next
    });
    expect(res.rows).toHaveLength(2);
    const alpha = res.rows.find((r) => r.ad_id === 'ad_alpha')!;
    expect(alpha.artifact_id).toBe('art_alpha');
    expect(alpha.campaign_item_id).toBe('ci_alpha');
  });
});

describe('ingestLivePerformance — graceful no-connection', () => {
  it('returns empty + skipped:no_connection with NO network call and no throw', async () => {
    const fetchInsights = vi.fn(async () => ({ data: [] } as GraphInsightsEnvelope));
    const res = await ingestLivePerformance(PARAMS, {
      getToken: async () => null, // no token
      fetchInsights,
    });
    expect(res.skipped).toBe('no_connection');
    expect(res.rows).toEqual([]);
    expect(res.persisted).toBe(0);
    expect(res.persistedTable).toBe(false);
    expect(fetchInsights).not.toHaveBeenCalled(); // never hit the network
  });

  it('is a no-op no_connection when no admin and no getToken dep exist (no creds path)', async () => {
    const res = await ingestLivePerformance(PARAMS, {});
    expect(res.skipped).toBe('no_connection');
    expect(res.rows).toEqual([]);
    expect(res.pages).toBe(0);
  });
});

describe('ingestLivePerformance — Graph error envelope', () => {
  it('short-circuits to skipped:graph_error on a first-page error', async () => {
    const res = await ingestLivePerformance(PARAMS, {
      admin: seededAdmin().client as any,
      getToken: async () => ({ token: SECRET, adAccountId: 'act_123' }),
      fetchInsights: async () => ({ error: { message: 'Invalid OAuth access token', code: 190 } }),
    });
    expect(res.skipped).toBe('graph_error');
    expect(res.error).toContain('Invalid OAuth');
    expect(res.rows).toEqual([]);
    expect(res.persisted).toBe(0);
    expect(res.pages).toBe(1);
  });

  it('keeps rows collected before a mid-paging error', async () => {
    let call = 0;
    const res = await ingestLivePerformance(PARAMS, {
      admin: seededAdmin().client as any,
      getToken: async () => ({ token: SECRET, adAccountId: 'act_123' }),
      fetchInsights: async () => {
        call++;
        return call === 1
          ? pageOne() // has paging.next
          : ({ error: { message: 'rate limited', code: 4 } } as GraphInsightsEnvelope);
      },
    });
    expect(res.pages).toBe(2);
    expect(res.rows).toHaveLength(2); // page-one rows survived
    expect(res.error).toContain('rate limited');
    expect(res.persisted).toBe(2);
  });
});

describe('ingestLivePerformance — injected resolveArtifact + no admin persistence', () => {
  it('uses the resolveArtifact dep and reports persisted:0 without an admin', async () => {
    const resolveArtifact = vi.fn(async (adIds: string[]): Promise<Map<string, ArtifactLink>> => {
      const m = new Map<string, ArtifactLink>();
      if (adIds.includes('ad_alpha')) m.set('ad_alpha', { artifact_id: 'A', campaign_item_id: 'CI' });
      return m;
    });
    const res = await ingestLivePerformance(PARAMS, {
      getToken: async () => ({ token: SECRET, adAccountId: 'act_123' }),
      fetchInsights: async () => ({ data: pageOne().data }),
      resolveArtifact,
    });
    expect(resolveArtifact).toHaveBeenCalledOnce();
    expect(resolveArtifact.mock.calls[0][0].sort()).toEqual(['ad_alpha', 'ad_beta']);
    expect(res.rows.find((r) => r.ad_id === 'ad_alpha')!.artifact_id).toBe('A');
    expect(res.rows.find((r) => r.ad_id === 'ad_beta')!.artifact_id).toBeNull();
    // No admin → verdicts computed, nothing persisted.
    expect(res.persisted).toBe(0);
    expect(res.persistedTable).toBe(false);
  });
});
