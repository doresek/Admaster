// lib/episodic — C-02 episodic memory retrieval (MARKETING-CAPABILITIES-SPEC).
//
// Public surface. Consumers (decision-engine wire-in, backfill, heartbeat)
// import from here; the shared row/contract shapes come from
// '@/lib/capability-contracts'.
export {
  composeFromDiagnosis,
  composeFromHypothesis,
  outcomeOf,
  abstractEpisode,
  EpisodeCompositionError,
  RESOLVED_HYPOTHESIS_STATUSES,
  type DiagnosisComposeContext,
} from './compose';

export {
  GoogleEmbedder,
  DeterministicEmbedder,
  defaultEmbedder,
} from './embedder';

export {
  upsertEpisode,
  upsertEpisodes,
  recallSimilar,
  precedentSummary,
  type UpsertEpisodeInput,
} from './store';

export { ingestForClient } from './ingest';

export {
  DIAGNOSIS_SOURCE_COLUMNS,
  HYPOTHESIS_SOURCE_COLUMNS,
  type AbstractionOptions,
  type ComposedEpisode,
  type DiagnosisFailedLink,
  type DiagnosisSourceRow,
  type EpisodeSource,
  type HypothesisEpisodeSource,
  type IngestCounts,
  type RecallQuery,
  type RecallResult,
  type RecallScope,
  type RecalledPrecedent,
} from './types';
