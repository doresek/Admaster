// lib/fleet/run-daily.ts — the daily composition: ingest → compute → persist.
//
// Called SERVER-SIDE ONLY (heartbeat/cron), with the admin client — there is
// deliberately no API route over any of this (see index.ts). One run computes
// and upserts one factor row per FLEET_METRICS metric for one (date, platform).

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeFactor, relDeltas, type ComputeFactorOptions } from './compute';
import { assembleClientDayMetrics } from './ingest';
import { upsertFactors } from './store';
import { FLEET_METRICS, type DailyFactorsSummary, type FleetFactorUpsert } from './types';

export interface ComputeDailyFactorsOptions {
  /** The day to factor (ISO YYYY-MM-DD); deltas are vs the day before. */
  date:           string;
  /** Defaults to 'meta' — the only platform ingested today (migration 043 default). */
  platform?:      string;
  /** Threshold overrides — production uses the documented defaults; tests probe boundaries. */
  factorOptions?: ComputeFactorOptions;
}

/**
 * Compute and persist the fleet factors for one day.
 *
 * Partial metrics are OK by construction: each metric's factor is computed
 * from whatever deltas exist for THAT metric, so a fleet with rich CPM data
 * but no conversion tracking still gets a real cpm factor while cvr persists
 * as `insufficient fleet`. All four metric rows are always written — a
 * below-gate row (shocked=false + note) is itself the signal consumers and
 * ops need ("the fleet isn't big enough yet"), and getShockState stays
 * total either way.
 *
 * Failure semantics: ingest failures throw FleetIngestError, store failures
 * throw FleetStoreError (both typed, both carrying the failing step) — the
 * caller's cron wrapper decides retry policy. A malformed content_performance
 * ROW never fails the run; it is skipped and counted (skipped_rows).
 */
export async function computeDailyFactors(
  admin: SupabaseClient,
  opts:  ComputeDailyFactorsOptions,
): Promise<DailyFactorsSummary> {
  const platform = opts.platform ?? 'meta';

  const assembled = await assembleClientDayMetrics(admin, { date: opts.date });
  const deltas = relDeltas(assembled.prev, assembled.today);

  const upserts: FleetFactorUpsert[] = FLEET_METRICS.map((metric) => {
    const c = computeFactor(metric, opts.date, deltas, opts.factorOptions);
    return {
      date:         opts.date,
      platform,
      metric:       c.metric,
      median_delta: c.median_delta,
      mad:          c.mad,
      sample_n:     c.sample_n,
      shocked:      c.shocked,
      direction:    c.direction,
      note:         c.note,
    };
  });

  const factors = await upsertFactors(admin, upserts);
  const shockedMetrics = factors.filter((f) => f.shocked).map((f) => f.metric);

  return {
    date:         opts.date,
    platform,
    factors,
    skipped_rows: assembled.skipped_rows,
    note:
      `fleet factors ${opts.date}/${platform}: ${factors.length} metrics from ` +
      `${assembled.rows_scanned} rows (${assembled.skipped_rows} skipped); ` +
      (shockedMetrics.length > 0 ? `SHOCKED: ${shockedMetrics.join(', ')}` : 'no shock'),
  };
}
