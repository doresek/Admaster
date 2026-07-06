// tests/organic-perf/ingest.test.ts — the Graph-path ingester, all seams stubbed.

import { describe, it, expect, vi } from 'vitest';
import type { OrganicSlot } from '@/lib/organic-publish/types';
import {
  ingestOrganicPerformance,
  inMemoryPerfStore,
  measurementDay,
  isDryRunPostId,
  type OrganicPostMetrics,
  type SlotSource,
} from '@/lib/organic-perf';

const NOW = new Date('2026-07-06T10:00:00.000Z');
const OWNER = 'owner-1';
const CLIENT = 'client-1';

function makeSlot(overrides: Partial<OrganicSlot> = {}): OrganicSlot {
  return {
    id: 'slot-1',
    client_id: CLIENT,
    owner_user_id: OWNER,
    campaign_id: 'camp-1',
    campaign_item_id: 'item-1',
    page_id: 'page-1',
    post_kind: 'text',
    message: 'שלום עולם',
    image_url: null,
    link_url: null,
    scheduled_at: '2026-07-05T08:00:00.000Z',
    published_at: '2026-07-05T08:00:01.000Z',
    meta_post_id: 'page-1_post-1',
    status: 'published',
    grounded_in: [],
    rationale: null,
    ...overrides,
  };
}

function slotSource(slots: OrganicSlot[]): SlotSource {
  return { listPublished: async () => slots };
}

const METRICS: OrganicPostMetrics = {
  reach: 200, impressions: 260, engaged: 12, reactions: 8, comments: 2, shares: 1,
};

