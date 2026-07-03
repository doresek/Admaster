// lib/fleet/store.ts — persistence for fleet_daily_factors (migration 043).
//
// ADMIN CLIENT ONLY. fleet_daily_factors has RLS enabled with ZERO policies:
// no authenticated user can read or write it — only the service-role key can.
// That is deliberate (the rows are fleet-level aggregates that must never be
// tenant-visible), so unlike the tenant stores in this repo, every function
// here takes the ADMIN SupabaseClient and performs NO owner/client scoping —
// the table has no tenant columns to scope by. Passing a user-scoped client
// is not a security bug (RLS returns nothing) but it is a caller bug: reads
// come back empty and writes fail.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FleetFactorRow, ShockState } from '@/lib/capability-contracts';
import { FleetStoreError, type FleetFactorUpsert } from './types';

/** Column list mirroring migration 043 / FleetFactorRow, 1:1. */
export const FLEET_FACTOR_COLUMNS =
  'id, date, platform, metric, median_delta, mad, sample_n, shocked, direction, note, created_at';

/**
 * Idempotent write of one day's factor rows, keyed on the table's
 * unique (date, platform, metric): re-running the daily job for the same day
 * refreshes the rows in place — no duplicates, and a recompute with fresher
 * ingest data legitimately overwrites the older verdict. Empty input is a
 * no-op (no query) so callers never special-case "nothing to write".
 */
export async function upsertFactors(
  admin: SupabaseClient,
  rows:  FleetFactorUpsert[],
): Promise<FleetFactorRow[]> {
  if (rows.length === 0) return [];

  const { data, error } = await admin
    .from('fleet_daily_factors')
    .upsert(rows, { onConflict: 'date,platform,metric' })
    .select(FLEET_FACTOR_COLUMNS)
    .overrideTypes<FleetFactorRow[], { merge: false }>();

  if (error) throw new FleetStoreError(`upsertFactors: ${error.message}`);
  return data ?? [];
}

/**
 * The consumer entry point (diagnosis suppression, verdict normalization,
 * national-mood trigger): the shock state for one (date, metric, platform).
 *
 * TOTAL ON ABSENCE by design: a missing row (job hasn't run, date predates
 * the module, platform unknown) returns a calm
 * `{shocked: false, factor: null, note: 'no factor computed'}` rather than
 * throwing — consumers must degrade to "no fleet signal", never crash a
 * diagnosis because the fleet job was late. Genuine DB errors still throw
 * (a broken read is not the same as an absent row).
 */
export async function getShockState(
  admin:    SupabaseClient,
  date:     string,
  metric:   string,
  platform: string = 'meta',
): Promise<ShockState> {
  const { data, error } = await admin
    .from('fleet_daily_factors')
    .select(FLEET_FACTOR_COLUMNS)
    .eq('date', date)
    .eq('platform', platform)
    .eq('metric', metric)
    .maybeSingle()
    .overrideTypes<FleetFactorRow, { merge: false }>();

  if (error) throw new FleetStoreError(`getShockState: ${error.message}`);
  if (!data) return { shocked: false, factor: null, direction: null, note: 'no factor computed' };

  return {
    shocked:   data.shocked,
    factor:    data.median_delta,
    direction: data.direction,
    note:      data.note,
  };
}

/**
 * Recent factor rows (newest first) since an explicit cutoff date — explicit
 * so the function stays clock-free and testable. Used by ops/heartbeat
 * summaries ("was the fleet shocked this week?"), never by tenant surfaces.
 */
export async function listRecentFactors(
  admin: SupabaseClient,
  opts:  { since: string; platform?: string },
): Promise<FleetFactorRow[]> {
  let q = admin
    .from('fleet_daily_factors')
    .select(FLEET_FACTOR_COLUMNS)
    .gte('date', opts.since);
  if (opts.platform) q = q.eq('platform', opts.platform);

  const { data, error } = await q
    .order('date', { ascending: false })
    .overrideTypes<FleetFactorRow[], { merge: false }>();

  if (error) throw new FleetStoreError(`listRecentFactors: ${error.message}`);
  return data ?? [];
}
