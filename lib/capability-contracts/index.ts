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

// ── Autonomy modes (migrations 040+044; VISION-DEEP §1.4, D1 DECIDED) ─────────

/**
 * The 3 USER-SELECTABLE modes (D1, Eliran 2026-07-04) — replaces the L0–L3
 * ladder. The client's owner picks the mode; the system never promotes itself:
 *   draft_only      — system prepares, user does everything
 *   propose_approve — one-tap approval before any publish/spend (DEFAULT)
 *   act_within_caps — autonomous inside user-set caps
 * Graduation logic emits mode-switch SUGGESTIONS only.
 */
export type AutonomyMode = 'draft_only' | 'propose_approve' | 'act_within_caps';

/** Caps bounding L2/L3 action. All optional — absent = the level's built-in default. */
export interface AutonomyCaps {
  daily_spend_cap?:    number;   // ILS
  monthly_spend_cap?:  number;   // ILS
  max_daily_delta_pct?: number;  // e.g. 25 = ±25%/day budget moves
}

/**
 * An action asking to route through the ladder. `kind` names the verb;
 * `impact` is what the ladder judges (spend/delta); `rationale` + grounded_in
 * keep the WHY-trail intact end to end.
 */
export interface AutonomyAction {
  kind:        'publish_organic' | 'create_paid_paused' | 'unpause_paid' | 'pause_paid'
             | 'reallocate_budget' | 'send_message' | 'propose_only';
  ref?:        string;                       // campaign/item/digest id
  impact?:     { spend_ils?: number; delta_pct?: number };
  rationale:   string;
  grounded_in: string[];
}

/** The ladder's verdict on one action. */
export type AutonomyRoute =
  | { route: 'execute';  reason: string }
  | { route: 'propose';  reason: string }    // queued for one-tap approval
  | { route: 'block';    reason: string };   // over caps / below level, with the why

export interface ClientAutonomyRow {
  id:                 string;
  client_id:          string;
  owner_user_id:      string;
  mode:               AutonomyMode;
  caps:               AutonomyCaps;
  approvals_total:    number;
  approvals_approved: number;
  mode_since:         string;
  created_at:         string;
  updated_at:         string;
}

// ── Heartbeat (migration 039; VISION-DEEP §1.2) ───────────────────────────────

export type HeartbeatTick   = 'daily' | 'weekly' | 'monthly';
export type HeartbeatStatus = 'claimed' | 'running' | 'succeeded' | 'failed' | 'skipped';

/** One action a tick took/proposed, with its ladder route — the WHY-trail unit. */
export interface HeartbeatAction {
  kind:      string;
  ref?:      string;
  rationale: string;
  route:     AutonomyRoute['route'];
}

export interface HeartbeatRunRow {
  id:            string;
  client_id:     string;
  owner_user_id: string;
  tick_type:     HeartbeatTick;
  status:        HeartbeatStatus;
  attention:     Record<string, unknown>;
  actions:       HeartbeatAction[];
  notes:         string[];
  tokens_used:   number | null;
  error:         string | null;
  lease_until:   string | null;
  started_at:    string | null;
  finished_at:   string | null;
  created_at:    string;
}

// ── Digest (migration 041; VISION-DEEP §1.3) ──────────────────────────────────

export type DigestKind   = 'weekly' | 'monthly';
export type DigestStatus = 'draft' | 'approved' | 'sent';

/** The audit trail: every id whose row contributed a clause to the narrative. */
export interface DigestSources {
  decision_ids:   string[];
  diagnosis_ids:  string[];
  hypothesis_ids: string[];
  campaign_ids:   string[];
}

export interface DigestRow {
  id:            string;
  client_id:     string;
  owner_user_id: string;
  kind:          DigestKind;
  period_start:  string;
  period_end:    string;
  content:       Record<string, unknown>;
  rendered_text: string;
  sources:       DigestSources;
  status:        DigestStatus;
  created_at:    string;
}

// ── Competitor watch (migration 042; spec C-09) ───────────────────────────────

