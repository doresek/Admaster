// lib/hypotheses — C-01 pre-registration + kill rules (the hypothesis ledger).
//
// Public API surface. Consumers (decision engine, campaign runner, heartbeat,
// API routes) import from here; the internal layering is:
//   core.ts              pure discipline (validation, floors, verdicts, kills)
//   store.ts             owner-scoped persistence over the `hypotheses` table
//   resolve-and-learn.ts composition — verdicts → learning_signals → lifecycle

export {
  armFloorProgress,
  checkKillRules,
  evaluatePrediction,
  floorMet,
  resolve,
  validateRegistration,
} from './core';

export {
  getHypothesis,
  listHypotheses,
  registerHypothesis,
  resolveHypothesis,
  supersedeHypothesis,
  type ListHypothesesFilters,
  type ResolveHypothesisPatch,
  type SupersedeResult,
} from './store';

export {
  findPriorResolutions,
  registerHypothesisChecked,
  resolveAndLearn,
  type ResolveAndLearnOptions,
} from './resolve-and-learn';

export {
  CAMPAIGN_ARM,
  DEFAULT_DECISION_CONFIDENCE,
  DEFAULT_METRIC_FLOOR,
  REFUTED_WEIGHT,
  SUPPORTED_WEIGHT,
  hypothesisFromDecision,
  metricForObjective,
  type HypothesisFromDecisionParams,
} from './from-decision';

export * from './types';
