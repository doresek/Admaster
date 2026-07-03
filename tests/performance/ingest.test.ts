// Tests for lib/performance/ingest.ts — metric normalization, verdict thresholds,
// and best-effort persistence to content_performance.
import { describe, it, expect } from 'vitest';
import {
  ingestPerformance,
  normalizeMetrics,
  computeVerdict,
  PERFORMANCE_THRESHOLDS as T,
  type PerformanceInputRow,
} from '@/lib/performance/ingest';
import { makeFakeSupabase } from './fake-supabase';

describe('normalizeMetrics', () => {
  it('derives ctr / conversion_rate / cpa from raw counts', () => {
    const m = normalizeMetrics({ impressions: 2000, clicks: 40, conversions: 4, spend: 200 });
    expect(m.ctr).toBeCloseTo(0.02, 6);             // 40 / 2000
    expect(m.conversion_rate).toBeCloseTo(0.1, 6);  // 4 / 40
    expect(m.cpa).toBeCloseTo(50, 6);               // 200 / 4
  });

  it('prefers explicit ratios over derived ones', () => {
    const m = normalizeMetrics({ impressions: 2000, clicks: 40, ctr: 0.05 });
    expect(m.ctr).toBe(0.05);
  });

  it('omits fields that are absent and never divides by zero', () => {
    const m = normalizeMetrics({ impressions: 0, clicks: 0 });
    expect(m.ctr).toBeUndefined();
    expect(m.conversion_rate).toBeUndefined();
    expect(m.cpa).toBeUndefined();
  });
});

describe('computeVerdict (default thresholds)', () => {
  it('ROAS at/above the worked band → worked', () => {
    expect(computeVerdict({ impressions: 5000, roas: T.WORKED_ROAS })).toBe('worked');
  });
  it('ROAS below the failed band → failed', () => {
    expect(computeVerdict({ impressions: 5000, roas: T.FAILED_ROAS - 0.1 })).toBe('failed');
  });
  it('ROAS between bands → underperformed', () => {
    expect(computeVerdict({ impressions: 5000, roas: 1.0 })).toBe('underperformed');
  });

  it('healthy CTR + healthy conversion → worked (no ROAS)', () => {
    expect(computeVerdict({ impressions: 5000, ctr: 0.02, conversion_rate: 0.02 })).toBe('worked');
  });
  it('bad CTR with enough impressions → failed', () => {
    expect(computeVerdict({ impressions: 5000, ctr: 0.003 })).toBe('failed');
  });
  it('good CTR but dead conversions → underperformed (diagnosis decides the link)', () => {
    expect(computeVerdict({ impressions: 5000, ctr: 0.02, conversion_rate: 0.001 })).toBe('underperformed');
  });
  it('bad CTR but too few impressions → underperformed, not failed', () => {
    expect(computeVerdict({ impressions: T.MIN_IMPRESSIONS - 1, ctr: 0.003 })).toBe('underperformed');
  });
});

describe('computeVerdict (with baseline)', () => {
  it('uses relative ROAS bands around the baseline target', () => {
    const baseline = { target_roas: 3 };
    expect(computeVerdict({ roas: 3.7 }, baseline)).toBe('worked');        // >= 120% of 3
    expect(computeVerdict({ roas: 2.0 }, baseline)).toBe('failed');        // < 80% of 3
    expect(computeVerdict({ roas: 2.8 }, baseline)).toBe('underperformed');
  });
  it('uses CPA vs target when no ROAS', () => {
    const baseline = { target_cpa: 40 };
    expect(computeVerdict({ cpa: 35 }, baseline)).toBe('worked');
    expect(computeVerdict({ cpa: 70 }, baseline)).toBe('failed');          // > 150% of 40
    expect(computeVerdict({ cpa: 50 }, baseline)).toBe('underperformed');
  });
});

describe('ingestPerformance', () => {
  const rows: PerformanceInputRow[] = [
    { artifact_id: 'a1', campaign_item_id: 'ci1', ad_id: 'ad_1', client_id: 'c1', owner_user_id: 'u1',
      metrics: { impressions: 5000, clicks: 100, conversions: 10, spend: 300, roas: 2 } },
    { artifact_id: 'a2', ad_id: 'ad_2', client_id: 'c1', owner_user_id: 'u1',
      metrics: { impressions: 5000, clicks: 10 } }, // ctr 0.002 → failed
  ];

  it('normalizes, scores and persists each row to content_performance', async () => {
    const fake = makeFakeSupabase();
    const res = await ingestPerformance(rows, { admin: fake.client as any });

    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].verdict).toBe('worked');
    expect(res.rows[1].verdict).toBe('failed');
    expect(res.persisted).toBe(2);
    expect(res.persistedTable).toBe(true);

    const written = fake.tables['content_performance'];
    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ artifact_id: 'a1', campaign_item_id: 'ci1', ad_id: 'ad_1', verdict: 'worked' });
    expect(written[0].metrics.ctr).toBeCloseTo(0.02, 6);
  });

  it('is graceful when the content_performance table is absent (no throw, persisted 0)', async () => {
    const fake = makeFakeSupabase({}, { failTables: ['content_performance'] });
    const res = await ingestPerformance(rows, { admin: fake.client as any });
    expect(res.rows).toHaveLength(2);          // verdicts still computed
    expect(res.persisted).toBe(0);
    expect(res.persistedTable).toBe(false);
  });

  it('is graceful when no admin client is supplied', async () => {
    const res = await ingestPerformance(rows, {});
    expect(res.rows).toHaveLength(2);
    expect(res.persisted).toBe(0);
    expect(res.persistedTable).toBe(false);
  });

  it('C5: re-ingesting the SAME window UPSERTs — no duplicate content_performance rows', async () => {
    const fake = makeFakeSupabase();
    const window: PerformanceInputRow[] = [
      { artifact_id: 'a1', ad_id: 'ad_1', client_id: 'c1', owner_user_id: 'u1',
        period_start: '2026-06-01', period_end: '2026-06-07',
        metrics: { impressions: 5000, clicks: 100, conversions: 10, spend: 300, roas: 2 } },
    ];

    const first = await ingestPerformance(window, { admin: fake.client as any });
    expect(first.persisted).toBe(1);
    expect(fake.tables['content_performance']).toHaveLength(1);

    // Meta re-pulled the same 7-day window → upsert refreshes the row in place.
    const second = await ingestPerformance(window, { admin: fake.client as any });
    expect(second.persisted).toBe(1);
    expect(fake.tables['content_performance']).toHaveLength(1); // NOT 2 — same unique key
  });

  it('C5: manual rows (null ad_id) remain plain inserts — distinct, never merged', async () => {
    const fake = makeFakeSupabase();
    const manual: PerformanceInputRow[] = [
      { client_id: 'c1', owner_user_id: 'u1', source: 'manual', metrics: { impressions: 5000, clicks: 100 } },
    ];
    await ingestPerformance(manual, { admin: fake.client as any });
    await ingestPerformance(manual, { admin: fake.client as any });
    expect(fake.tables['content_performance']).toHaveLength(2);
  });
});
