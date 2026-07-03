// lib/experiments/info-value.ts
//
// PURE information-value scoring for slate candidates (spec C-11: rank open
// hypothesis candidates by decision-unblocking weight × belief-movement
// potential ÷ cost-to-floor). Zero I/O; every function is total — no NaN or
// Infinity ever leaves this file (non-finite inputs are treated as absent,
// same doctrine as lib/hypotheses/core).

import type { FloorSpec, HypothesisDomain } from '@/lib/capability-contracts';
import type { ClientInsight } from '@/lib/intelligence/types';
import type { HypothesisCandidate, InfoValueBreakdown, UnitCosts } from './types';

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── decision weight ───────────────────────────────────────────────────────────

/**
 * DELIBERATE MIRROR of lib/attention/load.ts DOMAIN_DECISION_MULTIPLIER — the
 * two capabilities must rank by the SAME notion of "which domains steer the
 * most decisions", but capability folders never import each other privately
 * (capability-contracts doctrine), so the constants are copied verbatim.
 * If lib/attention retunes its values, retune these too.
 */
export const DOMAIN_DECISION_MULTIPLIER: Record<HypothesisDomain, number> = {
  angle:    1.5,
  audience: 1.5,
  offer:    1.5,
  creative: 1.0,
  funnel:   1.0,
  timing:   1.0,
  channel:  1.0,
  other:    1.0,
};

/**
 * decisionWeight = max(1, insight_ids.length) × domain multiplier — a direct
 * count of the beliefs (and therefore downstream decisions) the verdict would
 * move, exactly as lib/attention computes it for open hypotheses. The max(1,·)
 * floor: a hypothesis always unblocks at least its own verdict.
 */
export function decisionWeight(candidate: Pick<HypothesisCandidate, 'insight_ids' | 'domain'>): number {
  return Math.max(1, candidate.insight_ids.length) * DOMAIN_DECISION_MULTIPLIER[candidate.domain];
}

// ── belief movement ───────────────────────────────────────────────────────────

/**
 * How much a verdict COULD teach us about these atoms, in [0..1].
 *
 * Per atom: 4·c·(1−c) — the variance of a Bernoulli belief with parameter c,
 * normalized so maximum uncertainty scores 1. A contested atom (c ≈ 0.5) is
 * where a verdict moves belief the most; a settled atom (c ≈ 0.05 or 0.95)
 * barely moves whatever the test says (skill §5: "contested atoms — cheapest
 * to resolve, highest belief-movement"). Averaged over the candidate's atoms;
 * this is the honest "how much could this verdict teach us".
 *
 * Empty/unknown atoms → 0: a candidate whose atoms we cannot see has no
 * measurable belief-movement (inventing one would corrupt the ranking).
 */
export function beliefMovement(atoms: ClientInsight[]): number {
  const confidences = atoms
    .map((a) => a.confidence)
    .filter(isFiniteNum)
    .map((c) => Math.min(1, Math.max(0, c)));
  if (confidences.length === 0) return 0;
  const total = confidences.reduce((sum, c) => sum + 4 * c * (1 - c), 0);
  return total / confidences.length;
}

// ── cost to floor ─────────────────────────────────────────────────────────────

// MIRROR of lib/hypotheses/core.ts FLOOR_FIELDS / UNIT_COST_FOR_FLOOR (module-
// private there, so mirrored with the same shapes): the countable floor
// dimensions and the unit cost each needs for a spend → sample projection.
const FLOOR_FIELDS = ['impressions', 'clicks', 'conversions', 'marked_leads'] as const;
type FloorField = (typeof FLOOR_FIELDS)[number];

const UNIT_COST_FOR_FLOOR: Record<FloorField, keyof UnitCosts> = {
  impressions:  'expected_cpm',
  clicks:       'expected_cpc',
  conversions:  'expected_cpa',
  marked_leads: 'expected_cost_per_marked_lead',
};

export type CostToFloorResult =
  | { ok: true; per_arm_ils: number; total_ils: number; binding_field: FloorField }
  | { ok: false; reason: string };

/**
 * ILS needed to reach the registered floor — the SAME projection arithmetic as
 * lib/hypotheses validateRegistration's resolvability check, inverted (that
 * check asks "does this budget reach the floor?", this one asks "what budget
 * reaches the floor?"). The helper there is module-private, so the unit-cost
 * math SHAPE is mirrored: impressions floors project through CPM per 1,000,
 * every other floor through its per-unit cost.
 *
 * Spend produces ALL floored quantities concurrently at the expected rates, so
 * the per-arm cost is the MAX over floored fields (the binding floor), not the
 * sum. A floor we cannot project (missing unit cost) is an explicit failure —
 * "we didn't check" is not a launch condition (§7).
 */
export function costToFloor(
  floor:     FloorSpec,
  unitCosts: UnitCosts,
  armCount:  number = 1,
): CostToFloorResult {
  const arms = isFiniteNum(armCount) && armCount >= 1 ? Math.floor(armCount) : 1;

  let perArm = 0;
  let binding: FloorField | null = null;
  for (const field of FLOOR_FIELDS) {
    const required = floor.per_arm[field];
    if (!isFiniteNum(required) || required <= 0) continue;

    const costKey  = UNIT_COST_FOR_FLOOR[field];
    const unitCost = unitCosts[costKey];
    if (!isFiniteNum(unitCost) || unitCost <= 0) {
      return {
        ok:     false,
        reason: `floor on ${field} cannot be projected — ${costKey} is missing; supply it or drop the floor`,
      };
    }

    const cost = field === 'impressions' ? (required / 1000) * unitCost : required * unitCost;
    if (cost > perArm) {
      perArm  = cost;
      binding = field;
    }
  }

  if (binding === null) {
    // A floorless spec can never be "reached" — same stance as armFloorProgress
    // returning 0 for a spec that checks nothing.
    return { ok: false, reason: 'floor_spec.per_arm sets no positive floor — cost to floor is undefined' };
  }

  return { ok: true, per_arm_ils: round2(perArm), total_ils: round2(perArm * arms), binding_field: binding };
}

// ── information value ─────────────────────────────────────────────────────────

export type InfoValueResult =
  | { ok: true; breakdown: InfoValueBreakdown }
  | { ok: false; reason: string };

/**
 * infoValue = (decisionWeight × beliefMovement) / max(1, costToFloor) —
 * information per shekel. The max(1,·) denominator floor keeps near-free tests
 * from producing unbounded scores (and keeps the math total at cost 0).
 *
 * `insights` is the client's atom pool; only the candidate's own atoms feed
 * beliefMovement. Atoms referenced but not found contribute nothing — an
 * invisible atom has no measurable contested-ness.
 */
export function infoValue(
  candidate: HypothesisCandidate,
  insights:  ClientInsight[],
  unitCosts: UnitCosts,
): InfoValueResult {
  const cost = costToFloor(candidate.floor_spec, unitCosts, candidate.arm_count);
  if (!cost.ok) return { ok: false, reason: cost.reason };

  const wanted = new Set(candidate.insight_ids);
  const atoms  = insights.filter((i) => wanted.has(i.id));

  const dw = decisionWeight(candidate);
  const bm = beliefMovement(atoms);
  const iv = (dw * bm) / Math.max(1, cost.total_ils);

  return {
    ok: true,
    breakdown: {
      decision_weight:       round2(dw),
      belief_movement:       round2(bm),
      est_cost_to_floor_ils: cost.total_ils,
      // 4 decimals: info values are small ratios; 2 would collapse real ranking gaps.
      info_value: Math.round(iv * 10000) / 10000,
    },
  };
}
