// run-daily.test.ts — the full composition over a synthetic fleet:
// content_performance rows in → fleet_daily_factors rows out.

import { describe, expect, it } from 'vitest';
import { computeDailyFactors } from '../run-daily';
import { FLEET_METRICS } from '../types';
import { mockAdmin, type AdminMock, type MockRow } from './mock-admin';

const DATE = '2026-02-10';
const PREV = '2026-02-09';

const perfRow = (clientId: string, day: string, metrics: unknown): MockRow => ({
  client_id:    clientId,
  metrics,
  period_start: day,
  period_end:   day,
});

/**
 * A 10-client synthetic fleet: everyone has CPM (spend+impressions) on both
 * days; today 9 clients' CPM jumps +40% and 1 dips −5%. Only 3 clients report
 * ctr — below the activation gate — proving partial metrics are OK.
 */
function seedShockFleet(db: AdminMock, date = DATE, prev = PREV): void {
  const rows: MockRow[] = [];
  for (let i = 1; i <= 10; i++) {
    const c = `client-${i}`;
    // prev day: cpm = 100 (spend 100 over 1000 impressions × 1000)
    rows.push(perfRow(c, prev, { spend: 100, impressions: 1000 }));
    // today: 9 clients at cpm 140, one at 95
    const todayCpm = i === 10 ? 95 : 140;
    rows.push(perfRow(c, date, { spend: todayCpm, impressions: 1000 }));
  }
  // ctr for only 3 clients (below the 8-client gate):
  for (let i = 1; i <= 3; i++) {
    const c = `client-${i}`;
    rows.push(perfRow(c, prev, { ctr: 0.02 }));
    rows.push(perfRow(c, date, { ctr: 0.021 }));
  }
  db.seed('content_performance', rows);
}

describe('computeDailyFactors', () => {
  it('end to end: a fleet-wide CPM jump becomes a shocked cpm factor row', async () => {
    const db = mockAdmin();
    seedShockFleet(db);

    const summary = await computeDailyFactors(db.admin, { date: DATE });

    // One row per metric, always:
    expect(summary.factors).toHaveLength(FLEET_METRICS.length);
    expect(db.rows('fleet_daily_factors')).toHaveLength(FLEET_METRICS.length);

    const cpm = summary.factors.find((f) => f.metric === 'cpm');
    expect(cpm?.shocked).toBe(true);
    expect(cpm?.direction).toBe('up');
    expect(cpm?.sample_n).toBe(10);
    expect(cpm?.median_delta).toBeCloseTo(0.4, 12);
    expect(cpm?.note).toBeNull();                    // February — unexplained shock

    // spend moved identically (same jsonb) → also shocked:
    expect(summary.factors.find((f) => f.metric === 'spend')?.shocked).toBe(true);
    expect(summary.note).toContain('SHOCKED');
    expect(summary.note).toContain('cpm');
  });

  it('partial metrics OK: cpm shocked while ctr sits below the gate and cvr has no data', async () => {
    const db = mockAdmin();
    seedShockFleet(db);

    const summary = await computeDailyFactors(db.admin, { date: DATE });

    const ctr = summary.factors.find((f) => f.metric === 'ctr');
    expect(ctr?.shocked).toBe(false);
    expect(ctr?.sample_n).toBe(3);
    expect(ctr?.note).toContain('insufficient fleet');

    const cvr = summary.factors.find((f) => f.metric === 'cvr');
    expect(cvr?.shocked).toBe(false);
    expect(cvr?.sample_n).toBe(0);
    expect(cvr?.note).toContain('insufficient fleet');
  });

  it('is idempotent: re-running the same day leaves exactly one row per metric', async () => {
    const db = mockAdmin();
    seedShockFleet(db);
    await computeDailyFactors(db.admin, { date: DATE });
    await computeDailyFactors(db.admin, { date: DATE });
    expect(db.rows('fleet_daily_factors')).toHaveLength(FLEET_METRICS.length);
  });

  it('calendar overlay flows through: the same shock during tishrei is marked expected', async () => {
    const db = mockAdmin();
    seedShockFleet(db, '2026-09-20', '2026-09-19');

    const summary = await computeDailyFactors(db.admin, { date: '2026-09-20' });
    const cpm = summary.factors.find((f) => f.metric === 'cpm');
    expect(cpm?.shocked).toBe(true);                 // still a real shock — verdicts normalize
    expect(cpm?.note).toContain('expected (חג)');
    expect(cpm?.note).toContain('חגי תשרי');
  });

  it('counts skipped rows in the summary without failing the run', async () => {
    const db = mockAdmin();
    seedShockFleet(db);
    db.rows('content_performance').push(perfRow('broken-client', DATE, 'garbage'));

    const summary = await computeDailyFactors(db.admin, { date: DATE });
    expect(summary.skipped_rows).toBe(1);
    expect(summary.note).toContain('1 skipped');
    expect(summary.factors.find((f) => f.metric === 'cpm')?.shocked).toBe(true);
  });

  it('a quiet fleet produces calm rows (nothing shocked, no notes on real samples)', async () => {
    const db = mockAdmin();
    const rows: MockRow[] = [];
    for (let i = 1; i <= 10; i++) {
      rows.push(perfRow(`client-${i}`, PREV, { spend: 100, impressions: 1000 }));
      rows.push(perfRow(`client-${i}`, DATE, { spend: 100 + i, impressions: 1000 })); // ±small drift
    }
    db.seed('content_performance', rows);

    const summary = await computeDailyFactors(db.admin, { date: DATE });
    expect(summary.factors.every((f) => !f.shocked)).toBe(true);
    expect(summary.note).toContain('no shock');
  });
});
