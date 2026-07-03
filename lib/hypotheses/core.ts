// lib/hypotheses/core.ts
//
// The PURE core of the hypothesis ledger (C-01): registration validation,
// prediction evaluation, floor checks, verdict resolution and kill rules.
// Zero I/O — every function is data-in/data-out so the discipline it encodes
// (creative-testing-discipline §1 pre-registration, §3 floors, §4 kill rules)
// is deterministically unit-testable.
//
// Honesty invariants this file enforces mechanically:
//   • Verdict criteria are FROZEN — resolution only ever reads the registered
//     prediction/floor/verdict_map; nothing here recomputes "what should move".
//   • Floor unmet → 'inconclusive'. An inconclusive test moves NO atoms
//     (verdict_map.inconclusive, conventionally []).
//   • Kill decisions read evidence only (samples, performance, spend) — never
//     sunk cost, never authorship.
//   • Non-finite numbers (NaN/Infinity) are treated as ABSENT everywhere: a
//     broken metric upstream degrades to 'inconclusive', never to a verdict.

import type {
  FloorSpec,
  HypothesisResolution,
  HypothesisRow,
  Prediction,
  VerdictAtomMove,
} from '@/lib/capability-contracts';
import type {
  ArmObservation,
  BudgetPlan,
  KillAction,
  PredictionEvaluation,
  RegisterHypothesisInput,
  RegistrationRejection,
  RegistrationValidation,
  ResolveOutcome,
} from './types';

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// The countable floor dimensions (FloorSpec.per_arm keys), and the unit-cost
// each needs for the pre-launch projection.
const FLOOR_FIELDS = ['impressions', 'clicks', 'conversions', 'marked_leads'] as const;
type FloorField = (typeof FLOOR_FIELDS)[number];

const UNIT_COST_FOR_FLOOR: Record<FloorField, keyof BudgetPlan> = {
  impressions:  'expected_cpm',
  clicks:       'expected_cpc',
  conversions:  'expected_cpa',
  marked_leads: 'expected_cost_per_marked_lead',
};

// Which observed count is "a result" for each floor grade — used by the
// catastrophic kill rule ("spend with ZERO results") and nothing else.
const RESULT_FIELD_FOR_GRADE: Record<FloorSpec['metric_grade'], FloorField> = {
  ctr:          'clicks',
  cvr:          'conversions',
  cpa:          'conversions',
  lead_quality: 'marked_leads',
};

// For the mercy rule the "leading arm" depends on metric direction: rates are
// higher-is-better, costs are lower-is-better. Only the floor grades exist here
// on purpose — mercy compares arms on the registered floor grade.
const LOWER_IS_BETTER: ReadonlySet<FloorSpec['metric_grade']> = new Set(['cpa']);

const VALID_COMPARATORS: readonly string[] = ['gte', 'lte', 'ratio_gte', 'ratio_lte'];
const VALID_GRADES:      readonly string[] = ['ctr', 'cvr', 'cpa', 'lead_quality'];
const VALID_POLARITIES:  readonly string[] = ['positive', 'negative'];

// ── registration validation ───────────────────────────────────────────────────

/**
 * Validate a registration BEFORE it enters the ledger. Rejections are
 * structured data (never throws) because an incomplete registration is a
 * normal, expected outcome the caller must be able to explain — including the
 * §7 resolvability math ("don't launch unresolvable tests"): given the planned
 * budget and expected unit costs, a test whose projected per-arm sample cannot
 * reach the floor within the horizon is refused WITH the numbers.
 */
