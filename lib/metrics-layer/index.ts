// lib/metrics-layer — public surface of the KPI metrics layer (D-0).
//
// DASHBOARD-ARCHITECTURE §0.1: the semantic metrics layer is THE single source
// of truth for every number a dashboard, narration, alert or digest shows.
// Consumers: tiles, lib/narration, alerts. Flow:
//   loadMetricInputs(supabase, …) → computeMetrics(METRIC_REGISTRY, inputs) →
//   MetricValue[] (each with prev/goal/benchmark attached — never naked).

export { METRIC_REGISTRY, metricDef } from './registry';
export { computeMetrics, periodDaysInclusive } from './compute';
export { loadMetricInputs, previousPeriod } from './load';
export type { LoadMetricParams, LoadMetricResult } from './load';
export type {
  FormulaContext,
  MetricCampaignRow,
  MetricComparison,
  MetricDef,
  MetricDirection,
  MetricGoalMap,
  MetricGrain,
  MetricInputs,
  MetricKey,
  MetricPeriod,
  MetricResult,
  MetricUnit,
  MetricValue,
  PeriodSlice,
} from './types';
