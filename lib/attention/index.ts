// lib/attention — C-06 attention scheduler (public surface).
//
// Rigor allocated by INFORMATION VALUE, not revenue (§8.2.2): rank clients per
// tick by where attention buys the most — anomalies, open-hypothesis value,
// atom staleness, calendar proximity, pipeline errors. Tiers cap frequency,
// never rigor.
//
// Typical heartbeat usage:
//   const states = await loadStatesForOwner(db, ownerUserId);
//   const ranked = rankClients(states, { topKDetail: 10 });

export type {
  AnomalyFlag,
  AttentionComponent,
  AttentionComponents,
  AttentionScore,
  AttentionWeights,
  CalendarProximity,
  ClientAttentionState,
  ErrorFlag,
  ErrorKind,
  FlagSeverity,
  OpenHypothesisProgress,
  StalenessState,
} from './types';

export {
  ANOMALY_DECAY_HOURS,
  ANOMALY_SATURATION_K,
  ANOMALY_SEVERITY_BASE,
  CALENDAR_LATE_DECAY_DAYS,
  CALENDAR_RAMP_DAYS,
  DEFAULT_CADENCE_DAYS,
  DEFAULT_WEIGHTS,
  ERROR_KIND_URGENCY,
  ERROR_SEVERITY_URGENCY,
  HYPOTHESIS_PEAK_PROGRESS,
  HYPOTHESIS_PEAK_SIGMA,
  HYPOTHESIS_SATURATION_K,
  STALENESS_SATURATION_K,
  hypothesisProgressBump,
  rankClients,
  scoreAnomalies,
  scoreAttention,
  scoreCalendar,
  scoreErrors,
  scoreHypothesisValue,
  scoreStaleness,
} from './score';
export type { RankClientsOpts } from './score';

export {
  ACTIVE_CAMPAIGN_STATUSES,
  DOMAIN_DECISION_MULTIPLIER,
  loadClientState,
  loadStatesForOwner,
  parseSeasonalityAtom,
  toAttentionDb,
} from './load';
export type {
  AttentionDb,
  AttentionQueryResult,
  AttentionSelectBuilder,
  AttentionTable,
  LoadStateOpts,
} from './load';
