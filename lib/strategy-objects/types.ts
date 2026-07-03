// lib/strategy-objects/types.ts
//
// Internal vocabulary for C-10 (messaging architecture + funnel-as-object).
// The PERSISTED row shapes (MessageArchitectureRow, FunnelRow, FunnelNode,
// FunnelEdge, PillarSpec, ExpectedRateProvenance) live in
// lib/capability-contracts and are imported, never redefined — this file only
// adds the PRE-persist / analysis shapes the pure engines exchange.
//
// Everything here is deliberately deterministic-friendly: no Dates, no
// functions, plain JSON-serializable data, so "same insights → byte-identical
// output" is testable with a deep-equal.

import type { ClientInsight } from '@/lib/intelligence/types';
import type { FunnelStage } from '@/lib/decision-engine/types';
import type {
  ExpectedRateProvenance,
  FunnelEdge,
  FunnelNode,
  MessageArchitectureRow,
} from '@/lib/capability-contracts';

// ── synthesis (architecture.ts) ───────────────────────────────────────────────

export interface SynthesisInput {
  insights: ClientInsight[];
}

/**
 * The pre-persist architecture: MessageArchitectureRow minus the columns the
 * store stamps (id / client_id / owner_user_id / version / created_at).
 * Structurally a subset of the row, so diffing a draft against a persisted
 * row needs no conversion.
 */
export type ArchitectureDraft = Pick<
  MessageArchitectureRow,
  'core_promise' | 'pillars' | 'proof_map' | 'unassigned' | 'grounded_in' | 'synth_meta'
>;

/**
 * The slice of an architecture that defines its IDENTITY for diff/skip-save
 * purposes. synth_meta and grounded_in are deliberately excluded: synth_meta
 * carries the trigger (varies per run without the projection changing) and
 * grounded_in is derivable from the other fields.
 */
export type ArchitectureProjection = Pick<
  MessageArchitectureRow,
  'core_promise' | 'pillars' | 'proof_map' | 'unassigned'
>;

export interface SynthesisResult {
  architecture: ArchitectureDraft;
  /** Honest-state flags: weak promise, missing pillars, unused proof, empty input. */
  warnings: string[];
}

/** Output of diffArchitectures — feeds the "should we re-synthesize/save" call. */
export interface ArchitectureDiff {
  /** Pillar keys present in `next` but not `prev`. */
  added: string[];
  /** Pillar keys present in `prev` but not `next`. */
  removed: string[];
  /** Pillar keys present in both whose anchor atom (top insight_id) changed. */
  anchor_changed: string[];
  core_promise_changed: boolean;
  /** True when the full projection (promise/pillars/proof_map/unassigned) is equal. */
  identical: boolean;
}

// ── coverage (store.ts → coverageReport) ─────────────────────────────────────

export interface PillarCoverage {
  key:              string;
  title:            string;
  artifact_count:   number;
  last_artifact_at: string | null;
  /**
   * Zero artifacts in the window. Per marketing-strategy §5: "a pillar with no
   * content ... silence is a decision; make it on purpose" — this flag makes
   * the accidental version visible.
   */
  silent: boolean;
}

export interface CoverageReport {
  pillars:     PillarCoverage[];
  window_days: number;
}

// ── funnel design + health (funnel.ts) ───────────────────────────────────────

/** An observed conversion rate with its sample size. */
export interface RateSample {
  rate: number;
  n:    number;
}

/**
 * Input to designFunnel. `decision` is a structural slice of MarketingDecision
 * (lib/decision-engine/types) — the design consumes one but never imports the
 * engine itself, per the shared-file law.
 */
export interface FunnelDesignInput {
  decision: {
    funnel_stage: FunnelStage;
    angle:        string;
    /** Free-text Schwartz awareness (atom content or canonical key). */
    awareness?:   string;
  };
  insights: ClientInsight[];
  /** Measured client rates per edge event (provenance 'client_baseline' when n≥30). */
  baselines?: Record<string, RateSample>;
  /** Caller-declared expected rates per edge event (provenance 'declared_guess'). */
  overrides?: Record<string, number>;
}

/** The pre-persist funnel: FunnelRow minus the columns the store stamps. */
export interface FunnelDraft {
  name:            string;
  awareness_entry: string | null;
  nodes:           FunnelNode[];
  edges:           FunnelEdge[];
  grounded_in:     string[];
}

export interface FunnelDesignResult {
  funnel:   FunnelDraft;
  warnings: string[];
}

/** One edge's expected-vs-actual localization. */
export interface EdgeHealth {
  from:     string;
  to:       string;
  event:    string;
  expected: { rate: number; provenance: ExpectedRateProvenance };
  actual:   RateSample | null;
  /** actual.rate / expected.rate; null when no actual or expected is 0. */
  ratio: number | null;
  /**
   * n ≥ MIN_EDGE_N. An insufficient edge is "unreadable — do not diagnose":
   * it is NEVER eligible to be worst_edge (statistical humility, skill §4.3).
   */
  sufficient_n: boolean;
}

/**
 * THE DIAGNOSIS INPUT (spec C-10 wire-in): the diagnosis engine localizes a
 * failure to `worst_edge` instead of redesigning the whole funnel.
 */
export interface FunnelHealth {
  /** Lowest-ratio edge among SUFFICIENT edges only; null when none qualify. */
  worst_edge: EdgeHealth | null;
  /** Present exactly when worst_edge is null — why the funnel is unreadable. */
  reason?: string;
  edges:   EdgeHealth[];
}
