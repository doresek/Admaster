// lib/intelligence/types.ts
//
// Shared vocabulary for the "living client knowledge" core (Phase-A).
//
// The knowledge model has three concentric records (all owner-scoped via
// owner_user_id; the service-role admin client bypasses RLS for background
// writes):
//   • client_insights — the LIVING ATOMS. Each row is one discrete, tagged
//     belief about the client across three layers (business / customers /
//     bridge), with a confidence in [0..1] and an audit trail.
//   • insight_events  — append-only audit of every mutation to an atom.
//   • client_strategy — the SYNTHESIZED SNAPSHOT projected from the active
//     atoms into the StrategyAnalysis (#32) shape the AI context already emits.
//
// These types are the single source of truth for the strings the DB CHECK
// constraints enforce, so the data layer, analyzer, lifecycle engine and
// synthesizer all agree.

/** The three concentric layers of client knowledge. */
export type InsightLayer = 'business' | 'customers' | 'bridge';

/** Where an atom (or a piece of evidence for it) came from. */
export type InsightSource = 'brief' | 'user_signal' | 'content_performance' | 'ai_synthesis' | 'voc';

/** Lifecycle state of an atom. Atoms are NEVER deleted — only superseded/refuted. */
export type InsightStatus = 'active' | 'superseded' | 'refuted';

/** The append-only audit events on the insight_events log. */
export type InsightEvent =
  | 'created'
  | 'corroborated'
  | 'weakened'
  | 'superseded'
  | 'refuted'
  | 'reactivated';

/** A client_insights row (the living atom). */
export interface ClientInsight {
  id:                string;
  client_id:         string;
  owner_user_id:     string;
  layer:             InsightLayer;
  kind:              string;
  content:           string;
  structured:        Record<string, unknown> | null;
  source:            InsightSource;
  source_ref:        Record<string, unknown> | null;
  confidence:        number;
  evidence_count:    number;
  status:            InsightStatus;
  superseded_by:     string | null;
  superseded_reason: string | null;
  first_seen_at:     string;
  updated_at:        string;
}

/**
 * A freshly-analyzed belief before it has been reconciled against the existing
 * atoms. `rationale` is the analyzer's one-line "why" — it is persisted into the
 * atom's `structured.rationale` so the synthesizer can surface reasons.
 */
export interface InsightCandidate {
  layer:      InsightLayer;
  kind:       string;
  content:    string;
  confidence: number;
  rationale:  string;
}

/**
 * A normalized learning signal that can drive the lifecycle engine. Phase-A
 * produces these implicitly from brief candidates; Part 2 (content-performance
 * + user-signal loop) will construct them directly and call `reduceSignal` /
 * `applyLearningSignal`.
 */
export interface LearningSignal {
  /** Does the signal support (positive) or contradict (negative) the atom? */
  polarity: 'positive' | 'negative';
  /** Strength of the signal in [0..1]. weight>=DECISIVE_WEIGHT negatives supersede. */
  weight:   number;
  /** Optional FK into a signals table (Part 2) for the audit row. */
  signalId?: string;
  /** Human/machine reason recorded on the audit row. */
  reason?:   string;
}

// ── Confidence accumulation constants (§9 decision — fixed here) ──────────────
// start 0.50; a corroboration adds 0.12*weight (capped 0.99); a weakening
// subtracts 0.12*weight (floored 0.05); a DECISIVE negative (weight>=0.70, or a
// confidence that would fall below 0.15) supersedes/refutes the atom.
export const CONFIDENCE = {
  START:           0.50,
  STEP:            0.12,
  MAX:             0.99,
  MIN:             0.05,
  DECISIVE_WEIGHT: 0.70,
  SUPERSEDE_FLOOR: 0.15,
} as const;

// ── Kind taxonomy ─────────────────────────────────────────────────────────────
// The analyzer is instructed to tag each atom with one of these kinds, and the
// synthesizer maps them back into the StrategyAnalysis snapshot. Free-form kinds
// are tolerated everywhere (stored + corroborated), but only canonical kinds
// project into the snapshot.
export const KINDS: Record<InsightLayer, readonly string[]> = {
  business:  ['real_solution', 'real_usp', 'pain_solved', 'true_value', 'goal', 'core_offer', 'constraint'],
  customers: ['pain', 'desire', 'aspiration', 'dream', 'unspoken_want', 'objection', 'awareness', 'persona'],
  bridge:    ['value_translation', 'angle', 'hook', 'platform', 'funnel'],
} as const;

/**
 * Kinds that represent a SINGLE canonical slot per client — there is only one
 * "real USP", one recommended platform, etc. A high-confidence candidate whose
 * content differs from the active atom in such a slot is a decisive
 * contradiction (supersede). All other kinds are list-like: multiple atoms of
 * the same kind (many pains, many desires) legitimately coexist.
 */
export const SINGLETON_KINDS: ReadonlySet<string> = new Set([
  'goal', 'core_offer', 'real_usp', 'real_solution', 'true_value',
  'awareness', 'persona', 'platform', 'funnel',
]);

/** Columns selected for every ClientInsight read/write. */
export const INSIGHT_COLUMNS =
  'id, client_id, owner_user_id, layer, kind, content, structured, source, source_ref, ' +
  'confidence, evidence_count, status, superseded_by, superseded_reason, first_seen_at, updated_at';