export type CompetitorRing = 'direct' | 'category' | 'non_consumption';

export interface CompetitorEntityRow {
  id:            string;
  client_id:     string;
  owner_user_id: string;
  name:          string;
  page_ref:      string | null;
  ring:          CompetitorRing;
  active:        boolean;
  created_at:    string;
  updated_at:    string;
}

export interface CompetitorAdRow {
  id:              string;
  entity_id:       string;
  client_id:       string;
  owner_user_id:   string;
  platform_ad_ref: string;
  first_seen:      string;
  last_seen:       string;
  active:          boolean;
  creative:        Record<string, unknown>;
  decoded:         { angle?: string; awareness?: string; offer?: string; confidence?: number } | null;
  created_at:      string;
}

// ── Fleet factors (migration 043; spec C-04) ──────────────────────────────────

export interface FleetFactorRow {
  id:           string;
  date:         string;
  platform:     string;
  metric:       string;
  median_delta: number | null;
  mad:          number | null;
  sample_n:     number;
  shocked:      boolean;
  direction:    'up' | 'down' | null;
  note:         string | null;
  created_at:   string;
}

/** What diagnosis/verdict consumers ask the shock module. */
export interface ShockState {
  shocked:   boolean;
  factor:    number | null;    // median fleet delta for the metric that day
  direction: 'up' | 'down' | null;
  note:      string | null;
}

// ── Measurement spine (migration 060; MEASUREMENT-SPINE-PLAN.md) ─────────────

/** The funnel stages. `irrelevant` = the lead-quality negative (feeds atoms). */
export type LeadStage =
  | 'new' | 'contacted' | 'qualified' | 'meeting' | 'closed_won' | 'closed_lost' | 'irrelevant';

export type LeadSource = 'landing' | 'site' | 'whatsapp' | 'instant_form' | 'call' | 'manual';
export type StageMarkedVia = 'system' | 'ui' | 'digest' | 'whatsapp';

export interface FunnelLeadRow {
  id:                  string;
  client_id:           string;
  owner_user_id:       string;
  source:              LeadSource;
  source_ref:          Record<string, unknown>;
  name:                string | null;
  phone:               string | null;
  email:               string | null;
  consent_marketing:   boolean;
  consent_recorded_at: string | null;
  current_stage:       LeadStage;
  value:               number | null;
  created_at:          string;
  updated_at:          string;
}

/** L0 identity capture — attribution without stored click IDs is guessing. */
export interface LeadTouchpointRow {
  id:            string;
  lead_id:       string;
  client_id:     string;
  owner_user_id: string;
  fbclid:        string | null;
  gclid:         string | null;
  ctwa_clid:     string | null;
  meta_lead_id:  string | null;
  utm:           Record<string, string>;
  landing_path:  string | null;
  referrer:      string | null;
  user_agent:    string | null;
  captured_at:   string;
}

export interface LeadStageEventRow {
  id:            string;
  lead_id:       string;
  client_id:     string;
  owner_user_id: string;
  stage:         LeadStage;
  value:         number | null;
  marked_via:    StageMarkedVia;
  note:          string | null;
  created_at:    string;
}

/** Owner-seeded unit-economics inputs; break-even ROAS is COMPUTED (1/CM), never stored. */
export interface ClientEconomicsRow {
  id:                      string;
  client_id:               string;
  owner_user_id:           string;
  contribution_margin_pct: number | null;
  avg_deal_value:          number | null;
  close_rate_pct:          number | null;
  payback_target_months:   number;
  currency:                string;
  source:                  'owner' | 'computed' | 'mixed';
  updated_at:              string;
  created_at:              string;
}

export interface ChannelReconciliationRow {
  id:               string;
  client_id:        string;
  owner_user_id:    string;
  channel:          string;
  period_start:     string;
  period_end:       string;
  platform_claimed: number;
  crm_truth:        number;
  ratio:            number | null;
  note:             string | null;
  created_at:       string;
}
