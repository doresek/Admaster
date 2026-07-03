// lib/hypotheses/from-decision.ts
//
// The decision→hypothesis bridge (spec C-01 wire-in; VISION-DEEP §8.2.6
// "pre-registration"). Every MarketingDecision the runner executes is ALSO a
// falsifiable bet about the atoms that grounded it — this module states that
// bet as a pre-registered hypothesis BEFORE the campaign runs, so the verdict
// is later computed against criteria frozen at launch, not narrated after.
//
// PURE: consumes the decision (types-only dependency on the decision engine),
// produces a RegisterHypothesisInput. Persistence stays in store.ts; the
// runner injects the registrar.
import type { MarketingDecision } from '@/lib/decision-engine/types';
import type { FloorSpec, Prediction, VerdictMap } from '@/lib/capability-contracts';
import type { RegisterHypothesisInput } from './types';

/** The single arm a one-decision campaign tests. */
export const CAMPAIGN_ARM = 'campaign';

/**
 * Honest per-metric priors used as the prediction threshold when no client
 * baseline exists yet. Band midpoints for IL SMB Meta traffic — PRIORS, not
 * laws (C-12 live benchmarks replace them); stated so the first campaigns
 * resolve against a real number instead of nothing.
 */
export const DEFAULT_METRIC_FLOOR: Record<'ctr' | 'cvr', number> = {
  ctr: 0.012,
  cvr: 0.03,
};

/**
 * Registrant belief that a freshly-decided angle clears the prior threshold.
 * POLICY until decide() emits belief strength: mildly optimistic (the decision
 * engine only proposes angles its atoms support) but far from certain — this
 * is exactly the number calibration (C-03) will grade and correct.
 */
export const DEFAULT_DECISION_CONFIDENCE = 0.6;

/**
 * Atom-move weights frozen into the verdict map. Deliberately asymmetric and
 * BELOW the lifecycle's decisive threshold (0.70): one campaign's performance
 * corroborates meaningfully (0.4) but can only WEAKEN, never single-handedly
 * refute, the beliefs behind it (0.3) — the creative-testing craft's
 * "single-test evidence is weak evidence" discipline, mechanized.
 */
export const SUPPORTED_WEIGHT = 0.4;
export const REFUTED_WEIGHT   = 0.3;

const DEFAULT_HORIZON_DAYS = 14;

/** Objectives whose success is measured past the click (cvr-grade). */
const CVR_OBJECTIVES: ReadonlySet<string> = new Set(['leads', 'conversions', 'messages']);

/** Map a decision objective to the metric grade + sample floor it needs. */
export function metricForObjective(objective: string): { metric: 'ctr' | 'cvr'; floor: FloorSpec } {
  if (CVR_OBJECTIVES.has(objective)) {
    return { metric: 'cvr', floor: { metric_grade: 'cvr', per_arm: { clicks: 100 } } };
  }
  return { metric: 'ctr', floor: { metric_grade: 'ctr', per_arm: { impressions: 1000 } } };
}

export interface HypothesisFromDecisionParams {
  clientId:    string;
  ownerUserId: string;
  decision:    MarketingDecision;
  /** campaign_item id of the assembled ad/post, when persistence produced one. */
  campaignItemId?: string | null;
}

/**
 * State the decision's bet as a pre-registered hypothesis.
 *
 * The CLAIM is the angle bet in plain Hebrew; the PREDICTION is single-arm
 * against the honest prior for the objective's metric grade; the VERDICT MAP
 * moves exactly the atoms the decision was grounded in (supported corroborates
 * at 0.4, refuted weakens at 0.3 — see the weight rationale above). Kill rules
 * are left empty by design: runtime kills belong to the reflex tier /
 * heartbeat, not to a pre-launch registration.
 *
 * Degenerate decisions (no grounded atoms) return null — an ungrounded bet
 * cannot move any belief, so registering it would be theater; the caller
 * records the gap instead.
 */
export function hypothesisFromDecision(params: HypothesisFromDecisionParams): RegisterHypothesisInput | null {
  const { clientId, ownerUserId, decision } = params;
  if (decision.grounded_in.length === 0) return null;

  const { metric, floor } = metricForObjective(decision.objective);

  const prediction: Prediction = {
    metric,
    comparator: 'gte',
    value: DEFAULT_METRIC_FLOOR[metric],
    arm: CAMPAIGN_ARM,
    confidence: DEFAULT_DECISION_CONFIDENCE,
  };

  const verdictMap: VerdictMap = {
    supported: decision.grounded_in.map((insightId) => ({
      insight_id: insightId, polarity: 'positive' as const, weight: SUPPORTED_WEIGHT,
    })),
    refuted: decision.grounded_in.map((insightId) => ({
      insight_id: insightId, polarity: 'negative' as const, weight: REFUTED_WEIGHT,
    })),
    inconclusive: [],
  };

  return {
    clientId,
    ownerUserId,
    insightIds: decision.grounded_in,
    claim:
      `הזווית "${decision.angle}" תשיג לפחות ${metric.toUpperCase()} ` +
      `${DEFAULT_METRIC_FLOOR[metric]} עבור "${decision.sub_audience}" ` +
      `(${decision.funnel_stage}, יעד ${decision.objective})`,
    prediction,
    floorSpec: floor,
    horizon: { max_days: DEFAULT_HORIZON_DAYS },
    verdictMap,
    killRules: {},
    testRefs: [{ arm_label: CAMPAIGN_ARM, campaign_item_id: params.campaignItemId ?? undefined }],
    domain: 'angle',
  };
}
