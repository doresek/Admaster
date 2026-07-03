// lib/autonomy — the autonomy modes (VISION-DEEP §1.4; D1 DECIDED: 3
// user-selectable modes, the system never self-promotes): the single gate
// every system action routes through. Pure policy in policy.ts, persistence
// in store.ts, composition in route-and-log.ts.

export type {
  AutonomyMode,
  AutonomyCaps,
  AutonomyAction,
  AutonomyRoute,
  ClientAutonomyRow,
  RouteContext,
  ModeSuggestion,
  ModeSuggestionAssessment,
} from './types';
export { AutonomyStoreError } from './types';

export {
  routeAction,
  assessModeSuggestion,
  DEFAULT_DAILY_SPEND_CAP_ILS,
  DEFAULT_MONTHLY_SPEND_CAP_ILS,
  DEFAULT_MAX_DAILY_DELTA_PCT,
  MAX_ACTIONS_PER_DAY,
  SUGGESTION_MIN_DAYS,
  SUGGESTION_MIN_APPROVALS,
  SUGGESTION_MIN_APPROVAL_RATE,
} from './policy';

export {
  AUTONOMY_COLUMNS,
  getOrCreateAutonomy,
  setMode,
  recordModeSuggestion,
  recordProposal,
  recordApprovalOutcome,
  logRouteEvent,
  countTodayActions,
  type SetModeInput,
  type RecordModeSuggestionInput,
  type RecordProposalInput,
  type RecordApprovalOutcomeInput,
  type LogRouteEventInput,
} from './store';

export {
  routeAndLog,
  type RouteAndLogInput,
  type RouteAndLogResult,
} from './route-and-log';
