// lib/competitor-watch — C-09 competitor watch (MARKETING-CAPABILITIES-SPEC
// §C-09; craft: .claude/skills/competitor-analysis). Public surface.

export * from './types';
export {
  FixtureFetcher,
  LiveAdLibraryFetcher,
  ManualPasteFetcher,
  MANUAL_PASTE_FORMAT_DOC,
  manualRef,
  parsePastedAds,
  type AdSourceFetcher,
} from './fetcher';
export {
  ANGLE_DECODE_PROMPT_HEADER,
  DECODE_BATCH_SIZE,
  buildDecodePrompt,
  createAnthropicLlm,
  decodeAngles,
  parseDecodeOutput,
  type DecodeItem,
  type LlmComplete,
} from './decode';
export {
  BURST_MIN_NEW_ADS,
  CHURN_MAX_LIFESPAN_DAYS,
  FRESH_MAX_AGE_DAYS,
  SUPPORTING_ATOM_MIN_CONFIDENCE,
  VETERAN_MIN_AGE_DAYS,
  buildCoverageMap,
  classifyAd,
  classifyAds,
  computeDelta,
  strategicFlags,
  type AdLongevityClass,
  type ClassifiedAds,
  type ComputeDeltaOptions,
} from './analyze';
export {
  COMPETITOR_AD_COLUMNS,
  COMPETITOR_ATOM_CONFIDENCE,
  COMPETITOR_ENTITY_COLUMNS,
  MAX_ACTIVE_ENTITIES,
  emitAtomActions,
  listAds,
  listEntities,
  setEntityActive,
  updateAdDecoded,
  upsertEntity,
  upsertObservedAds,
  type EmitAtomActionsInput,
  type EntityCapRejection,
  type SetEntityActiveResult,
  type UpsertAdsResult,
  type UpsertEntityInput,
  type UpsertEntityResult,
} from './store';
export { runWatch, type RunWatchOptions } from './run-watch';
