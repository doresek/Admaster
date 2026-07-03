// lib/performance/ingest.ts
//
// PERFORMANCE INGESTION — the MEASURE step of the closed loop (T5, Phase B).
//
// Takes raw per-ad metric rows (Meta insights, or fixtures) and:
//   1. NORMALIZES the metrics into a stable shape
//      (impressions/clicks/ctr/reach/conversions/conversion_rate/cpa/roas/spend),
//      deriving ctr / conversion_rate / cpa when only the raw counts are present.
//   2. computes a VERDICT — 'worked' | 'underperformed' | 'failed' — against a
//      client/portfolio BASELINE (with documented default thresholds when no
//      baseline is supplied).
//   3. writes a `content_performance` row per ad keyed to
//      artifact_id / campaign_item_id / ad_id (migration 030).
//
// The service client is INJECTABLE and the persistence step is BEST-EFFORT:
// when the 030 tables are absent (or no admin is provided) ingestion still
// returns the normalized rows + verdicts; it just reports `persisted: 0`.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PerformanceMetrics } from '@/lib/decision-engine';

/** A measured outcome for one ad, relative to the baseline. */
export type Verdict = 'worked' | 'underperformed' | 'failed';

/** Raw, possibly-sparse metrics as they arrive from Meta / a fixture. */
export interface RawMetrics {
  impressions?:     number;
  clicks?:          number;
  ctr?:             number;
  reach?:           number;
  conversions?:     number;
  conversion_rate?: number;
  cpa?:             number;
  roas?:            number;
  spend?:           number;
  frequency?:       number;
  [k: string]:      unknown;
}

/** One raw input row (an ad's metrics + the keys that tie it to an artifact). */
export interface PerformanceInputRow {
  artifact_id?:      string | null;
  campaign_item_id?: string | null;
  ad_id?:            string | null;
  client_id:         string;
  owner_user_id:     string;
  source?:           'meta' | 'manual';
  metrics:           RawMetrics;
  period_start?:     string | null;
  period_end?:       string | null;
}

/**
 * Normalized metrics. A superset of the decision-engine `PerformanceMetrics`
 * (so a normalized row can be fed straight into `diagnoseFailure`) plus the
 * money ratios `cpa` / `roas` used for the verdict.
 */
export interface NormalizedMetrics extends PerformanceMetrics {
  cpa?:  number;
  roas?: number;
}

/** Optional client/portfolio baseline the verdict is measured against. */
export interface Baseline {
  target_roas?:            number;
  target_cpa?:             number;
  target_ctr?:             number;
  target_conversion_rate?: number;
}

/**
 * Verdict thresholds (documented, intentionally simple — tune once we have real
 * portfolio data).
 *   • MIN_IMPRESSIONS — below this we never call a hard 'failed' on the
 *     engagement path; the test simply hasn't had a fair chance → 'underperformed'.
 *   • HEALTHY_CTR / HEALTHY_CONVERSION_RATE — the absolute floors used when no
 *     baseline target is given (1% each — the standard "healthy" Meta floor).
 *   • WORKED_ROAS / FAILED_ROAS — absolute ROAS bands when no baseline target.
 *   • WORKED_RATIO / FAILED_RATIO — relative bands (×target) when a baseline IS
 *     given: at/above 120% of target = worked, below 80% = failed, between =
 *     underperformed.
 *   • CPA_FAILED_RATIO — CPA above 150% of the target CPA = failed.
 */
export const PERFORMANCE_THRESHOLDS = {
  MIN_IMPRESSIONS:         1000,
  HEALTHY_CTR:             0.01,
  HEALTHY_CONVERSION_RATE: 0.01,
  WORKED_ROAS:             1.5,
  FAILED_ROAS:             0.8,
  WORKED_RATIO:            1.2,
  FAILED_RATIO:            0.8,
  CPA_FAILED_RATIO:        1.5,
} as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const safeDiv = (a: number, b: number): number | undefined => (b > 0 ? a / b : undefined);

