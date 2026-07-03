// lib/capability-contracts — SHARED CONTRACTS for the marketing capabilities
// (MARKETING-CAPABILITIES-SPEC C-01..C-14).
//
// This module is owned by the ORCHESTRATOR and is the single source of truth
// for the row shapes of the capability tables (migrations 034–037) and the
// small cross-capability interfaces (Embedder). Capability modules IMPORT from
// here and never edit this file — the same collision-avoidance doctrine as the
// masterplan's disjoint-folder rule.
//
// Design notes:
//  • Types mirror the DB columns 1:1 (snake_case), like lib/intelligence/types.
//  • The string unions below are the SAME strings the DB CHECK constraints
//    enforce — change one, change both (in a new migration).
//  • Cross-capability logic composes through these rows + the existing
//    lifecycle engine (lib/intelligence), never through private imports
//    between capability folders.

// ── C-01 hypotheses ───────────────────────────────────────────────────────────

export type HypothesisStatus =
  | 'open' | 'supported' | 'refuted' | 'inconclusive' | 'killed' | 'superseded';

/** Calibration domain — which judgment family the prediction belongs to (C-03). */
export type HypothesisDomain =
  | 'angle' | 'audience' | 'offer' | 'creative' | 'funnel' | 'timing' | 'channel' | 'other';

/** Comparators a pre-registered prediction may use. */
export type PredictionComparator = 'gte' | 'lte' | 'ratio_gte' | 'ratio_lte';

/**
 * The FROZEN prediction. `confidence` is the registrant's belief the claim is
 * true, in [0..1] — this is what calibration (C-03) scores against outcomes.
 * ratio_* comparators compare arm/baseline_arm; plain comparators compare the
 * arm's metric against `value`.
 */
export interface Prediction {
  metric:        string;              // 'ctr' | 'cvr' | 'cpa' | 'lead_quality' | ...
  comparator:    PredictionComparator;
  value:         number;              // threshold or ratio (e.g. 1.3 = "≥1.3×")
  arm:           string;              // the arm the claim is about
  baseline_arm?: string;              // required for ratio_* comparators
  confidence:    number;              // registrant belief in [0..1]
}

/** Sample floors per arm before ANY verdict (creative-testing-discipline §3). */
export interface FloorSpec {
  metric_grade: 'ctr' | 'cvr' | 'cpa' | 'lead_quality';
  per_arm: {
    impressions?: number;
    clicks?:      number;
    conversions?: number;
    marked_leads?: number;
  };
}

export interface Horizon {
  max_days?:  number;
  max_spend?: number;                 // account currency (ILS)
}

/** One atom movement a verdict triggers (flows through the lifecycle engine). */
export interface VerdictAtomMove {
  insight_id: string;
  polarity:   'positive' | 'negative';
  weight:     number;                 // [0..1]; experiment evidence is strong (~0.5–0.7)
}

/** FROZEN at registration: which atoms move on each verdict. */
export interface VerdictMap {
  supported:    VerdictAtomMove[];
  refuted:      VerdictAtomMove[];
  inconclusive: VerdictAtomMove[];    // conventionally [] — floors unmet move nothing
}

export interface KillRules {
  /** Kill an arm at ≥ mercy.min_floor_multiple× floor with < mercy.max_fraction_of_leader performance. */
  mercy?:        { min_floor_multiple: number; max_fraction_of_leader: number };
  /** Kill on spend ≥ multiple × expected cost-per-result with zero results. */
  catastrophic?: { spend_multiple: number; expected_cost_per_result: number };
}

export interface TestRef {
  arm_label:         string;
  campaign_item_id?: string;
}

export interface HypothesisResolution {
  observed:       Record<string, unknown>;   // per-arm observed metrics at resolution
  verdict_reason: string;
  resolved_by:    'floor_met' | 'horizon_forced' | 'killed_mercy' | 'killed_catastrophic' | 'manual';
  brier?:         number;                    // stamped by calibration (C-03)
}

/** A hypotheses row (mirrors migration 034). */
export interface HypothesisRow {
  id:             string;
  client_id:      string;
  owner_user_id:  string;
  insight_ids:    string[];
  claim:          string;
  prediction:     Prediction;
  floor_spec:     FloorSpec;
  horizon:        Horizon;
  verdict_map:    VerdictMap;
  kill_rules:     KillRules;
  test_refs:      TestRef[];
  domain:         HypothesisDomain;
  status:         HypothesisStatus;
  resolution:     HypothesisResolution | null;
  registered_at:  string;
  resolved_at:    string | null;
  superseded_by:  string | null;
  created_at:     string;
  updated_at:     string;
}

export const HYPOTHESIS_COLUMNS =
  'id, client_id, owner_user_id, insight_ids, claim, prediction, floor_spec, horizon, ' +
  'verdict_map, kill_rules, test_refs, domain, status, resolution, registered_at, ' +
  'resolved_at, superseded_by, created_at, updated_at';

// ── C-02 episodic memory ──────────────────────────────────────────────────────

/** Embedding dimension — pinned to the 035 migration's vector(768). */
export const EMBEDDING_DIMS = 768;

