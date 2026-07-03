// lib/hypotheses/types.ts
//
// Module-internal vocabulary for C-01 (the pre-registered hypothesis ledger).
//
// The ROW shapes (HypothesisRow, Prediction, FloorSpec, VerdictMap, KillRules…)
// are frozen in lib/capability-contracts and imported — never redefined — here.
// This file adds only the shapes that exist BETWEEN the contract rows and the
// pure core: registration inputs, per-arm observations, structured rejections,
// verdicts and kill actions. Everything is data-in/data-out so the core stays
// deterministically unit-testable (same doctrine as lib/decision-engine/types).

import type {
  FloorSpec,
  Horizon,
  HypothesisDomain,
  HypothesisResolution,
  HypothesisRow,
  HypothesisStatus,
  KillRules,
  Prediction,
  TestRef,
  VerdictAtomMove,
  VerdictMap,
} from '@/lib/capability-contracts';

// Re-export the contract types consumers of this module actually touch, so
// downstream code can import everything hypothesis-shaped from '@/lib/hypotheses'.
export type {
  FloorSpec,
  Horizon,
  HypothesisDomain,
  HypothesisResolution,
  HypothesisRow,
  HypothesisStatus,
  KillRules,
  Prediction,
  PredictionComparator,
  TestRef,
  VerdictAtomMove,
  VerdictMap,
} from '@/lib/capability-contracts';

// ── runtime guards ────────────────────────────────────────────────────────────
// Query params and JSON bodies arrive as plain strings; these guards narrow them
// to the contract unions without casts. The value lists are typed against the
// contract unions so a contract change breaks compilation here, not in prod.

const ALL_STATUSES: readonly HypothesisStatus[] =
  ['open', 'supported', 'refuted', 'inconclusive', 'killed', 'superseded'];
const STATUS_STRINGS: readonly string[] = ALL_STATUSES;

const ALL_DOMAINS: readonly HypothesisDomain[] =
  ['angle', 'audience', 'offer', 'creative', 'funnel', 'timing', 'channel', 'other'];
const DOMAIN_STRINGS: readonly string[] = ALL_DOMAINS;

/** Narrow an arbitrary string to a HypothesisStatus (for query params). */
export function isHypothesisStatus(s: string): s is HypothesisStatus {
  return STATUS_STRINGS.includes(s);
}

/** Narrow an arbitrary string to a HypothesisDomain (for query params). */
export function isHypothesisDomain(s: string): s is HypothesisDomain {
  return DOMAIN_STRINGS.includes(s);
}

/** Statuses that count as "this test has already produced an answer" — the
 *  duplicate-test guard ("already tried" memory) looks only at these. */
export const RESOLVED_STATUSES: readonly HypothesisStatus[] =
  ['supported', 'refuted', 'inconclusive', 'killed'];

// ── registration input ────────────────────────────────────────────────────────

/**
 * The planned economics of the test, used ONLY by the "don't launch
 * unresolvable tests" check (creative-testing-discipline §7: if projection <
 * floor → redesign or pool; do not launch). Unit costs are the registrant's
 * expectations — the check is arithmetic, not a forecast.
 */
export interface BudgetPlan {
  /** Planned total daily budget across ALL arms (ILS). */
  daily_budget: number;
  /** Number of simultaneously-running arms sharing that budget. */
  arm_count: number;
  /** Expected cost per 1,000 impressions (needed to project an impressions floor). */
  expected_cpm?: number;
  /** Expected cost per click (needed to project a clicks floor). */
  expected_cpc?: number;
  /** Expected cost per conversion (needed to project a conversions floor). */
  expected_cpa?: number;
  /** Expected cost per owner-marked lead (needed to project a marked_leads floor). */
  expected_cost_per_marked_lead?: number;
}

/** Everything a registration must pre-declare (creative-testing-discipline §1). */
export interface RegisterHypothesisInput {
  clientId:    string;
  ownerUserId: string;
  insightIds:  string[];
  claim:       string;
  prediction:  Prediction;
  floorSpec:   FloorSpec;
  horizon:     Horizon;
  verdictMap:  VerdictMap;
  killRules:   KillRules;
  testRefs:    TestRef[];
  domain:      HypothesisDomain;
  /** When provided, validation ALSO runs the resolvability math (§7). */
  budgetPlan?: BudgetPlan;
}

// ── validation results ────────────────────────────────────────────────────────