/**
 * Normalize a raw metrics bag: keep the values that arrived, and DERIVE the
 * ratios (ctr, conversion_rate, cpa) from the raw counts when they're missing.
 */
export function normalizeMetrics(m: RawMetrics): NormalizedMetrics {
  const impressions = isNum(m.impressions) ? m.impressions : undefined;
  const clicks      = isNum(m.clicks)      ? m.clicks      : undefined;
  const conversions = isNum(m.conversions) ? m.conversions : undefined;
  const reach       = isNum(m.reach)       ? m.reach       : undefined;
  const spend       = isNum(m.spend)       ? m.spend       : undefined;
  const frequency   = isNum(m.frequency)   ? m.frequency   : undefined;

  const ctr = isNum(m.ctr)
    ? m.ctr
    : impressions !== undefined && clicks !== undefined
      ? safeDiv(clicks, impressions)
      : undefined;

  const conversion_rate = isNum(m.conversion_rate)
    ? m.conversion_rate
    : clicks !== undefined && conversions !== undefined
      ? safeDiv(conversions, clicks)
      : undefined;

  const cpa = isNum(m.cpa)
    ? m.cpa
    : spend !== undefined && conversions !== undefined
      ? safeDiv(spend, conversions)
      : undefined;

  const roas = isNum(m.roas) ? m.roas : undefined;

  const out: NormalizedMetrics = {};
  if (impressions     !== undefined) out.impressions     = impressions;
  if (clicks          !== undefined) out.clicks          = clicks;
  if (ctr             !== undefined) out.ctr             = ctr;
  if (reach           !== undefined) out.reach           = reach;
  if (conversions     !== undefined) out.conversions     = conversions;
  if (conversion_rate !== undefined) out.conversion_rate = conversion_rate;
  if (cpa             !== undefined) out.cpa             = cpa;
  if (roas            !== undefined) out.roas            = roas;
  if (spend           !== undefined) out.spend           = spend;
  if (frequency       !== undefined) out.frequency       = frequency;
  return out;
}

/**
 * Compute the verdict for one ad. Precedence (clearest money signal first):
 *   1. ROAS, if present (relative to baseline target, else absolute bands).
 *   2. CPA vs a baseline target CPA (lower is better).
 *   3. The engagement funnel — CTR + conversion-rate vs the healthy floors
 *      (or the baseline targets when supplied).
 */
export function computeVerdict(m: NormalizedMetrics, baseline?: Baseline): Verdict {
  const T = PERFORMANCE_THRESHOLDS;
  const impressions = m.impressions ?? 0;

  // 1) ROAS-first.
  if (m.roas !== undefined) {
    const worked = baseline?.target_roas ? baseline.target_roas * T.WORKED_RATIO : T.WORKED_ROAS;
    const failed = baseline?.target_roas ? baseline.target_roas * T.FAILED_RATIO : T.FAILED_ROAS;
    if (m.roas >= worked) return 'worked';
    if (m.roas <  failed) return 'failed';
    return 'underperformed';
  }

  // 2) CPA vs a target.
  if (m.cpa !== undefined && baseline?.target_cpa) {
    if (m.cpa <= baseline.target_cpa) return 'worked';
    if (m.cpa >  baseline.target_cpa * T.CPA_FAILED_RATIO) return 'failed';
    return 'underperformed';
  }

  // 3) Engagement funnel.
  const ctrFloor  = baseline?.target_ctr ?? T.HEALTHY_CTR;
  const convFloor = baseline?.target_conversion_rate ?? T.HEALTHY_CONVERSION_RATE;
  const ctrOk  = m.ctr !== undefined && m.ctr >= ctrFloor;
  const ctrBad = m.ctr !== undefined && m.ctr <  ctrFloor;
  const convOk = m.conversion_rate !== undefined && m.conversion_rate >= convFloor;

  // Got a fair number of impressions but nobody clicked → a clear failure.
  if (ctrBad && impressions >= T.MIN_IMPRESSIONS) return 'failed';
  // Scroll stopped and they converted → worked.
  if (ctrOk && convOk) return 'worked';
  // Everything else (clicks fine but conversions soft, partial data, thin test)
  // is "underperformed" — the diagnosis step decides which link is to blame.
  return 'underperformed';
}

