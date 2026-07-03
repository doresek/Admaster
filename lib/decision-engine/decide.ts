// lib/decision-engine/decide.ts
//
// THE decision. Turn the living client understanding into ONE concrete
// marketing decision, INSIGHT-DRIVEN end to end:
//   • angle        ← highest-confidence bridge angle / value_translation atom
//   • sub_audience ← highest-confidence customers persona (else pain/desire)
//   • targeting    ← customers-layer atoms (see audience.ts)
//   • platform     ← bridge platform atom, mapped to a supported platform
//   • objective +
//     funnel_stage ← the customer's Schwartz awareness level
//   • daily_budget ← funnel stage + angle confidence (see budget.ts)
//
// Every choice records the atom ids it drew from in `grounded_in` and explains
// itself (citing the atom + its confidence) in `rationale`. PURE: data in →
// decision out, no DB/LLM/network. An optional `refine` hook lets a caller layer
// LLM polish on top WITHOUT touching the deterministic core (default = identity).
import type {
  DecideInput,
  FunnelStage,
  Insight,
  MarketingDecision,
  Platform,
  StrategyAnalysis,
} from './types';
import { deriveTargeting } from './audience';
import { recommendBudget } from './budget';
import { top, pick, preview, conf } from './select';

/** Schwartz awareness level → funnel stage + objective. */
export const AWARENESS_TO_FUNNEL: Record<string, { stage: FunnelStage; objective: string }> = {
  'unaware':        { stage: 'TOFU', objective: 'awareness' },
  'problem-aware':  { stage: 'TOFU', objective: 'engagement' },
  'solution-aware': { stage: 'MOFU', objective: 'traffic' },
  'product-aware':  { stage: 'BOFU', objective: 'conversions' },
  'most-aware':     { stage: 'BOFU', objective: 'sales' },
};

const DEFAULT_FUNNEL: { stage: FunnelStage; objective: string } = {
  // With no awareness signal, open the funnel: TOFU engagement is the safe
  // exploratory default.
  stage: 'TOFU',
  objective: 'engagement',
};

const PLACEMENTS: Record<Platform, string[]> = {
  facebook:  ['facebook_feed', 'facebook_stories', 'facebook_reels'],
  instagram: ['instagram_feed', 'instagram_stories', 'instagram_reels'],
  whatsapp:  ['whatsapp_status', 'click_to_whatsapp'],
};

const DEFAULT_PLATFORM: Platform = 'instagram';

/** Map a free-text platform atom to a supported platform. */
export function resolvePlatform(text: string | undefined): Platform | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/(whatsapp|וואטסאפ|וואצאפ|ואטסאפ)/.test(t)) return 'whatsapp';
  if (/(instagram|insta|אינסטגרם|אינסטה|reels|ריל|story|סטורי)/.test(t)) return 'instagram';
  if (/(facebook|fb|פייסבוק|פייס)/.test(t)) return 'facebook';
  return undefined;
}

/** Normalize an awareness atom's content to a canonical Schwartz key. */
export function resolveAwarenessKey(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/most[\s-]*aware|הכי מודע|מודע ביותר/.test(t)) return 'most-aware';
  if (/product[\s-]*aware|מודע למוצר/.test(t)) return 'product-aware';
  if (/solution[\s-]*aware|מודע לפתרון/.test(t)) return 'solution-aware';
  if (/problem[\s-]*aware|מודע לבעיה/.test(t)) return 'problem-aware';
  if (/unaware|לא מודע|חוסר מודעות/.test(t)) return 'unaware';
  return undefined;
}

/** Optional LLM-refinement hook. The default is a pure identity (no-op). */
export type DecisionRefiner = (
  decision: MarketingDecision,
  ctx: { input: DecideInput },
) => MarketingDecision;

const identityRefiner: DecisionRefiner = (d) => d;

/**
 * Produce a MarketingDecision from the client's living understanding.
 * Deterministic; `opts.refine` (default identity) is the only seam for non-pure
 * augmentation, so tests cover the pure path with no injection.
 */