export type RegistrationRejectionCode =
  | 'empty_claim'
  | 'no_insight_ids'
  | 'invalid_prediction'
  | 'missing_baseline_arm'
  | 'invalid_confidence'
  | 'invalid_floor'
  | 'invalid_horizon'
  | 'invalid_verdict_map'
  | 'invalid_weight'
  | 'unknown_insight_ref'
  | 'invalid_kill_rules'
  | 'arm_not_in_test_refs'
  | 'invalid_budget_plan'
  | 'unprojectable_floor'
  | 'unresolvable_at_budget';

/**
 * One structured reason a registration was refused. `detail` carries the
 * numbers behind the verdict (e.g. projected sample vs. required floor) so the
 * caller can show the math, not just a slogan.
 */
export interface RegistrationRejection {
  code:    RegistrationRejectionCode;
  message: string;
  detail?: Record<string, number | string>;
}

export type RegistrationValidation =
  | { ok: true }
  | { ok: false; reasons: RegistrationRejection[] };

// ── observations ──────────────────────────────────────────────────────────────

/**
 * What one arm actually did. Counts feed the floor check; `metrics` holds the
 * named observed values ('ctr', 'cvr', 'cpa', 'lead_quality', …) the frozen
 * prediction is evaluated against. Non-finite values are treated as ABSENT
 * everywhere — a NaN upstream must never become a verdict.
 */
export interface ArmObservation {
  arm:           string;
  impressions?:  number;
  clicks?:       number;
  conversions?:  number;
  marked_leads?: number;
  metrics?:      Record<string, number>;
}

// ── verdicts ──────────────────────────────────────────────────────────────────

export type Verdict = 'supported' | 'refuted' | 'inconclusive';

/** The outcome of evaluating the frozen prediction against observations. */
export interface PredictionEvaluation {
  verdict:  Verdict;
  reason:   string;
  /** The observed value (or ratio) when it was computable. */
  observed?: number;
}

/** What `resolve` returns — pure data the persistence layer records verbatim. */
export interface ResolveOutcome {
  status:     Verdict;
  resolution: HypothesisResolution;
  /** The FROZEN verdict_map entry for the verdict — never recomputed. */
  atomMoves:  VerdictAtomMove[];
}

// ── kill rules ────────────────────────────────────────────────────────────────

/** A typed early-stopping action; null from checkKillRules means "keep running". */
export type KillAction =
  | {
      kind:   'kill_arm';
      rule:   'mercy';
      arm:    string;
      reason: string;
      detail: {
        floor_progress:         number;
        performance:            number;
        leader_arm:             string;
        leader_performance:     number;
        relative_performance:   number;
        max_fraction_of_leader: number;
      };
    }
  | {
      kind:   'kill_arm';
      rule:   'catastrophic';
      arm:    string;
      reason: string;
      detail: { spend: number; threshold: number; results: number };
    }
  | {
      kind:   'force_resolve';
      rule:   'horizon';
      reason: string;
      detail: { days_elapsed?: number; max_days?: number; total_spend?: number; max_spend?: number };
    };

// ── composition-layer results (resolve-and-learn) ─────────────────────────────

/** Per-atom outcome of pushing one frozen verdict move through the lifecycle. */
export interface AtomMoveResult {
  insight_id: string;
  signal_id:  string | null;
  outcome:
    | 'applied'              // lifecycle corroborated/weakened the atom
    | 'atom_refuted'         // decisive negative — lifecycle refuted the atom
    | 'atom_missing'         // insight_id not found for this client/owner
    | 'signal_insert_failed' // learning_signals insert errored (recorded, not thrown)
    | 'claim_lost'           // idempotency CAS lost — someone already processed it
    | 'apply_failed'         // lifecycle apply threw (recorded, not thrown)
    | 'unsupported_verdict'; // inconclusive moves have no learning_signals type
  note?: string;
}

export interface ResolveAndLearnResult {
  /** True only when THIS call performed the resolution (idempotency contract). */
  applied:    boolean;
  hypothesis: HypothesisRow;
  status:     HypothesisStatus;
  resolution: HypothesisResolution | null;
  moves:      AtomMoveResult[];
}

/** Result of the guarded registration path (validation + "already tried" memory). */
export type RegisterHypothesisResult =
  | { ok: true; hypothesis: HypothesisRow; warnings: string[]; priors: HypothesisRow[] }
  | { ok: false; reasons: RegistrationRejection[] };