/** A normalized, verdict-stamped row ready to persist / diagnose. */
export interface IngestedRow {
  artifact_id:      string | null;
  campaign_item_id: string | null;
  ad_id:            string | null;
  client_id:        string;
  owner_user_id:    string;
  source:           'meta' | 'manual';
  metrics:          NormalizedMetrics;
  period_start:     string | null;
  period_end:       string | null;
  verdict:          Verdict;
}

export interface IngestDeps {
  /** Service-role client. Optional/mockable; when absent nothing is persisted. */
  admin?:    SupabaseClient | null;
  /** Lazy factory alternative to `admin` (so a missing env can't throw). */
  getAdmin?: () => SupabaseClient | null;
  /** Client/portfolio baseline the verdict is measured against. */
  baseline?: Baseline;
}

export interface IngestResult {
  /** The normalized, verdict-stamped rows (always returned, even unpersisted). */
  rows:      IngestedRow[];
  /** How many `content_performance` rows were successfully written. */
  persisted: number;
  /** false when the 030 table was absent / no admin / every insert errored. */
  persistedTable: boolean;
}

function resolveAdmin(deps: IngestDeps): SupabaseClient | null {
  if (deps.admin) return deps.admin;
  if (deps.getAdmin) {
    try { return deps.getAdmin(); } catch { return null; }
  }
  return null;
}

/**
 * Normalize + score + (best-effort) persist a batch of raw performance rows.
 * Never throws on a persistence failure — a missing 030 table just yields
 * `persisted: 0, persistedTable: false`.
 */
export async function ingestPerformance(
  input: PerformanceInputRow[],
  deps:  IngestDeps = {},
): Promise<IngestResult> {
  const rows: IngestedRow[] = (input ?? []).map((r) => {
    const metrics = normalizeMetrics(r.metrics ?? {});
    return {
      artifact_id:      r.artifact_id ?? null,
      campaign_item_id: r.campaign_item_id ?? null,
      ad_id:            r.ad_id ?? null,
      client_id:        r.client_id,
      owner_user_id:    r.owner_user_id,
      source:           r.source ?? 'meta',
      metrics,
      period_start:     r.period_start ?? null,
      period_end:       r.period_end ?? null,
      verdict:          computeVerdict(metrics, deps.baseline),
    };
  });

  const admin = resolveAdmin(deps);
  if (!admin || rows.length === 0) {
    return { rows, persisted: 0, persistedTable: false };
  }

  let persisted = 0;
  let tableOk = true;
  for (const row of rows) {
    try {
      const payload = {
        artifact_id:      row.artifact_id,
        campaign_item_id: row.campaign_item_id,
        client_id:        row.client_id,
        owner_user_id:    row.owner_user_id,
        source:           row.source,
        ad_id:            row.ad_id,
        metrics:          row.metrics,
        period_start:     row.period_start,
        period_end:       row.period_end,
        verdict:          row.verdict,
      };
      // IDEMPOTENT INGEST (C5): re-ingesting the same Meta window must not create
      // duplicate rows. Rows keyed by ad_id UPSERT on the migration-033 unique
      // index (client_id, ad_id, period_start, period_end) — a replay refreshes
      // the metrics/verdict in place. Manual rows (null ad_id) aren't covered by
      // that partial-uniqueness contract, so they stay plain inserts.
      const table = admin.from('content_performance');
      const { error } = row.ad_id
        ? await table.upsert(payload, { onConflict: 'client_id,ad_id,period_start,period_end' })
        : await table.insert(payload);
      if (error) {
        tableOk = false;
        console.error('[ingestPerformance] insert failed:', error.message);
        break; // table absent / schema mismatch — stop hammering it.
      }
      persisted++;
    } catch (e: any) {
      tableOk = false;
      console.error('[ingestPerformance] insert threw:', e?.message ?? e);
      break;
    }
  }

  return { rows, persisted, persistedTable: tableOk && persisted > 0 };
}
