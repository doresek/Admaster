// lib/retention/index.ts — public surface of the retention engine core (CP-6b).
//
// The compliance gate (gate.ts) is the single chokepoint: sender.ts is the
// ONLY module here that touches a provider, and only behind an `allowed`
// verdict. There is deliberately NO raw-send export.

export * from './types';
export {
  DEFAULT_RETENTION_POLICY,
  resolvePolicy,
  parseHHMM,
  type RetentionPolicy,
} from './policy';
export {
  ilWallClock,
  ilToUtc,
  addDaysISO,
  isShabbatWindow,
  shabbatWindowEnd,
  isChagWindow,
  activeChagSpan,
  buildChagSpans,
  isQuietHours,
  nextAllowedSendTime,
  holidayHorizonWarning,
  HOLIDAY_HORIZON_ISO,
  type ChagSpan,
  type ILWallClock,
} from './quiet-windows';
export {
  checkDailyCap,
  checkMinGap,
  checkWeeklyCap,
  checkMonthlyCap,
  checkPromoDuplicate,
  checkOfferDensity,
  checkClientDailyCap,
  permittedChannels,
  resolveChannel,
  isDeferral,
  type ChannelResolution,
} from './invariants';
export { checkSendAllowed, buildRefusedTouch, type GateInput } from './gate';
export { createMockAdapter, defaultAdapters } from './adapters';
export {
  sendSeriesTouch,
  type SendSeriesTouchInput,
  type SendSeriesTouchDeps,
  type SendSeriesTouchResult,
} from './sender';
export { createSupabaseRetentionStore, countClientSentBetween } from './store';
export {
  normalizeContactInput,
  normalizePhone,
  normalizeEmail,
  parseCsv,
  planImport,
  type NormalizedContact,
  type NormalizeResult,
  type RawContactInput,
  type ImportRowResult,
  type ExistingContactKey,
} from './contacts';
