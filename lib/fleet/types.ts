// lib/fleet/types.ts — internal types for C-04 exogenous-shock detection.
//
// The fleet module answers ONE question: "did the MARKET move, or did this
// client's marketing get worse?" (VISION-DEEP §8.2.5 — "שוק, לא אתה"). Its
// row contract (FleetFactorRow, ShockState) lives in lib/capability-contracts
// and is imported, never redefined; everything here is the module's internal
// vocabulary for getting from raw content_performance rows to those contracts.

import type { FleetFactorRow } from '@/lib/capability-contracts';

// ── metrics ───────────────────────────────────────────────────────────────────

/**
 * The metrics the fleet factor tracks, matching migration 043's comment
 * (cpm | ctr | cvr | spend). Order here is the order run-daily computes and
 * persists them — stable output makes the daily job's summaries diffable.
 */
export const FLEET_METRICS = ['cpm', 'ctr', 'cvr', 'spend'] as const;
export type FleetMetric = (typeof FLEET_METRICS)[number];

/** One client's aggregated value for one metric on one day. */
export interface ClientDayMetric {
  client_id: string;
  date:      string;       // ISO YYYY-MM-DD
  metric:    FleetMetric;
  value:     number;       // always finite and >= 0 (ingest guarantees it)
}

/**
 * One client's day-over-day relative movement for one metric:
 * (today − prev) / prev. Produced only when both days exist and prev > 0,
 * so rel_delta is always finite — compute.relDeltas enforces this.
 */
export interface DailyDelta {
  client_id: string;
  metric:    FleetMetric;
  rel_delta: number;
}

/**
 * The pure result of computeFactor for one (date, metric) — FleetFactorRow
 * minus the persistence fields (id, date, platform, created_at). Kept separate
 * so the math layer never knows about storage.
 */
export interface FactorComputation {
  metric:       FleetMetric;
  median_delta: number | null;   // null only when sample_n === 0
  mad:          number | null;   // null only when sample_n === 0
  sample_n:     number;
  shocked:      boolean;
  direction:    'up' | 'down' | null;
  note:         string | null;
}

/** The insert/upsert shape for fleet_daily_factors (DB generates id/created_at). */
export type FleetFactorUpsert = Omit<FleetFactorRow, 'id' | 'created_at'>;

// ── calendar overlay ─────────────────────────────────────────────────────────

/**
 * What kind of market movement a calendar window is EXPECTED to produce
 * (israeli-market-timing skill §2):
 *  - 'cpm_up'         — auction crowding (chag scrambles, Black Friday): CPM/spend rise
 *  - 'attention_down' — national mood suppresses commercial attention
 *                       (memorial days): CTR/CVR fall
 *  - 'mixed'          — the window moves different verticals in different
 *                       directions (chanuka, the big summer vacation), so any
 *                       fleet-level shock inside it is plausibly calendar-driven
 */
export type ExpectedShockKind = 'cpm_up' | 'attention_down' | 'mixed';

/**
 * One known Israeli market window, encoded as Gregorian month-day bounds
 * (inclusive). See calendar.ts for the honesty note about Hebrew-calendar
 * drift and why the windows are deliberately wide.
 */
export interface CalendarWindow {
  label:           string;             // Hebrew label surfaced in factor notes
  month_day_start: string;             // 'MM-DD', inclusive
  month_day_end:   string;             // 'MM-DD', inclusive (never crosses Dec 31 → Jan)
  expected:        ExpectedShockKind;
  note:            string;             // the marketing story (for humans reading the data)
}

// ── ingest output ─────────────────────────────────────────────────────────────

/** What ingest.assembleClientDayMetrics hands to the math layer. */
export interface AssembledClientDays {
  date:         string;             // the day being factored
  prev_date:    string;             // date − 1 (UTC arithmetic)
  today:        ClientDayMetric[];  // one entry per (client, metric) with data on `date`
  prev:         ClientDayMetric[];  // same for `prev_date`
  skipped_rows: number;             // rows whose metrics jsonb yielded nothing usable
  rows_scanned: number;             // total content_performance rows read (both days)
}

// ── run-daily output ──────────────────────────────────────────────────────────

/** Summary the daily composition returns to its (server-side) caller. */
export interface DailyFactorsSummary {
  date:         string;
  platform:     string;
  factors:      FleetFactorRow[];   // one persisted row per FLEET_METRICS entry
  skipped_rows: number;
  note:         string;             // human-readable one-liner for job logs
}

// ── typed errors ──────────────────────────────────────────────────────────────

/** Ingest-phase failure (bad input date, content_performance read error). */
export class FleetIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FleetIngestError';
  }
}

/** Store-phase failure (fleet_daily_factors read/write error). */
export class FleetStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FleetStoreError';
  }
}
