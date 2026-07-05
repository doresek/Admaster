// lib/measurement — MEASUREMENT CORE public surface.
//
// L0 identity capture (capture.ts, pure) + the canonical lead registry &
// stage/learning bridge (leads.ts) + platform-vs-CRM reconciliation
// (reconciliation.ts). See docs/MEASUREMENT-SPINE-PLAN.md.

export {
  EMPTY_IDENTITY,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_S,
  MAX_CAPTURED_LEN,
  UTM_KEYS,
  buildTouchpoint,
  hasAnySignal,
  mergeIdentity,
  parseClickIds,
  parseFirstTouchCookie,
  sanitizeClickId,
  sanitizeLandingPath,
  sanitizeReferrer,
  sanitizeUtmValue,
  serializeFirstTouch,
  type BuildTouchpointInput,
  type CapturedIdentity,
  type ParseClickIdsInput,
  type TouchpointInsert,
  type UtmKey,
} from './capture';

export {
  DEDUPE_WINDOW_DAYS,
  FUNNEL_LEAD_COLUMNS,
  LEGAL_TRANSITIONS,
  LIST_LEADS_DEFAULT_LIMIT,
  LIST_LEADS_MAX_LIMIT,
  SALES_OUTCOME_SIGNAL_TYPE,
  SALES_OUTCOME_WEIGHTS,
  STAGE_EVENT_COLUMNS,
  TOUCHPOINT_COLUMNS,
  createLeadFromLanding,
  isLegalTransition,
  listLeads,
  markStage,
  normalizeEmail,
  normalizePhone,
  type CreateLeadFromLandingInput,
  type CreateLeadFromLandingResult,
  type ListLeadsOptions,
  type MarkStageInput,
  type MarkStageResult,
  type SalesOutcomeMove,
  type SalesOutcomeReport,
} from './leads';

export {
  RECONCILIATION_THRESHOLDS,
  computeReconciliation,
  mapChannel,
  runReconciliation,
  upsertReconciliation,
  type ChannelSignal,
  type ReconciliationChannel,
  type ReconciliationComputation,
  type ReconciliationPeriod,
  type ReconciliationVerdict,
  type RunReconciliationInput,
  type RunReconciliationResult,
  type UpsertReconciliationInput,
} from './reconciliation';
