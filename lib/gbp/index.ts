// lib/gbp/index.ts — public surface of the GBP manual-assist engine
// (P1-GBP-1 completeness audit + P1-GBP-4 NAP/citations checklist).

export {
  auditCompleteness,
  buildGbpDescription,
  coerceProfileState,
  emptyProfileState,
  gbpDeepLink,
  normalizeBizName,
  suggestServicesFromAtoms,
  GBP_DAY_KEYS,
  GBP_DAY_LABELS_HE,
  GBP_DESCRIPTION_MAX,
  GBP_FIELD_WEIGHTS,
  HOLIDAY_LOOKAHEAD_DAYS,
  type AuditOptions,
  type GbpAudit,
  type GbpAuditItem,
  type GbpDayHours,
  type GbpDayKey,
  type GbpField,
  type GbpFieldStatus,
  type GbpProfileState,
  type GbpWeekHours,
} from './completeness';

export {
  checkNapConsistency,
  directoryById,
  normalizeAddress,
  normalizeNapText,
  normalizePhoneIL,
  IL_DIRECTORIES,
  type CanonicalNap,
  type DirectoryDef,
  type DirectoryId,
  type NapDeviation,
  type NapDirectoryResult,
  type NapDirectoryStatus,
  type NapField,
  type NapListing,
  type NapReport,
} from './citations';
