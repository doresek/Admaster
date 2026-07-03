// lib/experiments — C-11 experiment portfolio manager (information per shekel).
//
// Public API surface. Consumers (weekly heartbeat → planSlate, runner →
// allocateArms, resolution paths → pooledEvidence) import from here; the
// internal layering is:
//   types.ts       shared planning vocabulary
//   info-value.ts  pure candidate scoring (decision weight × belief movement ÷ cost)
//   maturity.ts    pure brain-maturity → explore share (skill §5)
//   plan-slate.ts  pure slate design under the budget's information capacity (§3)
//   allocate.ts    pure deterministic Thompson-style daily arm allocation (§4/§5)
//   pooling.ts     pure atom-graph evidence pooling — readiness flags only (§3)
//   load.ts        the only I/O: candidates + atoms via the C-01/intelligence layers
//
// All C-01 discipline (registration validation, floors, verdicts, kills) is
// IMPORTED from lib/hypotheses, never reimplemented.

export {
  DOMAIN_DECISION_MULTIPLIER,
  beliefMovement,
  costToFloor,
  decisionWeight,
  infoValue,
  type CostToFloorResult,
  type InfoValueResult,
} from './info-value';

export {
  EXPLORE_SHARE,
  MATURE_BRIDGE_CONFIDENCE,
  assessMaturity,
} from './maturity';

export {
  DEFAULT_SLATE_HORIZON_DAYS,
  planSlate,
  type PlanSlateInput,
} from './plan-slate';

export {
  allocateArms,
  type AllocateArmsOptions,
} from './allocate';

export { pooledEvidence } from './pooling';

export {
  CONTESTED_BAND,
  DEFAULT_ARM_COUNT,
  classifyCandidateKind,
  loadOpenCandidates,
  type LoadedCandidates,
} from './load';

export * from './types';
