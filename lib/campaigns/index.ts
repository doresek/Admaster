// lib/campaigns — T2 public surface.
//
//   runCampaign(params, deps)  turn the living understanding → a full, recorded,
//                              dry-run campaign (never spends).
//   the state machine, the targeting/objective mapping, the store, and the
//   domain types.

export * from './types';
export {
  CAMPAIGN_STATUSES,
  DRY_RUN_PATH,
  canTransition,
  assertTransition,
  nextStates,
  isTerminal,
} from './state';
export {
  mapTargeting,
  mapObjective,
  mapGenders,
  mapPublisherPlatforms,
  ilsToAgorot,
} from './targeting-map';
export type { MappedTargeting, MappedObjective } from './targeting-map';
export {
  supabaseCampaignStore,
  inMemoryCampaignStore,
  type CampaignStore,
} from './store';
export {
  runCampaign,
  type RunCampaignParams,
  type RunCampaignDeps,
  type RunCampaignResult,
  type GenerateCreative,
  type GenerateRequest,
  type GeneratedCreative,
} from './runner';
export { masterStudioGenerator, type MasterStudioGeneratorOptions } from './generate';
export {
  decisionContextText,
  episodicRecaller,
  NO_PRECEDENTS,
  type PrecedentBlock,
  type RecallPrecedents,
} from './precedents';
export {
  publishCampaign,
  storedPlanResolver,
  isLivePublishEnabled,
  maxDailyBudget,
  LIVE_PUBLISH_FLAG,
  MAX_DAILY_BUDGET_FLAG,
  DEFAULT_MAX_DAILY_BUDGET,
  type PublishCampaignParams,
  type PublishCampaignDeps,
  type PublishResult,
  type PublishPlan,
  type PaidPublishPlan,
  type OrganicPublishPlan,
  type PublishRefusalReason,
  type PublishedObject,
} from './publish';
