// lib/fleet/ingest.ts — cross-tenant read of content_performance for the fleet.
//
// ██ CROSS-TENANT READ — READ THIS BEFORE REUSING THE PATTERN ██
// This module performs the ONE legitimately cross-tenant read in the codebase:
// it queries content_performance across ALL clients of ALL owners, with no
// owner_user_id / client_id scoping. That is the entire point of C-04 — a
// market-level event is only visible by looking across the fleet at once
// (VISION-DEEP §8.2.5: "it requires being many marketers at once").
// The safety contract that makes this acceptable:
//   1. SERVICE-ROLE ONLY. Every function takes the ADMIN client; there is no
//      tenant-facing path into this module and no API route over it.
//   2. AGGREGATES ONLY LEAVE. client_ids exist transiently in memory to pair
//      day-over-day values; what gets persisted (fleet_daily_factors, RLS-on
//      with ZERO policies) is median/MAD/sample_n — nothing tenant-identifying
//      ever leaves this module or reaches a tenant-visible surface.
// Do NOT copy this unscoped-query pattern anywhere else.
//
// Query discipline: exactly ONE query per day (two per run), grouped in
// memory — no per-client N+1.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FLEET_METRICS,
  FleetIngestError,
  type AssembledClientDays,
  type ClientDayMetric,
  type FleetMetric,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO day arithmetic in UTC (no DST surprises: UTC days are exactly 86 400 000 ms). */
export function isoDayBefore(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!ISO_DATE.test(date) || Number.isNaN(parsed)) {
    throw new FleetIngestError(`isoDayBefore: expected ISO YYYY-MM-DD date, got "${date}"`);
  }
  return new Date(parsed - 86_400_000).toISOString().slice(0, 10);
}

// ── defensive metrics extraction ──────────────────────────────────────────────

/** Narrowing type guard (a predicate, not a cast) for jsonb payloads. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A finite, non-negative number or null — metric values can never be negative. */
function finiteNonNegative(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Pull the fleet metrics out of one content_performance `metrics` jsonb,
 * defensively — the bag's exact keys vary by writer (live Meta ingestion vs
 * manual rows), so every read is checked:
 *  - ctr / spend: read directly.
 *  - cvr: the live pipeline stores it as `conversion_rate`
 *    (lib/performance/ingest.ts normalizeMetrics); accept `cvr` too.
 *  - cpm: not stored by the live pipeline — derived from spend & impressions
 *    (spend / impressions × 1000) when both exist; a literal `cpm` key wins.
 * Returns null when NOTHING usable is present (the row is counted as skipped);
 * a partially usable row contributes what it has — per-metric fleets are
 * allowed to have different sample sizes.
 */
export function extractFleetMetrics(raw: unknown): Partial<Record<FleetMetric, number>> | null {
  if (!isRecord(raw)) return null;

  const spend       = finiteNonNegative(raw.spend);
  const impressions = finiteNonNegative(raw.impressions);
  const ctr         = finiteNonNegative(raw.ctr);
  const cvr         = finiteNonNegative(raw.cvr) ?? finiteNonNegative(raw.conversion_rate);
  const cpmDerived  =
    spend !== null && impressions !== null && impressions > 0
      ? (spend / impressions) * 1000
      : null;
  const cpm = finiteNonNegative(raw.cpm) ?? cpmDerived;

  const out: Partial<Record<FleetMetric, number>> = {};
  if (cpm   !== null) out.cpm   = cpm;
  if (ctr   !== null) out.ctr   = ctr;
  if (cvr   !== null) out.cvr   = cvr;
  if (spend !== null) out.spend = spend;
  return Object.keys(out).length > 0 ? out : null;
}

// ── assembly ──────────────────────────────────────────────────────────────────

/** The columns the fleet needs — client_id never survives past aggregation. */
const PERF_COLUMNS = 'client_id, metrics';

interface PerfRow {
  client_id: string;
  metrics:   unknown;   // jsonb — trusted for nothing until extractFleetMetrics
}

interface DayScan {
  metrics: ClientDayMetric[];
  skipped: number;
  scanned: number;
}

/** Running mean/sum accumulator for one (client, metric). */
interface Acc {
  sum:   number;
  count: number;
}

/**
 * ONE query for one day's rows, then in-memory aggregation to one value per
 * (client, metric). Only true daily rows qualify (period_start = period_end =
 * day — how the live pipeline writes, time_increment=1); multi-day aggregates
 * would contaminate day-over-day deltas, so they're excluded by the filter
 * itself, not post-hoc.
 *
 * Per-client aggregation across a client's multiple ads:
 *  - rate metrics (cpm, ctr, cvr): arithmetic MEAN — "how the client's typical
 *    ad moved". (Spend-weighting would be better science but needs spend on
 *    every row; the mean is total and the fleet median on top is what carries
 *    the robustness anyway.)
 *  - spend: SUM — spend is additive across ads.
 */
async function scanDay(admin: SupabaseClient, day: string): Promise<DayScan> {
  const { data, error } = await admin
    .from('content_performance')
    .select(PERF_COLUMNS)
    .eq('period_start', day)
    .eq('period_end', day)
    .overrideTypes<PerfRow[], { merge: false }>();
  if (error) throw new FleetIngestError(`scanDay(${day}): ${error.message}`);

  const rows = data ?? [];
  let skipped = 0;
  const byClient = new Map<string, Map<FleetMetric, Acc>>();

  for (const row of rows) {
    const extracted =
      typeof row.client_id === 'string' ? extractFleetMetrics(row.metrics) : null;
    if (extracted === null) {
      skipped += 1;
      continue;
    }
    let accs = byClient.get(row.client_id);
    if (!accs) {
      accs = new Map<FleetMetric, Acc>();
      byClient.set(row.client_id, accs);
    }
    for (const metric of FLEET_METRICS) {
      const value = extracted[metric];
      if (value === undefined) continue;
      const acc = accs.get(metric);
      if (acc) {
        acc.sum   += value;
        acc.count += 1;
      } else {
        accs.set(metric, { sum: value, count: 1 });
      }
    }
  }

  const metrics: ClientDayMetric[] = [];
  for (const [clientId, accs] of byClient) {
    for (const [metric, acc] of accs) {
      metrics.push({
        client_id: clientId,
        date:      day,
        metric,
        value: metric === 'spend' ? acc.sum : acc.sum / acc.count,
      });
    }
  }
  return { metrics, skipped, scanned: rows.length };
}

/**
 * Assemble the fleet's per-client day metrics for `date` and `date − 1` —
 * exactly two content_performance queries total, everything else in memory.
 * Malformed rows (metrics jsonb missing/not an object/no usable numbers) are
 * skipped and COUNTED, never guessed at — skipped_rows in the run summary is
 * the ops signal that an upstream writer changed shape.
 */
export async function assembleClientDayMetrics(
  admin: SupabaseClient,
  opts:  { date: string },
): Promise<AssembledClientDays> {
  const prevDate = isoDayBefore(opts.date);         // also validates opts.date
  const today = await scanDay(admin, opts.date);
  const prev  = await scanDay(admin, prevDate);

  return {
    date:         opts.date,
    prev_date:    prevDate,
    today:        today.metrics,
    prev:         prev.metrics,
    skipped_rows: today.skipped + prev.skipped,
    rows_scanned: today.scanned + prev.scanned,
  };
}