describe('ingestOrganicPerformance', () => {
  it('writes one complete content_performance row per published slot', async () => {
    const perfStore = inMemoryPerfStore();
    const fetcher = vi.fn(async () => METRICS);
    const itemLookup = vi.fn(async (ids: string[]) =>
      new Map(ids.map((id) => [id, `artifact-of-${id}`])));

    const summary = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: NOW,
      deps: { slots: slotSource([makeSlot()]), fetcher, perfStore, itemLookup },
    });

    expect(summary).toMatchObject({ ingested: 1, skippedDryRun: 0, skippedDuplicates: 0, failed: 0 });
    expect(perfStore.rows).toHaveLength(1);
    const row = perfStore.rows[0];
    expect(row).toMatchObject({
      artifact_id: 'artifact-of-item-1',
      campaign_item_id: 'item-1',
      client_id: CLIENT,
      owner_user_id: OWNER,
      source: 'meta',
      ad_id: 'page-1_post-1',
      period_start: '2026-07-06',
      period_end: '2026-07-06',
      verdict: 'worked', // 12/200 = 0.06
    });
    expect(row.metrics).toEqual({ ...METRICS, engagement_rate: 0.06 });
  });

  it('skips dryrun_* post ids with a note and NEVER calls the fetcher for them', async () => {
    const perfStore = inMemoryPerfStore();
    const fetcher = vi.fn(async () => METRICS);

    const summary = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: NOW,
      deps: {
        slots: slotSource([
          makeSlot({ id: 'slot-dry', campaign_item_id: 'item-dry', meta_post_id: 'dryrun_post_3' }),
          makeSlot({ id: 'slot-real', campaign_item_id: 'item-real', meta_post_id: 'real_1' }),
        ]),
        fetcher, perfStore,
      },
    });

    expect(summary).toMatchObject({ ingested: 1, skippedDryRun: 1, failed: 0 });
    expect(summary.notes.some((n) => n.includes('dryrun_post_3'))).toBe(true);
    // Fetcher called exactly once — with the REAL id only.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('real_1');
    expect(perfStore.rows).toHaveLength(1);
    expect(perfStore.rows[0].ad_id).toBe('real_1');
  });

  it('dedupes: one row per campaign_item per calendar day (re-run is idempotent)', async () => {
    const perfStore = inMemoryPerfStore();
    const fetcher = vi.fn(async () => METRICS);
    const deps = { slots: slotSource([makeSlot()]), fetcher, perfStore };

    const first = await ingestOrganicPerformance({ ownerUserId: OWNER, clientId: CLIENT, now: NOW, deps });
    const second = await ingestOrganicPerformance({ ownerUserId: OWNER, clientId: CLIENT, now: NOW, deps });

    expect(first.ingested).toBe(1);
    expect(second).toMatchObject({ ingested: 0, skippedDuplicates: 1, failed: 0 });
    expect(perfStore.rows).toHaveLength(1);

    // A NEW calendar day ingests again.
    const nextDay = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: new Date('2026-07-07T10:00:00.000Z'), deps,
    });
    expect(nextDay.ingested).toBe(1);
    expect(perfStore.rows).toHaveLength(2);
    expect(perfStore.rows[1].period_start).toBe('2026-07-07');
  });

  it('dedupes by post id when the slot has no campaign_item linkage', async () => {
    const perfStore = inMemoryPerfStore();
    const fetcher = vi.fn(async () => METRICS);
    const deps = {
      slots: slotSource([makeSlot({ campaign_item_id: null, meta_post_id: 'p_9' })]),
      fetcher, perfStore,
    };

    await ingestOrganicPerformance({ ownerUserId: OWNER, clientId: CLIENT, now: NOW, deps });
    const rerun = await ingestOrganicPerformance({ ownerUserId: OWNER, clientId: CLIENT, now: NOW, deps });
    expect(rerun.skippedDuplicates).toBe(1);
    expect(perfStore.rows).toHaveLength(1);
    expect(perfStore.rows[0].campaign_item_id).toBeNull();
    expect(perfStore.rows[0].artifact_id).toBeNull();
  });

  it('a per-slot failure (fetcher throw) continues the batch', async () => {
    const perfStore = inMemoryPerfStore();
    const fetcher = vi.fn(async (postId: string) => {
      if (postId === 'boom') throw new Error('Graph exploded');
      return METRICS;
    });

    const summary = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: NOW,
      deps: {
        slots: slotSource([
          makeSlot({ id: 'slot-a', campaign_item_id: 'item-a', meta_post_id: 'boom' }),
          makeSlot({ id: 'slot-b', campaign_item_id: 'item-b', meta_post_id: 'fine_1' }),
        ]),
        fetcher, perfStore,
      },
    });

    expect(summary).toMatchObject({ ingested: 1, failed: 1 });
    expect(summary.notes.some((n) => n.includes('Graph exploded'))).toBe(true);
    expect(perfStore.rows).toHaveLength(1);
    expect(perfStore.rows[0].campaign_item_id).toBe('item-b');
  });

  it('a null-metrics fetcher result counts as failed, batch continues', async () => {
    const perfStore = inMemoryPerfStore();
    const fetcher = vi.fn(async (postId: string) => (postId === 'gone' ? null : METRICS));

    const summary = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: NOW,
      deps: {
        slots: slotSource([
          makeSlot({ id: 'slot-a', campaign_item_id: 'item-a', meta_post_id: 'gone' }),
          makeSlot({ id: 'slot-b', campaign_item_id: 'item-b', meta_post_id: 'fine_1' }),
        ]),
        fetcher, perfStore,
      },
    });

    expect(summary).toMatchObject({ ingested: 1, failed: 1 });
    expect(perfStore.rows).toHaveLength(1);
  });

  it('a failed insert counts as failed, batch continues', async () => {
    const perfStore = inMemoryPerfStore();
    let calls = 0;
    const flakyStore = {
      ...perfStore,
      insert: async (row: Parameters<typeof perfStore.insert>[0]) => {
        calls++;
        if (calls === 1) return false; // first write fails
        return perfStore.insert(row);
      },
    };

    const summary = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: NOW,
      deps: {
        slots: slotSource([
          makeSlot({ id: 'slot-a', campaign_item_id: 'item-a', meta_post_id: 'p_1' }),
          makeSlot({ id: 'slot-b', campaign_item_id: 'item-b', meta_post_id: 'p_2' }),
        ]),
        fetcher: async () => METRICS,
        perfStore: flakyStore,
      },
    });

    expect(summary).toMatchObject({ ingested: 1, failed: 1 });
    expect(perfStore.rows).toHaveLength(1);
  });

  it('low reach (< 50) produces a null verdict row — measured, not judged', async () => {
    const perfStore = inMemoryPerfStore();
    const summary = await ingestOrganicPerformance({
      ownerUserId: OWNER, clientId: CLIENT, now: NOW,
      deps: {
        slots: slotSource([makeSlot()]),
        fetcher: async () => ({ reach: 30, impressions: 35, engaged: 30, reactions: 1, comments: 0, shares: 0 }),
        perfStore,
      },
    });
    expect(summary.ingested).toBe(1);
    expect(perfStore.rows[0].verdict).toBeNull();
    expect(perfStore.rows[0].metrics.engagement_rate).toBe(1);
  });
});

describe('helpers', () => {
  it('isDryRunPostId matches the dryrun_ prefix only', () => {
    expect(isDryRunPostId('dryrun_post_1')).toBe(true);
    expect(isDryRunPostId('real_dryrun_post')).toBe(false);
  });

  it('measurementDay is the UTC calendar day', () => {
    expect(measurementDay(new Date('2026-07-06T23:59:59.999Z'))).toBe('2026-07-06');
    expect(measurementDay(new Date('2026-07-06T00:00:00.000Z'))).toBe('2026-07-06');
  });
});
