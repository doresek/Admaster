// lib/decision-engine/index.ts
//
// T1 Decision Engine — the public surface. PURE: living client understanding
// (client_insights atoms + client_strategy) in → marketing decisions + failure
// diagnoses out. No DB / network / LLM in the core.
//
//   decide(input)          → MarketingDecision   (insight-driven plan)
//   diagnoseFailure(input) → Diagnosis           (which marketing LINK broke)

// ── types (the import contract for consumers) ──────────────────────────────────
export type {
  // re-exported atom + strategy shapes
  Insight,
  ClientInsight,
  StrategyAnalysis,
  // decision shapes
  Platform,
  FunnelStage,
  Genders,
  TargetingSpec,
  MarketingDecision,
  DecisionClientContext,
  DecideInput,
  // diagnosis shapes
  FailedLink,
  Diagnosis,
  DiagnosedArtifact,
  VariantMetrics,
  PerformanceMetrics,
  DiagnoseInput,
} from './types';

// ── core functions ──────────────────────────────────────────────────────────
export { decide, AWARENESS_TO_FUNNEL, resolvePlatform, resolveAwarenessKey } from './decide';
export type { DecisionRefiner } from './decide';
export { diagnoseFailure, DIAGNOSIS_THRESHOLDS } from './diagnose';

// ── tunables (exported so callers/tests can reference the same constants) ──────
export { deriveTargeting, TARGETING_DEFAULTS } from './audience';
export type { TargetingResult } from './audience';
export { recommendBudget, BUDGET } from './budget';
export type { BudgetResult } from './budget';