export function decide(
  input: DecideInput,
  opts: { refine?: DecisionRefiner } = {},
): MarketingDecision {
  const insights = input.insights ?? [];
  const strategy = input.strategy ?? null;
  const grounded = new Set<string>();
  const why: string[] = [];

  // ── angle: highest-confidence bridge angle, else value_translation ─────────
  const angleAtom = top(insights, 'bridge', ['angle']) ?? top(insights, 'bridge', ['value_translation']);
  let angle: string;
  if (angleAtom) {
    angle = angleAtom.content.trim();
    grounded.add(angleAtom.id);
    why.push(`Angle from bridge ${angleAtom.kind} atom (conf ${conf(angleAtom.confidence)}): "${preview(angle)}".`);
  } else {
    angle = strategyFallback(strategy, (s) => s.platform_funnel.ad_format) || 'Lead with the core value proposition';
    why.push('No bridge angle atom; fell back to strategy/default angle.');
  }

  // ── sub-audience: persona, else top pain/desire ────────────────────────────
  const personaAtom =
    top(insights, 'customers', ['persona']) ??
    top(insights, 'customers', ['pain', 'desire', 'aspiration']);
  let sub_audience: string;
  if (personaAtom) {
    sub_audience = personaAtom.content.trim();
    grounded.add(personaAtom.id);
    why.push(`Sub-audience from customers ${personaAtom.kind} atom (conf ${conf(personaAtom.confidence)}): "${preview(sub_audience)}".`);
  } else {
    sub_audience = strategyFallback(strategy, (s) => s.sub_audience.name) || 'Core audience';
    why.push('No customers persona/pain atom; fell back to strategy/default sub-audience.');
  }

  // ── awareness → funnel stage + objective ───────────────────────────────────
  const awarenessAtom = top(insights, 'customers', ['awareness']);
  const awarenessKey = resolveAwarenessKey(
    awarenessAtom?.content ?? strategy?.sub_audience?.awareness_level,
  );
  const funnel = (awarenessKey && AWARENESS_TO_FUNNEL[awarenessKey]) || DEFAULT_FUNNEL;
  const funnel_stage = funnel.stage;
  const objective = funnel.objective;
  if (awarenessAtom && awarenessKey) {
    grounded.add(awarenessAtom.id);
    why.push(`Awareness "${awarenessKey}" (conf ${conf(awarenessAtom.confidence)}) ⇒ ${funnel_stage} / objective "${objective}".`);
  } else {
    why.push(`No usable awareness atom ⇒ default ${funnel_stage} / objective "${objective}".`);
  }

  // ── platform + placement ───────────────────────────────────────────────────
  const platformAtom = top(insights, 'bridge', ['platform']);
  const platform: Platform =
    resolvePlatform(platformAtom?.content) ??
    resolvePlatform(strategy?.platform_funnel?.platform) ??
    DEFAULT_PLATFORM;
  if (platformAtom && resolvePlatform(platformAtom.content)) {
    grounded.add(platformAtom.id);
    why.push(`Platform "${platform}" from bridge platform atom (conf ${conf(platformAtom.confidence)}).`);
  } else {
    why.push(`No bridge platform atom resolved; using "${platform}".`);
  }
  const placement = PLACEMENTS[platform];

  // ── targeting (customers-layer derived) ────────────────────────────────────
  const targeting = deriveTargeting(insights, { client: input.client, awareness: awarenessAtom });
  targeting.grounded_in.forEach((id) => grounded.add(id));
  why.push(...targeting.rationale);

  // ── budget ──────────────────────────────────────────────────────────────────
  const angleConfidence = angleAtom?.confidence ?? 0.5;
  const budget = recommendBudget({ funnelStage: funnel_stage, angleConfidence, client: input.client });
  why.push(budget.rationale);

  const decision: MarketingDecision = {
    angle,
    sub_audience,
    targeting_spec: targeting.spec,
    platform,
    placement,
    objective,
    funnel_stage,
    daily_budget: budget.daily_budget,
    grounded_in: [...grounded],
    rationale: why.join(' '),
  };

  return (opts.refine ?? identityRefiner)(decision, { input });
}

/** Safely read a strategy snapshot field, tolerating a null strategy. */
function strategyFallback(
  strategy: StrategyAnalysis | null,
  get: (s: StrategyAnalysis) => string | undefined,
): string {
  if (!strategy) return '';
  try {
    return (get(strategy) ?? '').trim();
  } catch {
    return '';
  }
}

// Re-export so the orchestrator can introspect kinds it grounded in if needed.
export { pick };
