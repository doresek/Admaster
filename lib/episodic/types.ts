// lib/episodic/types.ts
//
// MODULE-INTERNAL types for C-02 episodic memory (MARKETING-CAPABILITIES-SPEC
// C-02). The cross-capability shapes (EpisodeRow, EpisodeMatch, Embedder,
// EMBEDDING_DIMS, HypothesisRow) live in lib/capability-contracts and are
// imported — never redefined — here. This file adds only what the episodic
// module needs privately: the source-row shapes episodes are composed FROM,
// the recall query/result shapes, ingest counters, and the tiny runtime
// guards used to validate rows coming back from PostgREST without casts.
import type {
  EpisodeMatch,
  EpisodeOutcome,
  EpisodeSourceKind,
  HypothesisRow,
} from '@/lib/capability-contracts';

// ── Episode sources ───────────────────────────────────────────────────────────

/**
 * The failed-link vocabulary of the diagnoses table (migration 030 CHECK).
 * Mirrored locally (not imported from lib/decision-engine) so the episodic
 * module depends only on the DB contract, not on another capability's module.
 */
export type DiagnosisFailedLink =
  | 'hook' | 'avatar' | 'creative' | 'funnel' | 'offer' | 'audience' | 'none';

/** A diagnoses row (mirrors migration 030, snake_case = DB columns 1:1). */
export interface DiagnosisSourceRow {
  id:                 string;
  client_id:          string;
  owner_user_id:      string;
  scope_artifact_id:  string | null;
  scope_campaign_id:  string | null;
  scope_item_id:      string | null;
  failed_link:        DiagnosisFailedLink;
  rationale:          string;
  evidence:           Record<string, unknown> | null;
  target_insight_ids: string[];
  recommended_action: Record<string, unknown> | null;
  applied:            boolean;
  applied_item_id:    string | null;
  created_at:         string;
}

export const DIAGNOSIS_SOURCE_COLUMNS =
  'id, client_id, owner_user_id, scope_artifact_id, scope_campaign_id, scope_item_id, ' +
  'failed_link, rationale, evidence, target_insight_ids, recommended_action, ' +
  'applied, applied_item_id, created_at';

/**
 * The subset of a hypotheses row episode composition actually reads. A full
 * HypothesisRow satisfies this structurally, and ingest can select only these
 * columns (lighter query than HYPOTHESIS_COLUMNS).
 */
export type HypothesisEpisodeSource = Pick<
  HypothesisRow,
  | 'id' | 'client_id' | 'owner_user_id' | 'claim' | 'prediction' | 'domain'
  | 'status' | 'resolution' | 'insight_ids' | 'resolved_at'
>;

export const HYPOTHESIS_SOURCE_COLUMNS =
  'id, client_id, owner_user_id, claim, prediction, domain, status, resolution, ' +
  'insight_ids, resolved_at';

/** A discriminated source union — the input to outcomeOf and the composers. */
export type EpisodeSource =
  | { kind: 'hypothesis'; row: HypothesisEpisodeSource }
  | { kind: 'diagnosis';  row: DiagnosisSourceRow };

/**
 * A composed-but-not-yet-embedded episode. `abstracted_text` is added by the
 * caller (abstraction needs the client name, which composition does not know).
 */
export interface ComposedEpisode {
  source_kind:  EpisodeSourceKind;
  source_id:    string;
  episode_text: string;
  outcome:      EpisodeOutcome;
  insight_ids:  string[];
  metadata:     Record<string, unknown>;
}

// ── Abstraction ───────────────────────────────────────────────────────────────

export interface AbstractionOptions {
  /** The client's display name — stripped everywhere (Hebrew-aware). */
  clientName?:    string | null;
  /** Extra business-identifying terms (brand names, addresses) to redact. */
  businessTerms?: string[];
}

// ── Recall ────────────────────────────────────────────────────────────────────

export type RecallScope = 'client' | 'fleet';

export interface RecallQuery {
  clientId:    string;
  /** The current situation, rendered as text — embedded and matched by cosine. */
  contextText: string;
  scope?:      RecallScope;
  k?:          number;
}

/** A match plus its one-line, prompt-injectable precedent summary. */
export interface RecalledPrecedent extends EpisodeMatch {
  precedent_summary: string;
}

export interface RecallResult {
  scope:   RecallScope;
  k:       number;
  matches: RecalledPrecedent[];
}

// ── Ingest ────────────────────────────────────────────────────────────────────

export interface IngestCounts {
  /** Source rows successfully rendered into episode text. */
  composed:         number;
  /** Vectors produced (== composed; one batched embedder call). */
  embedded:         number;
  /** Rows written (upsert is idempotent on (source_kind, source_id)). */
  upserted:         number;
  /** Source rows skipped because an episode already exists for them. */
  skippedExisting:  number;
  /** Source rows skipped because composition rejected them (logged, never silent). */
  skippedMalformed: number;
}

// ── Runtime guards (PostgREST rows arrive as unknown; no `as` casts) ─────────

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

export function isEpisodeSourceKind(v: unknown): v is EpisodeSourceKind {
  return v === 'hypothesis' || v === 'diagnosis' || v === 'campaign_item' || v === 'artifact';
}

export function isEpisodeOutcome(v: unknown): v is EpisodeOutcome {
  return v === 'win' || v === 'loss' || v === 'mixed' || v === 'inconclusive' || v === 'unknown';
}

export function isDiagnosisFailedLink(v: unknown): v is DiagnosisFailedLink {
  return v === 'hook' || v === 'avatar' || v === 'creative' || v === 'funnel'
      || v === 'offer' || v === 'audience' || v === 'none';
}
