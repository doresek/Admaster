// lib/fleet — C-04 exogenous-shock detection ("שוק, לא אתה").
//
// Detects market-level events — CPM spikes, engagement collapse hitting many
// clients at once (chag, war news cycle, platform change) — so that diagnoses
// are suppressed/reframed during shock windows and atoms are protected from
// false weakening (MARKETING-CAPABILITIES-SPEC §C-04, VISION-DEEP §8.2.5).
//
// ── NO API ROUTE, ON PURPOSE ──────────────────────────────────────────────────
// Fleet data is NEVER tenant-visible: fleet_daily_factors is RLS-on with zero
// policies (service-role only), and this module's ingest performs the one
// sanctioned cross-tenant read in the codebase (see ingest.ts header). There
// is therefore no app/api surface over lib/fleet — the heartbeat/cron calls
// computeDailyFactors server-side with the admin client, and server-side
// consumers (diagnosis engine, verdict normalization, the national-mood
// trigger) call getShockState the same way. Do not add a route.
//
// Public surface:
//  - computeDailyFactors(admin, {date})      — the daily job (ingest→compute→upsert)
//  - getShockState(admin, date, metric)      — the consumer question, total on absence
//  - listRecentFactors(admin, {since})       — ops/heartbeat summaries
//  - the pure math (median/mad/relDeltas/computeFactor) and the calendar
//    overlay, exported for consumers and tests — all deterministic, no I/O.

export {
  computeFactor,
  mad,
  median,
  relDeltas,
  DEFAULT_DELTA_THRESHOLD,
  DEFAULT_DIRECTION_QUORUM,
  DEFAULT_MIN_SAMPLE,
  type ComputeFactorOptions,
} from './compute';

export { expectedShock, windowMatchesShock, ISRAELI_MARKET_WINDOWS } from './calendar';

export { assembleClientDayMetrics, extractFleetMetrics, isoDayBefore } from './ingest';

export { getShockState, listRecentFactors, upsertFactors, FLEET_FACTOR_COLUMNS } from './store';

export { computeDailyFactors, type ComputeDailyFactorsOptions } from './run-daily';

export {
  FLEET_METRICS,
  FleetIngestError,
  FleetStoreError,
  type AssembledClientDays,
  type CalendarWindow,
  type ClientDayMetric,
  type DailyDelta,
  type DailyFactorsSummary,
  type ExpectedShockKind,
  type FactorComputation,
  type FleetFactorUpsert,
  type FleetMetric,
} from './types';
