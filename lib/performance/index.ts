// lib/performance/index.ts
//
// Public surface for performance ingestion (the MEASURE step of the loop).
export {
  ingestPerformance,
  normalizeMetrics,
  computeVerdict,
  PERFORMANCE_THRESHOLDS,
} from './ingest';
export type {
  Verdict,
  RawMetrics,
  PerformanceInputRow,
  NormalizedMetrics,
  Baseline,
  IngestedRow,
  IngestDeps,
  IngestResult,
} from './ingest';
