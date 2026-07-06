// tests/organic-perf/manual.test.ts — the manual path (works today, dry-run era).

import { describe, it, expect } from 'vitest';
import {
  ingestManualMetrics,
  validateManualMetrics,
  inMemoryPerfStore,
} from '@/lib/organic-perf';

const BASE = {
  clientId: 'client-1',
  ownerUserId: 'owner-1',
};

describe('validateManualMetrics', () => {
  it('requires reach and engaged', () => {
    expect(validateManualMetrics({ engaged: 5 } as any)).toMatch(/required/);
    expect(validateManualMetrics({ reach: 100 } as any)).toMatch(/required/);
    expect(validateManualMetrics({ reach: 100, engaged: 5 })).toBeNull();
  });

  it('rejects negative and non-integer counters', () => {
    expect(validateManualMetrics({ reach: -1, engaged: 5 })).toMatch(/reach/);
    expect(validateManualMetrics({ reach: 100, engaged: 2.5 })).toMatch(/engaged/);
    expect(validateManualMetrics({ reach: 100, engaged: 5, shares: -3 })).toMatch(/shares/);
    expect(validateManualMetrics({ reach: 100, engaged: 5, comments: NaN })).toMatch(/comments/);
    expect(validateManualMetrics({ reach: 100, engaged: 5, reactions: '7' as any })).toMatch(/reactions/);
  });
});

describe('ingestManualMetrics', () => {
  it('writes a source=manual row with the SAME verdict math as the Graph path', async () => {
    const perfStore = inMemoryPerfStore();
    const result = await ingestManualMetrics({
      ...BASE,
      campaignItemId: 'item-1',
      artifactId: 'artifact-1',
      metrics: { reach: 200, engaged: 12, impressions: 260, reactions: 8, comments: 2, shares: 1 },
      now: new Date('2026-07-06T10:00:00.000Z'),
      deps: { perfStore },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toBe('worked'); // 12/200 = 0.06
    expect(perfStore.rows).toHaveLength(1);
    expect(perfStore.rows[0]).toMatchObject({
      artifact_id: 'artifact-1',
      campaign_item_id: 'item-1',
      client_id: 'client-1',
      owner_user_id: 'owner-1',
      source: 'manual',
      ad_id: null, // no Meta object behind a manual row
      period_start: '2026-07-06',
      period_end: '2026-07-06',
      verdict: 'worked',
    });
    expect(perfStore.rows[0].metrics.engagement_rate).toBe(0.06);
  });

  it('optional counters default to 0; verdict boundaries hold', async () => {
    const perfStore = inMemoryPerfStore();
    const under = await ingestManualMetrics({
      ...BASE, metrics: { reach: 100, engaged: 2 }, deps: { perfStore },
    });
    expect(under.ok && under.verdict).toBe('underperformed');
    expect(perfStore.rows[0].metrics).toMatchObject({ impressions: 0, reactions: 0, comments: 0, shares: 0 });

    const noise = await ingestManualMetrics({
      ...BASE, metrics: { reach: 49, engaged: 20 }, deps: { perfStore },
    });
    expect(noise.ok && (noise as any).verdict).toBeNull();
  });

  it('rejects invalid metrics without writing', async () => {
    const perfStore = inMemoryPerfStore();
    const result = await ingestManualMetrics({
      ...BASE, metrics: { reach: -5, engaged: 1 }, deps: { perfStore },
    });
    expect(result.ok).toBe(false);
    expect(perfStore.rows).toHaveLength(0);
  });

  it('resolves artifact_id via itemLookup when only campaignItemId is given', async () => {
    const perfStore = inMemoryPerfStore();
    const result = await ingestManualMetrics({
      ...BASE,
      campaignItemId: 'item-9',
      metrics: { reach: 100, engaged: 1 },
      deps: {
        perfStore,
        itemLookup: async (ids) => new Map(ids.map((id) => [id, `artifact-of-${id}`])),
      },
    });
    expect(result.ok).toBe(true);
    expect(perfStore.rows[0].artifact_id).toBe('artifact-of-item-9');
    expect(perfStore.rows[0].verdict).toBe('failed'); // 0.01 < 0.02
  });

  it('surfaces a failed insert as an error', async () => {
    const perfStore = inMemoryPerfStore();
    const result = await ingestManualMetrics({
      ...BASE,
      metrics: { reach: 100, engaged: 5 },
      deps: { perfStore: { ...perfStore, insert: async () => false } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/insert failed/);
  });
});