export function validateRegistration(input: RegisterHypothesisInput): RegistrationValidation {
  const reasons: RegistrationRejection[] = [];
  const reject = (r: RegistrationRejection): void => { reasons.push(r); };

  // CLAIM — an empty claim is an untestable claim.
  if (!input.claim || !input.claim.trim()) {
    reject({ code: 'empty_claim', message: 'claim is empty — a hypothesis must state the atom-level claim it tests' });
  }

  // ATOMS — a hypothesis not bound to atoms cannot move the brain on any verdict.
  const insightIds = Array.isArray(input.insightIds) ? input.insightIds.filter((id) => !!id?.trim()) : [];
  if (insightIds.length === 0) {
    reject({ code: 'no_insight_ids', message: 'insight_ids is empty — a hypothesis must reference the atoms it tests' });
  }

  // PREDICTION — metric + direction + minimum effect, frozen at launch.
  const p = input.prediction;
  if (!p || !p.metric?.trim()) {
    reject({ code: 'invalid_prediction', message: 'prediction.metric is missing' });
  }
  if (!p || !VALID_COMPARATORS.includes(p.comparator)) {
    reject({ code: 'invalid_prediction', message: `prediction.comparator must be one of ${VALID_COMPARATORS.join(', ')}` });
  }
  if (!p || !isFiniteNum(p.value)) {
    reject({ code: 'invalid_prediction', message: 'prediction.value must be a finite number' });
  }
  if (!p || !p.arm?.trim()) {
    reject({ code: 'invalid_prediction', message: 'prediction.arm is missing' });
  }
  if (p && (p.comparator === 'ratio_gte' || p.comparator === 'ratio_lte')) {
    if (!p.baseline_arm?.trim()) {
      reject({ code: 'missing_baseline_arm', message: `comparator '${p.comparator}' requires prediction.baseline_arm` });
    } else if (p.baseline_arm === p.arm) {
      reject({ code: 'missing_baseline_arm', message: 'prediction.baseline_arm must differ from prediction.arm' });
    }
    if (isFiniteNum(p.value) && p.value <= 0) {
      reject({ code: 'invalid_prediction', message: 'ratio predictions require a positive ratio value' });
    }
  }
  if (!p || !isFiniteNum(p.confidence) || p.confidence < 0 || p.confidence > 1) {
    reject({ code: 'invalid_confidence', message: 'prediction.confidence must be in [0..1] — calibration (C-03) scores it' });
  }

  // FLOOR — the sample each arm needs before ANY verdict (§3).
  const floor = input.floorSpec;
  const floorFields: FloorField[] = [];
  if (!floor || !VALID_GRADES.includes(floor.metric_grade)) {
    reject({ code: 'invalid_floor', message: `floor_spec.metric_grade must be one of ${VALID_GRADES.join(', ')}` });
  }
  if (floor?.per_arm) {
    for (const f of FLOOR_FIELDS) {
      const v = floor.per_arm[f];
      if (v === undefined) continue;
      if (!isFiniteNum(v) || v <= 0) {
        reject({ code: 'invalid_floor', message: `floor_spec.per_arm.${f} must be a positive finite number` });
      } else {
        floorFields.push(f);
      }
    }
  }
  if (floorFields.length === 0) {
    reject({ code: 'invalid_floor', message: 'floor_spec.per_arm must set at least one positive floor — a floorless test can "conclude" on noise' });
  }

  // HORIZON — a test that can't end is a leak (§1).
  const h = input.horizon;
  const hasDays  = h?.max_days  !== undefined;
  const hasSpend = h?.max_spend !== undefined;
  if (!h || (!hasDays && !hasSpend)) {
    reject({ code: 'invalid_horizon', message: 'horizon must set max_days and/or max_spend — a test that cannot end is a leak' });
  }
  if (hasDays && (!isFiniteNum(h.max_days) || h.max_days <= 0)) {
    reject({ code: 'invalid_horizon', message: 'horizon.max_days must be a positive finite number' });
  }
  if (hasSpend && (!isFiniteNum(h.max_spend) || h.max_spend <= 0)) {
    reject({ code: 'invalid_horizon', message: 'horizon.max_spend must be a positive finite number' });
  }

  // VERDICT MAP — which atoms move on each verdict, frozen at launch.
  const vm = input.verdictMap;
  if (!vm || !Array.isArray(vm.supported) || !Array.isArray(vm.refuted) || !Array.isArray(vm.inconclusive)) {
    reject({ code: 'invalid_verdict_map', message: 'verdict_map must declare supported / refuted / inconclusive move lists' });
  } else {
    if (vm.supported.length === 0 || vm.refuted.length === 0) {
      reject({ code: 'invalid_verdict_map', message: 'verdict_map.supported and .refuted must each move at least one atom — a test that cannot change belief should not run' });
    }
    const allMoves: VerdictAtomMove[] = [...vm.supported, ...vm.refuted, ...vm.inconclusive];
    for (const m of allMoves) {
      if (!m.insight_id?.trim() || !insightIds.includes(m.insight_id)) {
        reject({
          code:    'unknown_insight_ref',
          message: `verdict_map references insight ${m.insight_id || '(empty)'} which is not in insight_ids`,
        });
      }
      if (!VALID_POLARITIES.includes(m.polarity)) {
        reject({ code: 'invalid_verdict_map', message: `verdict_map move polarity must be positive|negative (got '${String(m.polarity)}')` });
      }
      if (!isFiniteNum(m.weight) || m.weight < 0 || m.weight > 1) {
        reject({ code: 'invalid_weight', message: `verdict_map move weight for ${m.insight_id} must be in [0..1]` });
      }
    }
  }

  // KILL RULES — optional, but when declared they must be executable.
  const kr = input.killRules;
  if (kr?.mercy) {
    if (!isFiniteNum(kr.mercy.min_floor_multiple) || kr.mercy.min_floor_multiple < 1) {
      reject({ code: 'invalid_kill_rules', message: 'kill_rules.mercy.min_floor_multiple must be >= 1 (mercy never fires below the floor)' });
    }
    if (!isFiniteNum(kr.mercy.max_fraction_of_leader) || kr.mercy.max_fraction_of_leader <= 0 || kr.mercy.max_fraction_of_leader >= 1) {
      reject({ code: 'invalid_kill_rules', message: 'kill_rules.mercy.max_fraction_of_leader must be in (0..1)' });
    }
  }
  if (kr?.catastrophic) {
    if (!isFiniteNum(kr.catastrophic.spend_multiple) || kr.catastrophic.spend_multiple <= 0) {
      reject({ code: 'invalid_kill_rules', message: 'kill_rules.catastrophic.spend_multiple must be positive' });
    }
    if (!isFiniteNum(kr.catastrophic.expected_cost_per_result) || kr.catastrophic.expected_cost_per_result <= 0) {
      reject({ code: 'invalid_kill_rules', message: 'kill_rules.catastrophic.expected_cost_per_result must be positive' });
    }
  }

  // TEST REFS — when arms are wired, the predicted arms must exist among them.
  if (Array.isArray(input.testRefs) && input.testRefs.length > 0 && p) {
    const labels = new Set(input.testRefs.map((t) => t.arm_label));
    if (p.arm?.trim() && !labels.has(p.arm)) {
      reject({ code: 'arm_not_in_test_refs', message: `prediction.arm '${p.arm}' is not among test_refs arm labels` });
    }
    if (p.baseline_arm?.trim() && !labels.has(p.baseline_arm)) {
      reject({ code: 'arm_not_in_test_refs', message: `prediction.baseline_arm '${p.baseline_arm}' is not among test_refs arm labels` });
    }
  }

  // RESOLVABILITY (§7) — only meaningful once floor + horizon are structurally
  // valid; a broken floor already rejected above would make the math noise.
  if (input.budgetPlan && reasons.every((r) => r.code !== 'invalid_floor' && r.code !== 'invalid_horizon')) {
    validateResolvability(input.budgetPlan, floorFields, input, reject);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/**
 * The "don't launch unresolvable tests" arithmetic: per-arm spend over the
 * horizon = min(daily_budget × max_days, max_spend) / arm_count; each floored
 * quantity is projected through its expected unit cost and must reach the
 * floor. A floor we cannot project (missing unit cost) is a rejection too —
 * "we didn't check" is not a launch condition.
 */
function validateResolvability(
  plan:        BudgetPlan,
  floorFields: FloorField[],
  input:       RegisterHypothesisInput,
  reject:      (r: RegistrationRejection) => void,
): void {
  if (!isFiniteNum(plan.daily_budget) || plan.daily_budget <= 0) {
    reject({ code: 'invalid_budget_plan', message: 'budget_plan.daily_budget must be positive' });
    return;
  }
  if (!isFiniteNum(plan.arm_count) || !Number.isInteger(plan.arm_count) || plan.arm_count < 1) {
    reject({ code: 'invalid_budget_plan', message: 'budget_plan.arm_count must be a positive integer' });
    return;
  }

  const days     = isFiniteNum(input.horizon.max_days)  ? input.horizon.max_days  : Infinity;
  const spendCap = isFiniteNum(input.horizon.max_spend) ? input.horizon.max_spend : Infinity;
  const totalSpend = Math.min(plan.daily_budget * days, spendCap);
  if (!Number.isFinite(totalSpend)) return; // horizon already rejected upstream
  const perArmSpend = totalSpend / plan.arm_count;

  for (const field of floorFields) {
    const required = input.floorSpec.per_arm[field];
    if (!isFiniteNum(required)) continue;

    const costKey  = UNIT_COST_FOR_FLOOR[field];
    const unitCost = plan[costKey];
    if (!isFiniteNum(unitCost) || unitCost <= 0) {
      reject({
        code:    'unprojectable_floor',
        message: `floor on ${field} cannot be projected — budget_plan.${costKey} is missing; supply it or drop the floor`,
        detail:  { floor_field: field, required, missing_unit_cost: costKey },
      });
      continue;
    }

    const projected = field === 'impressions'
      ? (perArmSpend / unitCost) * 1000
      : perArmSpend / unitCost;

    if (projected < required) {
      reject({
        code:    'unresolvable_at_budget',
        message:
          `unresolvable at this budget: ₪${round2(perArmSpend)}/arm over the horizon at ` +
          `₪${unitCost}/${field === 'impressions' ? '1000 impressions' : field.replace(/s$/, '')} projects ` +
          `~${round2(projected)} ${field} < floor of ${required} — redesign, pool, or do not launch`,
        detail: {
          floor_field:       field,
          required,
          projected:         round2(projected),
          per_arm_spend:     round2(perArmSpend),
          total_spend:       round2(totalSpend),
          arm_count:         plan.arm_count,
          [costKey]:         unitCost,
        },
      });
    }
  }
}

// ── floors ────────────────────────────────────────────────────────────────────

/**
 * How far one arm is toward its floor, as the MINIMUM ratio across all floored
 * quantities (an arm at 3× impressions but 0.5× conversions is at 0.5). Missing
 * or non-finite observations count as zero. Returns 0 for a floorless spec —
 * a floor that checks nothing must never read as "met".
 */
export function armFloorProgress(floor: FloorSpec, obs: ArmObservation): number {
  let progress = Infinity;
  for (const f of FLOOR_FIELDS) {
    const required = floor.per_arm[f];
    if (!isFiniteNum(required) || required <= 0) continue;
    const observed = obs[f];
    const o = isFiniteNum(observed) && observed >= 0 ? observed : 0;
    progress = Math.min(progress, o / required);
  }
  return progress === Infinity ? 0 : progress;
}

/**
 * §3 floor check: EVERY observed arm must reach the per-arm floor before any
 * verdict. Empty observations never meet a floor (nothing observed ≠ enough
 * observed).
 */
export function floorMet(floor: FloorSpec, observations: ArmObservation[]): boolean {
  if (observations.length === 0) return false;
  return observations.every((obs) => armFloorProgress(floor, obs) >= 1);
}

// ── prediction evaluation ─────────────────────────────────────────────────────

/** Read one named metric off an arm's observations; non-finite → absent. */
function metricOf(obs: ArmObservation | undefined, metric: string): number | null {
  const v = obs?.metrics?.[metric];
  return isFiniteNum(v) ? v : null;
}

/**
 * Evaluate the FROZEN prediction against observations. Pure comparator math;
 * every unanswerable case (missing arm, missing/non-finite metric, undefined
 * ratio) is an explicit 'inconclusive' with a reason — never NaN, never a
 * guess. Effect boundaries are inclusive: observed == threshold satisfies gte.
 */
export function evaluatePrediction(
  prediction:   Prediction,
  observations: ArmObservation[],
): PredictionEvaluation {
  const arm = observations.find((o) => o.arm === prediction.arm);
  if (!arm) {
    return { verdict: 'inconclusive', reason: `arm '${prediction.arm}' has no observations` };
  }
  const observed = metricOf(arm, prediction.metric);
  if (observed === null) {
    return { verdict: 'inconclusive', reason: `metric '${prediction.metric}' is missing or non-finite for arm '${prediction.arm}'` };
  }

  switch (prediction.comparator) {
    case 'gte':
    case 'lte': {
      const holds = prediction.comparator === 'gte' ? observed >= prediction.value : observed <= prediction.value;
      return {
        verdict:  holds ? 'supported' : 'refuted',
        observed,
        reason:   `${prediction.metric}(${prediction.arm})=${observed} ${prediction.comparator} ${prediction.value} → ${holds ? 'holds' : 'fails'}`,
      };
    }
    case 'ratio_gte':
    case 'ratio_lte': {
      if (!prediction.baseline_arm) {
        return { verdict: 'inconclusive', reason: `comparator '${prediction.comparator}' has no baseline_arm registered` };
      }
      const baseObs = observations.find((o) => o.arm === prediction.baseline_arm);
      if (!baseObs) {
        return { verdict: 'inconclusive', reason: `baseline arm '${prediction.baseline_arm}' has no observations` };
      }
      const baseline = metricOf(baseObs, prediction.metric);
      if (baseline === null) {
        return { verdict: 'inconclusive', reason: `metric '${prediction.metric}' is missing or non-finite for baseline arm '${prediction.baseline_arm}'` };
      }
      if (baseline <= 0) {
        return { verdict: 'inconclusive', reason: `baseline ${prediction.metric}(${prediction.baseline_arm})=${baseline} — ratio is undefined at a zero/negative baseline` };
      }
      const ratio = observed / baseline;
      if (!Number.isFinite(ratio)) {
        return { verdict: 'inconclusive', reason: 'observed ratio is not finite' };
      }
      const holds = prediction.comparator === 'ratio_gte' ? ratio >= prediction.value : ratio <= prediction.value;
      return {
        verdict:  holds ? 'supported' : 'refuted',
        observed: ratio,
        reason:
          `${prediction.metric}(${prediction.arm})/${prediction.metric}(${prediction.baseline_arm})=` +
          `${round2(ratio)} ${prediction.comparator === 'ratio_gte' ? '>=' : '<='} ${prediction.value} → ${holds ? 'holds' : 'fails'}`,
      };
    }
  }
}

// ── resolution ────────────────────────────────────────────────────────────────

/** JSONB-safe snapshot of observations: non-finite numbers become null. */
function snapshotObservations(observations: ArmObservation[]): Record<string, unknown> {
  const byArm: Record<string, unknown> = {};
  for (const o of observations) {
    const metrics: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(o.metrics ?? {})) metrics[k] = isFiniteNum(v) ? v : null;
    byArm[o.arm] = {
      impressions:  isFiniteNum(o.impressions)  ? o.impressions  : null,
      clicks:       isFiniteNum(o.clicks)       ? o.clicks       : null,
      conversions:  isFiniteNum(o.conversions)  ? o.conversions  : null,
      marked_leads: isFiniteNum(o.marked_leads) ? o.marked_leads : null,
      metrics,
    };
  }
  return byArm;
}

/**
 * The verdict function (§6 honesty checklist, mechanized):
 *   floor unmet → 'inconclusive' with the verdict_map.inconclusive moves
 *   (conventionally none); floor met → evaluate the frozen prediction →
 *   'supported' | 'refuted' (or 'inconclusive' when the metric itself is
 *   unreadable). Atom moves come EXCLUSIVELY from the frozen verdict_map.
 *
 * `resolvedBy` defaults per floor state: a floor-met resolution is the normal
 * 'floor_met' path; resolving BELOW the floor only legitimately happens when a
 * horizon forces it, so that default is 'horizon_forced'. Kill paths pass
 * their own value explicitly.
 */
export function resolve(
  hypothesis:   Pick<HypothesisRow, 'prediction' | 'floor_spec' | 'verdict_map'>,
  observations: ArmObservation[],
  now:          Date,
  resolvedBy?:  HypothesisResolution['resolved_by'],
): ResolveOutcome {
  const observed = snapshotObservations(observations);
  const met = floorMet(hypothesis.floor_spec, observations);

  if (!met) {
    const atomMoves = hypothesis.verdict_map.inconclusive ?? [];
    return {
      status: 'inconclusive',
      resolution: {
        observed,
        verdict_reason: `sample floor unmet at ${now.toISOString()} — no verdict is allowed to touch the brain`,
        resolved_by:    resolvedBy ?? 'horizon_forced',
      },
      atomMoves,
    };
  }

  const evaluation = evaluatePrediction(hypothesis.prediction, observations);
  const atomMoves  = hypothesis.verdict_map[evaluation.verdict] ?? [];
  return {
    status: evaluation.verdict,
    resolution: {
      observed,
      verdict_reason: `floor met; ${evaluation.reason}`,
      resolved_by:    resolvedBy ?? 'floor_met',
    },
    atomMoves,
  };
}

// ── kill rules ────────────────────────────────────────────────────────────────

/**
 * §4 early stopping, evidence-blind by construction (the function cannot see
 * sunk cost or authorship — it only receives observations and spend):
 *   1. catastrophic — spend ≥ multiple × expected cost-per-result with ZERO
 *      results → kill the arm immediately, regardless of floor.
 *   2. mercy — an arm at ≥ min_floor_multiple× its floor performing below
 *      max_fraction_of_leader of the leading arm → kill it, reallocate.
 *   3. horizon — past max_days / max_spend → force-resolve (the caller runs
 *      `resolve`, which yields inconclusive-or-verdict per the floor state).
 * Checked in that order (a broken arm outranks a slow test); boundaries are
 * inclusive for "enough sample / enough spend / horizon reached" and STRICT
 * for "worse than the fraction", exactly as the craft states them (≥2× floor,
 * <50% of leader, ≥3× expected CPA).
 */
export function checkKillRules(
  hypothesis:   Pick<HypothesisRow, 'kill_rules' | 'floor_spec' | 'horizon' | 'registered_at'>,
  observations: ArmObservation[],
  spendByArm:   Record<string, number>,
  now:          Date,
): KillAction | null {
  const { kill_rules: rules, floor_spec: floor, horizon } = hypothesis;

  // 1) catastrophic — includes arms that have spend but no observation row yet
  //    (zero ingested results IS the failure mode this rule exists for).
  if (rules.catastrophic) {
    const threshold = rules.catastrophic.spend_multiple * rules.catastrophic.expected_cost_per_result;
    const resultField = RESULT_FIELD_FOR_GRADE[floor.metric_grade];
    const arms = new Set<string>([...observations.map((o) => o.arm), ...Object.keys(spendByArm)]);
    for (const arm of arms) {
      const spend = spendByArm[arm];
      if (!isFiniteNum(spend) || spend < threshold) continue;
      const obs = observations.find((o) => o.arm === arm);
      const raw = obs?.[resultField];
      const results = isFiniteNum(raw) && raw > 0 ? raw : 0;
      if (results === 0) {
        return {
          kind: 'kill_arm', rule: 'catastrophic', arm,
          reason: `spend ₪${round2(spend)} ≥ ${rules.catastrophic.spend_multiple}× expected ₪${rules.catastrophic.expected_cost_per_result}/result with zero ${resultField} — something is broken, pause before diagnosing`,
          detail: { spend, threshold, results: 0 },
        };
      }
    }
  }

  // 2) mercy — compare arms on the registered floor grade only.
  if (rules.mercy && observations.length >= 2) {
    const grade = floor.metric_grade;
    const lowerBetter = LOWER_IS_BETTER.has(grade);
    // Zero performance is a legitimate (killable) reading for rate metrics,
    // but a zero/negative COST metric is a data error, and a zero leader makes
    // "fraction of leader" meaningless — those cases just skip the rule.
    const scored = observations
      .map((o) => ({ arm: o.arm, perf: metricOf(o, grade), progress: armFloorProgress(floor, o) }))
      .filter((s): s is { arm: string; perf: number; progress: number } =>
        s.perf !== null && (lowerBetter ? s.perf > 0 : s.perf >= 0));

    const leader = scored.length >= 2
      ? scored.reduce((best, s) => ((lowerBetter ? s.perf < best.perf : s.perf > best.perf) ? s : best))
      : null;

    if (leader && leader.perf > 0) {
      let worst: (KillAction & { rule: 'mercy' }) | null = null; // if several qualify, kill the worst first
      for (const s of scored) {
        if (s.arm === leader.arm) continue;
        if (s.progress < rules.mercy.min_floor_multiple) continue; // not enough sample to be merciful about
        const relative = lowerBetter ? leader.perf / s.perf : s.perf / leader.perf;
        if (relative < rules.mercy.max_fraction_of_leader) {
          const candidate: KillAction & { rule: 'mercy' } = {
            kind: 'kill_arm', rule: 'mercy', arm: s.arm,
            reason: `arm '${s.arm}' is at ${round2(s.progress)}× floor with ${grade} ${round2(relative * 100)}% of leader '${leader.arm}' (< ${rules.mercy.max_fraction_of_leader * 100}%) — kill early, reallocate to survivors`,
            detail: {
              floor_progress:         s.progress,
              performance:            s.perf,
              leader_arm:             leader.arm,
              leader_performance:     leader.perf,
              relative_performance:   relative,
              max_fraction_of_leader: rules.mercy.max_fraction_of_leader,
            },
          };
          if (!worst || candidate.detail.relative_performance < worst.detail.relative_performance) worst = candidate;
        }
      }
      if (worst) return worst;
    }
  }

  // 3) horizon — no zombie tests: at the horizon, force a resolution.
  const registeredMs = Date.parse(hypothesis.registered_at);
  const daysElapsed  = Number.isFinite(registeredMs) ? (now.getTime() - registeredMs) / 86_400_000 : undefined;
  const totalSpend   = Object.values(spendByArm).reduce((sum, v) => sum + (isFiniteNum(v) ? v : 0), 0);

  if (isFiniteNum(horizon.max_days) && daysElapsed !== undefined && daysElapsed >= horizon.max_days) {
    return {
      kind: 'force_resolve', rule: 'horizon',
      reason: `horizon reached: ${round2(daysElapsed)} days ≥ max_days ${horizon.max_days} — force a verdict; extension after peeking is p-hacking`,
      detail: { days_elapsed: round2(daysElapsed), max_days: horizon.max_days },
    };
  }
  if (isFiniteNum(horizon.max_spend) && totalSpend >= horizon.max_spend) {
    return {
      kind: 'force_resolve', rule: 'horizon',
      reason: `horizon reached: total spend ₪${round2(totalSpend)} ≥ max_spend ₪${horizon.max_spend} — force a verdict`,
      detail: { total_spend: round2(totalSpend), max_spend: horizon.max_spend },
    };
  }

  return null;
}
