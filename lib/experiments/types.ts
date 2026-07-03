// lib/experiments/types.ts
//
// C-11 experiment portfolio manager — shared vocabulary
// (MARKETING-CAPABILITIES-SPEC §C-11, creative-testing-discipline §3/§5).
//
// This module sits OVER C-01 (lib/hypotheses): it decides WHICH tests run now
// (planSlate), HOW the daily budget splits across a running test's arms
// (allocateArms), and WHEN evidence pooled along the atom graph has collected
// one verdict's worth of sample (pooledEvidence). It never registers, resolves
// or kills anything itself — all lifecycle verbs stay with C-01; this module
// only produces plans and readiness flags for the heartbeat/runner to act on.
//
// Everything here is data-in/data-out (same doctrine as lib/hypotheses/types):
// the row shapes come from lib/capability-contracts, the atom shape from
// lib/intelligence, and this file adds only the planning shapes that exist
// between them.

import type {
  FloorSpec,
  Horizon,
  HypothesisDomain,
  HypothesisRow,
} from '@/lib/capability-contracts';
import type { KillAction } from '@/lib/hypotheses';

// ── candidate classification (skill §5 priority order) ───────────────────────

/**
 * WHY the candidate deserves explore budget — the skill-§5 priority ladder:
 *   1. decision_unblocking — the claim gates many downstream decisions
 *      (a sub_audience question gates every campaign aimed at it).
 *   2. contested_atom — mid-confidence, mixed evidence: cheapest to resolve,
 *      highest belief-movement.
 *   3. fatigue_successor — new execution of a proven angle (insurance, not
 *      discovery).
 *   4. wild_variant — cross-domain / owner ideas; small fixed slot, genius
 *      insurance.
 * planSlate uses this ONLY as a tie-break under equal information value —
 * the ladder is the craft's ordering of *kinds* of information, the score is
 * the per-candidate measurement.
 */
export type CandidateKind =
  | 'decision_unblocking'
  | 'contested_atom'
  | 'fatigue_successor'
  | 'wild_variant';

/** Lower = higher priority in the skill-§5 ladder (tie-break order). */
export const KIND_PRIORITY: Record<CandidateKind, number> = {
  decision_unblocking: 1,
  contested_atom:      2,
  fatigue_successor:   3,
  wild_variant:        4,
};

// ── candidates ────────────────────────────────────────────────────────────────

/**
 * One thing we COULD test this cycle: either an already-registered open
 * hypothesis (`hypothesis` present — the loadOpenCandidates path) or a claim
 * draft not yet registered (the caller supplies the planned floor/horizon/arms
 * so the slate can do the §3 capacity math BEFORE registration).
 */
export interface HypothesisCandidate {
  /** Hypothesis id for open rows; any stable unique id for drafts. */
  id:          string;
  claim:       string;
  /** The atoms the verdict would move (drives decisionWeight + beliefMovement). */
  insight_ids: string[];
  domain:      HypothesisDomain;
  kind:        CandidateKind;
  floor_spec:  FloorSpec;
  horizon:     Horizon;
  /** Simultaneously-running arms sharing the test budget (≥ 2 for a comparison). */
  arm_count:   number;
  /** Present when the candidate is an already-registered open hypothesis. */
  hypothesis?: HypothesisRow;
}

/**
 * Expected unit costs used to project spend → sample (the registrant's
 * expectations, same semantics as BudgetPlan in lib/hypotheses — arithmetic,
 * not a forecast). Field names deliberately match BudgetPlan so the two
 * modules speak the same dialect.
 */
export interface UnitCosts {
  expected_cpm?:                  number;
  expected_cpc?:                  number;
  expected_cpa?:                  number;
  expected_cost_per_marked_lead?: number;
}

// ── information value ─────────────────────────────────────────────────────────

/**
 * The scored components behind one candidate's ranking, kept separately so a
 * human can audit WHY candidate A outranked candidate B (same auditability
 * requirement as lib/attention's per-component reasons).
 */
