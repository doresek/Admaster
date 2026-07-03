// ingest.test.ts — the cross-tenant assembly: two queries, defensive jsonb
// extraction, in-memory grouping.

import { describe, expect, it } from 'vitest';
import { assembleClientDayMetrics, extractFleetMetrics, isoDayBefore } from '../ingest';
import { FleetIngestError } from '../types';
import { mockAdmin, type MockRow } from './mock-admin';

const DATE = '2026-02-10';
const PREV = '2026-02-09';

const perfRow = (clientId: string, day: string, metrics: unknown): MockRow => ({
  client_id:    clientId,
  metrics,
  period_start: day,
  period_end:   day,
});

describe('isoDayBefore', () => {
  it('simple day arithmetic', () => {
    expect(isoDayBefore('2026-02-10')).toBe('2026-02-09');
  });

  it('month and year boundaries, leap day', () => {
    expect(isoDayBefore('2026-03-01')).toBe('2026-02-28');
    expect(isoDayBefore('2028-03-01')).toBe('2028-02-29');  // 2028 is a leap year
    expect(isoDayBefore('2026-01-01')).toBe('2025-12-31');
  });

  it('rejects malformed dates with a typed error', () => {
    expect(() => isoDayBefore('10/02/2026')).toThrow(FleetIngestError);
    expect(() => isoDayBefore('2026-2-10')).toThrow(FleetIngestError);
  });
});

describe('extractFleetMetrics — defensive jsonb reads', () => {
  it('reads ctr/spend directly and cvr from conversion_rate (the live-pipeline key)', () => {
    expect(extractFleetMetrics({ ctr: 0.02, spend: 120, conversion_rate: 0.05 }))
      .toEqual({ ctr: 0.02, cvr: 0.05, spend: 120 });
  });

  it('derives cpm from spend + impressions when no cpm key exists', () => {
    expect(extractFleetMetrics({ spend: 50, impressions: 10_000 }))
      .toEqual({ cpm: 5, spend: 50 });
  });

  it('a literal cpm key wins over the derivation', () => {
    expect(extractFleetMetrics({ cpm: 7, spend: 50, impressions: 10_000 }))
      .toEqual({ cpm: 7, spend: 50 });
  });

  it('returns null for non-object payloads (null, string, array, number)', () => {
    expect(extractFleetMetrics(null)).toBeNull();
    expect(extractFleetMetrics('broken')).toBeNull();
    expect(extractFleetMetrics([1, 2])).toBeNull();
    expect(extractFleetMetrics(42)).toBeNull();
  });

  it('returns null when nothing usable is present ({}, wrong types, negatives, NaN)', () => {
    expect(extractFleetMetrics({})).toBeNull();
    expect(extractFleetMetrics({ ctr: 'abc', spend: -5, cpm: NaN })).toBeNull();
  });

  it('partial rows contribute what they have (bad fields dropped, good kept)', () => {
    expect(extractFleetMetrics({ ctr: 0.03, cvr: 'oops' })).toEqual({ ctr: 0.03 });
  });
});

describe('assembleClientDayMetrics', () => {
  it('runs exactly TWO content_performance queries (one per day, no N+1)', async () => {
    const db = mockAdmin();
    db.seed('content_performance', [
      perfRow('c1', DATE, { ctr: 0.02 }),
      perfRow('c1', PREV, { ctr: 0.03 }),
      perfRow('c2', DATE, { ctr: 0.05 }),
    ]);
    await assembleClientDayMetrics(db.admin, { date: DATE });
    expect(db.log.filter((l) => l === 'select:content_performance')).toHaveLength(2);
    expect(db.log).toHaveLength(2);
  });

  it('groups per client: mean for rates across a client’s ads, sum for spend', async () => {
    const db = mockAdmin();
    db.seed('content_performance', [
      // c1 runs two ads today:
      perfRow('c1', DATE, { ctr: 0.02, spend: 100 }),
      perfRow('c1', DATE, { ctr: 0.04, spend: 50 }),
      perfRow('c2', DATE, { ctr: 0.05 }),
    ]);
    const out = await assembleClientDayMetrics(db.admin, { date: DATE });

    const c1ctr   = out.today.find((m) => m.client_id === 'c1' && m.metric === 'ctr');
    const c1spend = out.today.find((m) => m.client_id === 'c1' && m.metric === 'spend');
    const c2ctr   = out.today.find((m) => m.client_id === 'c2' && m.metric === 'ctr');
    expect(c1ctr?.value).toBeCloseTo(0.03, 12);   // mean(0.02, 0.04)
    expect(c1spend?.value).toBe(150);              // sum(100, 50)
    expect(c2ctr?.value).toBe(0.05);
    expect(out.today).toHaveLength(3);             // no cross-client bleed
  });

  it('splits today vs prev correctly and reports both dates', async () => {
    const db = mockAdmin();
    db.seed('content_performance', [
      perfRow('c1', DATE, { ctr: 0.02 }),
      perfRow('c1', PREV, { ctr: 0.04 }),
      perfRow('c1', '2026-02-01', { ctr: 0.99 }),  // unrelated day — must not appear
    ]);
    const out = await assembleClientDayMetrics(db.admin, { date: DATE });
    expect(out.date).toBe(DATE);
    expect(out.prev_date).toBe(PREV);
    expect(out.today).toEqual([{ client_id: 'c1', date: DATE, metric: 'ctr', value: 0.02 }]);
    expect(out.prev).toEqual([{ client_id: 'c1', date: PREV, metric: 'ctr', value: 0.04 }]);
  });

  it('excludes multi-day aggregate rows (period_start ≠ period_end)', async () => {
    const db = mockAdmin();
    db.seed('content_performance', [
      { client_id: 'c1', metrics: { ctr: 0.5 }, period_start: '2026-02-01', period_end: DATE },
      perfRow('c2', DATE, { ctr: 0.02 }),
    ]);
    const out = await assembleClientDayMetrics(db.admin, { date: DATE });
    expect(out.today).toHaveLength(1);
    expect(out.today[0].client_id).toBe('c2');
  });

  it('skips and COUNTS malformed rows without failing the run', async () => {
    const db = mockAdmin();
    db.seed('content_performance', [
      perfRow('c1', DATE, null),                    // jsonb null
      perfRow('c2', DATE, 'garbage'),               // jsonb string
      perfRow('c3', DATE, { ctr: 'NaN-ish' }),      // nothing usable
      perfRow('c4', DATE, { ctr: 0.02 }),           // fine
      perfRow('c5', PREV, {}),                      // empty bag on prev day
    ]);
    const out = await assembleClientDayMetrics(db.admin, { date: DATE });
    expect(out.skipped_rows).toBe(4);
    expect(out.rows_scanned).toBe(5);
    expect(out.today).toHaveLength(1);
    expect(out.today[0].client_id).toBe('c4');
  });

  it('propagates DB errors as FleetIngestError (never a silent empty fleet)', async () => {
    const db = mockAdmin();
    db.failOn.add('select:content_performance');
    await expect(assembleClientDayMetrics(db.admin, { date: DATE }))
      .rejects.toThrow(FleetIngestError);
  });
});
