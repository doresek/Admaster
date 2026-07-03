// lib/autonomy — the autonomy ladder (VISION-DEEP §1.4): the single gate every
// system action routes through. Pure policy in policy.ts, persistence in
// store.ts, composition in route-and-log.ts.

export type {
  AutonomyLevel,
  AutonomyCaps,
  AutonomyAction,
  AutonomyRoute,
  ClientAutonomyRow,
  RouteContext,
  GraduationAssessment,
  GraduationProposal,
} from './types';
export { AutonomyStoreError } from './types';

export {
  routeAction,
  assessGraduation,
  DEFAULT_DAILY_SPEND_CAP_ILS,
  DEFAULT_MONTHLY_SPEND_CAP_ILS,
  DEFAULT_MAX_DAILY_DELTA_PCT,
  MAX_ACTIONS_PER_DAY,
  GRADUATION_MIN_DAYS,
  GRADUATION_MIN_APPROVALS,
  GRADUATION_MIN_APPROVAL_RATE,
} from './policy';

export {
  AUTONOMY_COLUMNS,
  getOrCreateAutonomy,
  setLevel,
  recordProposal,
  recordApprovalOutcome,
  logRouteEvent,
  countTodayActions,
  type SetLevelInput,
  type RecordProposalInput,
  type RecordApprovalOutcomeInput,
  type LogRouteEventInput,
} from './store';

export {
  routeAndLog,
  type RouteAndLogInput,
  type RouteAndLogResult,
} from './route-and-log';