export interface InfoValueBreakdown {
  /** Atoms moved × domain multiplier — decisions the verdict unblocks. */
  decision_weight: number;
  /** Mean Bernoulli-belief variance (×4) over the candidate's atoms, in [0..1]. */
  belief_movement: number;
  /** ILS for the WHOLE test (all arms) to reach its per-arm floor. */
  est_cost_to_floor_ils: number;
  /** (decision_weight × belief_movement) / max(1, est_cost_to_floor_ils). */
  info_value: number;
}

// ── slate plan ────────────────────────────────────────────────────────────────

export interface SlateSelection {
  candidate:    HypothesisCandidate;
  score:        InfoValueBreakdown;
  /** ILS/day this test gets from the explore budget. */
  daily_budget: number;
  /** ILS/day below which the floor cannot be reached within the horizon. */
  min_viable_daily: number;
}

export interface SlateDeferral {
  candidate: HypothesisCandidate;
  /** Human-readable WHY, carrying the actual math (§3: show numbers, not slogans). */
  reason:    string;
  /** Present when the candidate was scoreable (deferred on budget, not on data). */
  score?:    InfoValueBreakdown;
}

export interface SlatePlan {
  selected: SlateSelection[];
  deferred: SlateDeferral[];
  maturity: MaturityAssessment;
  /** share × daily budget — the cycle's information capacity in ILS/day. */
  explore_budget_ils:  number;
  /** Σ selected daily budgets (≤ explore_budget_ils, invariant). */
  explore_budget_used: number;
  /** One-line capacity summary (skill §3 small-budget corollary). */
  capacity_note: string;
}

// ── maturity ──────────────────────────────────────────────────────────────────

export type BrainMaturity = 'new' | 'developing' | 'mature';

export interface MaturityAssessment {
  maturity: BrainMaturity;
  /** Active bridge-layer atoms at/above the high-confidence bar. */
  high_confidence_bridge_atoms: number;
  /** Fraction of the daily budget the explore slate may consume, in (0..1]. */
  explore_share: number;
}

// ── arm allocation ────────────────────────────────────────────────────────────

export interface ArmAllocation {
  arm:          string;
  /** ILS/day. 0 for killed arms. Σ over arms == the daily budget (±1 agora rounding). */
  daily_budget: number;
  /** armFloorProgress at allocation time (0 when the arm has no observations). */
  floor_progress: number;
  /** The floors-first component: guaranteed spend keeping the arm on floor trajectory. */
  floor_minimum: number;
  /** Deterministic Thompson pseudo-sample of the arm's success rate, in (0..1). */
  sampled_win_prob: number;
  /** True when a C-01 kill rule flagged this arm — allocation is forced to 0. */
  killed: boolean;
}

export interface AllocationPlan {
  allocations: ArmAllocation[];
  /**
   * The C-01 kill action to EXECUTE (runner/heartbeat's job — this module
   * only surfaces it). checkKillRules returns at most one action per call;
   * the runner re-invokes after acting on it.
   */
  kill: KillAction | null;
  /** Σ allocations (== requested budget unless degenerate; see note). */
  total_allocated: number;
  /** Plain-language notes: degenerate budgets, floor-scaling, fallbacks. */
  notes: string[];
}

// ── hierarchical pooling ──────────────────────────────────────────────────────

/** Summed observation counts (non-finite inputs count as 0 — math stays total). */
export interface PooledCounts {
  impressions:  number;
  clicks:       number;
  conversions:  number;
  marked_leads: number;
}

export interface PooledTestEvidence {
  hypothesis_id: string;
  /** This test's contribution: its summed sample vs. ITS OWN per-arm floor. */
  floor_progress: number;
  samples: PooledCounts;
}

/**
 * The §3 pooling escape hatch, as a READINESS FLAG only: evidence pooled along
 * the atom graph has (or has not) collected one floor quantum's worth of
 * sample. What pooling does NOT do: it never resolves anything, never moves
 * atoms, never touches hypothesis status — actual pooled resolution remains a
 * C-01 `resolveAndLearn` call by the consumer (no shadow lifecycle).
 */
export interface PooledEvidence {
  atom_id: string;
  /** True when the combined per-test floor progress reaches one full quantum (≥ 1). */
  ready: boolean;
  /** Σ per-test floor progress — "how many floors' worth" the structure holds. */
  combined_progress: number;
  combined_n: PooledCounts;
  per_test: PooledTestEvidence[];
  reason: string;
}