export type EpisodeSourceKind = 'hypothesis' | 'diagnosis' | 'campaign_item' | 'artifact';
export type EpisodeOutcome    = 'win' | 'loss' | 'mixed' | 'inconclusive' | 'unknown';

/**
 * The embedding provider seam. Runtime uses a real provider (Google
 * text-embedding-004); tests use a deterministic stub. Implementations MUST
 * return exactly EMBEDDING_DIMS numbers per input.
 */
export interface Embedder {
  /** Stable identifier persisted in episode metadata (e.g. 'text-embedding-004'). */
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** An episode_embeddings row (mirrors migration 035; embedding omitted on reads). */
export interface EpisodeRow {
  id:              string;
  client_id:       string;
  owner_user_id:   string;
  source_kind:     EpisodeSourceKind;
  source_id:       string;
  episode_text:    string;
  abstracted_text: string | null;
  outcome:         EpisodeOutcome;
  insight_ids:     string[];
  metadata:        Record<string, unknown>;
  created_at:      string;
}

/** A match_episodes RPC result row. */
export interface EpisodeMatch {
  id:          string;
  source_kind: EpisodeSourceKind;
  source_id:   string;
  episode:     string;               // episode_text (client scope) or abstracted_text (fleet scope)
  outcome:     EpisodeOutcome;
  insight_ids: string[];
  metadata:    Record<string, unknown>;
  similarity:  number;               // cosine similarity in [-1..1]
}

// ── C-08 VoC ─────────────────────────────────────────────────────────────────

export type VocSource =
  | 'own_reviews' | 'competitor_reviews' | 'ad_comments' | 'community' | 'sales_thread' | 'manual';

export type VocExtractable =
  | 'pain' | 'desire' | 'objection' | 'alternative' | 'trigger' | 'proof' | 'identity';

export type VocDocumentStatus = 'ingested' | 'extracted' | 'reconciled' | 'failed';

export interface VocDocumentRow {
  id:            string;
  client_id:     string;
  owner_user_id: string;
  source:        VocSource;
  source_meta:   Record<string, unknown>;
  raw_text:      string;
  raw_hash:      string;
  quote_count:   number;
  status:        VocDocumentStatus;
  error:         string | null;
  created_at:    string;
  updated_at:    string;
}

export interface VocAtomAction {
  action:     'corroborated' | 'created' | 'contradicted' | 'skipped';
  insight_id?: string;
  signal_id?:  string;
  reason?:     string;
}

export interface VocQuoteRow {
  id:            string;
  document_id:   string;
  client_id:     string;
  owner_user_id: string;
  quote:         string;
  extractable:   VocExtractable;
  polarity:      'positive' | 'negative' | 'neutral';
  segment_tags:  Record<string, unknown>;
  atom_action:   VocAtomAction | null;
  funnel_fit:    'TOFU' | 'MOFU' | 'BOFU' | null;
  created_at:    string;
}

// ── C-10 strategy objects ─────────────────────────────────────────────────────

export interface PillarSpec {
  key:             string;            // stable slug ('desire-core', 'objection-price', ...)
  title:           string;            // human label (Hebrew ok)
  kind_cluster:    string[];          // the insight kinds this pillar clusters
  insight_ids:     string[];
  awareness_notes?: string;
}

export interface MessageArchitectureRow {
  id:            string;
  client_id:     string;
  owner_user_id: string;
  version:       number;
  core_promise:  { text: string; insight_id: string | null; confidence: number };
  pillars:       PillarSpec[];
  proof_map:     Array<{ proof_insight_id: string; pillar_key: string }>;
  unassigned:    Array<{ proof_insight_id: string; reason: string }>;
  grounded_in:   string[];
  synth_meta:    Record<string, unknown>;
  created_at:    string;
}

export type ExpectedRateProvenance = 'client_baseline' | 'playbook_prior' | 'declared_guess';

export interface FunnelNode {
  key:              string;
  kind:             'ad' | 'landing' | 'lead_form' | 'whatsapp_sequence' | 'call' | 'sale' | 'content' | 'retargeting';
  belief_installed: { insight_id?: string; text: string };
  asset_ref?:       string;
}

export interface FunnelEdge {
  from:     string;
  to:       string;
  event:    string;                    // the measurable conversion event
  expected: { rate: number; provenance: ExpectedRateProvenance };
  actual?:  { rate: number; n: number };
}

export interface FunnelRow {
  id:              string;
  client_id:       string;
  owner_user_id:   string;
  campaign_id:     string | null;
  name:            string;
  awareness_entry: string | null;
  nodes:           FunnelNode[];
  edges:           FunnelEdge[];
  grounded_in:     string[];
  status:          'draft' | 'active' | 'archived';
  created_at:      string;
  updated_at:      string;
}

// ── learning_signals additions (migration 034 widened the CHECK) ─────────────

/** New signal types the capabilities emit through the existing lifecycle. */
export type CapabilitySignalType = 'hypothesis_supported' | 'hypothesis_refuted' | 'voc_evidence';
