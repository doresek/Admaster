// store.test.ts — fleet_daily_factors persistence: idempotent upsert, total reads.

import { describe, expect, it } from 'vitest';
import { getShockState, listRecentFactors, upsertFactors } from '../store';
import { FleetStoreError, type FleetFactorUpsert } from '../types';
import { mockAdmin } from './mock-admin';

const factor = (overrides: Partial<FleetFactorUpsert> = {}): FleetFactorUpsert => ({
  date:         '2026-02-10',
  platform:     'meta',
  metric:       'cpm',
  median_delta: 0.4,
  mad:          0.03,
  sample_n:     12,
  shocked:      true,
  direction:    'up',
  note:         null,
  ...overrides,
});

describe('upsertFactors', () => {
  it('inserts new factor rows and returns them with generated fields', async () => {
    const db = mockAdmin();
    const rows = await upsertFactors(db.admin, [factor(), factor({ metric: 'ctr', shocked: false, direction: null })]);
    expect(rows).toHaveLength(2);
    expect(db.rows('fleet_daily_factors')).toHaveLength(2);
    expect(rows[0].id).toBeTruthy();
  });

  it('is idempotent on (date, platform, metric): a re-run updates in place', async () => {
    const db = mockAdmin();
    await upsertFactors(db.admin, [factor({ median_delta: 0.4 })]);
    // Same day recomputed with fresher ingest data — no duplicate row:
    const second = await upsertFactors(db.admin, [factor({ median_delta: 0.42, sample_n: 13 })]);
    expect(db.rows('fleet_daily_factors')).toHaveLength(1);
    expect(second[0].median_delta).toBe(0.42);
    expect(db.rows('fleet_daily_factors')[0].sample_n).toBe(13);
  });

  it('a different (date, platform, metric) key creates a separate row', async () => {
    const db = mockAdmin();
    await upsertFactors(db.admin, [factor()]);
    await upsertFactors(db.admin, [factor({ date: '2026-02-11' })]);
    await upsertFactors(db.admin, [factor({ platform: 'google' })]);
    expect(db.rows('fleet_daily_factors')).toHaveLength(3);
  });

  it('empty input is a no-op: no query, empty result', async () => {
    const db = mockAdmin();
    expect(await upsertFactors(db.admin, [])).toEqual([]);
    expect(db.log).toHaveLength(0);
  });

  it('DB errors surface as FleetStoreError', async () => {
    const db = mockAdmin();
    db.failOn.add('upsert:fleet_daily_factors');
    await expect(upsertFactors(db.admin, [factor()])).rejects.toThrow(FleetStoreError);
  });
});

describe('getShockState', () => {
  it('maps a present row to ShockState', async () => {
    const db = mockAdmin();
    await upsertFactors(db.admin, [factor({ note: 'expected (חג): חגי תשרי' })]);
    const s = await getShockState(db.admin, '2026-02-10', 'cpm');
    expect(s).toEqual({
      shocked:   true,
      factor:    0.4,
      direction: 'up',
      note:      'expected (חג): חגי תשרי',
    });
  });

  it('is TOTAL on absence: missing row → calm state with "no factor computed"', async () => {
    const db = mockAdmin();
    const s = await getShockState(db.admin, '1999-01-01', 'cpm');
    expect(s).toEqual({
      shocked:   false,
      factor:    null,
      direction: null,
      note:      'no factor computed',
    });
  });

  it('filters by platform (default meta; other platforms are absent → calm)', async () => {
    const db = mockAdmin();
    await upsertFactors(db.admin, [factor()]);
    const other = await getShockState(db.admin, '2026-02-10', 'cpm', 'google');
    expect(other.shocked).toBe(false);
    expect(other.note).toBe('no factor computed');
  });

  it('genuine DB errors still throw (absence ≠ breakage)', async () => {
    const db = mockAdmin();
    db.failOn.add('select:fleet_daily_factors');
    await expect(getShockState(db.admin, '2026-02-10', 'cpm')).rejects.toThrow(FleetStoreError);
  });
});

describe('listRecentFactors', () => {
  it('returns rows since the cutoff, newest first, optionally platform-scoped', async () => {
    const db = mockAdmin();
    await upsertFactors(db.admin, [
      factor({ date: '2026-02-08' }),
      factor({ date: '2026-02-09' }),
      factor({ date: '2026-02-10' }),
      factor({ date: '2026-02-10', platform: 'google' }),
      factor({ date: '2026-01-01' }),   // before the cutoff
    ]);

    const all = await listRecentFactors(db.admin, { since: '2026-02-08' });
    expect(all.map((r) => r.date)).toEqual(['2026-02-10', '2026-02-10', '2026-02-09', '2026-02-08']);

    const meta = await listRecentFactors(db.admin, { since: '2026-02-08', platform: 'meta' });
    expect(meta).toHaveLength(3);
    expect(meta.every((r) => r.platform === 'meta')).toBe(true);
  });

  it('DB errors surface as FleetStoreError', async () => {
    const db = mockAdmin();
    db.failOn.add('select:fleet_daily_factors');
    await expect(listRecentFactors(db.admin, { since: '2026-02-08' }))
      .rejects.toThrow(FleetStoreError);
  });
});
