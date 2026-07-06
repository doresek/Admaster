// lib/organic-perf — P1-7 organic performance ingestion (barrel).
//
// Published page posts → content_performance rows → deterministic verdicts.
// Graph fetcher ready for live; manual path works today (dry-run era).

export {
  ingestOrganicPerformance,
  isDryRunPostId,
  measurementDay,
  toPerfMetrics,
  DRY_RUN_POST_ID_PREFIX,
  type IngestOrganicPerformanceParams,
} from './ingest';

export {
  ingestManualMetrics,
  validateManualMetrics,
  type ManualMetricsInput,
  type IngestManualMetricsParams,
  type ManualIngestResult,
} from './manual';

export {
  computeOrganicVerdict,
  organicEngagementRate,
  ORGANIC_WORKED_MIN_ER,
  ORGANIC_UNDERPERFORMED_MIN_ER,
  ORGANIC_MIN_REACH_FOR_VERDICT,
} from './verdict';

export { graphMetricsFetcher, type GraphMetricsFetcherOptions } from './graph';

export {
  supabasePublishedSlotSource,
  supabasePerfStore,
  supabaseItemLookup,
  inMemoryPerfStore,
} from './store';

export type {
  OrganicPostMetrics,
  OrganicPerfMetrics,
  OrganicVerdict,
  OrganicPerfRow,
  PostMetricsFetcher,
  SlotSource,
  PerfStore,
  ItemLookup,
  OrganicIngestDeps,
  OrganicIngestSummary,
} from './types';
