// lib/decision-engine/diagnose.ts
//
// Diagnose WHY a creative failed by mapping metric patterns to the broken
// marketing LINK — but INTERPRETED THROUGH the living insights, never metric-
// blind. The same numbers mean different things depending on what we believe:
//   • good CTR + dead conversions + an UNRESOLVED objection atom ⇒ OFFER failed
//     (the message landed, the offer didn't answer the objection) — NOT creative.
//   • good CTR + dead conversions + NO objection signal           ⇒ FUNNEL leak.
//   • high impressions + low CTR                                  ⇒ HOOK (else creative).
//   • one avatar underperforms across multiple hooks              ⇒ AVATAR mismatch.
//   • saturation (high frequency, fading CTR)                     ⇒ AUDIENCE.
//
// Pure + deterministic. `recommended_action` is a structured next move.
import type {
  Diagnosis,
  DiagnoseInput,
  FailedLink,
  Insight,
  PerformanceMetrics,
  VariantMetrics,
} from './types';
import { pick, top, activeInsights, preview, conf } from './select';

export const DIAGNOSIS_THRESHOLDS = {
  /** Below this impression count we don't have enough data to judge. */
  MIN_IMPRESSIONS: 1000,
  /** CTR (fraction) at/above which the hook is considered to be working. */
  HEALTHY_CTR: 0.01,
  /** Conversion rate (fraction) at/above which conversion is considered healthy. */
  HEALTHY_CONVERSION_RATE: 0.01,
  /** Frequency at/above which the audience is considered saturated. */
  FREQUENCY_CEILING: 3.5,
  /** A variant is "underperforming" when its CTR is below this ratio of peers'. */
  AVATAR_UNDERPERFORM_RATIO: 0.5,
  /** Distinct hooks an avatar must underperform across to flag the AVATAR link. */
  AVATAR_MIN_HOOKS: 2,
} as const;

/** Derive ctr / conversion_rate from raw counts when not given explicitly. */
function normalizeMetrics(m: PerformanceMetrics): Required<Pick<PerformanceMetrics, 'impressions'>> & {
  ctr: number | undefined;
  conversionRate: number | undefined;
} {
  const impressions = m.impressions ?? 0;
  const ctr =
    m.ctr ??
    (m.clicks !== undefined && impressions > 0 ? m.clicks / impressions : undefined);
  const conversionRate =
    m.conversion_rate ??
    (m.conversions !== undefined && m.clicks ? m.conversions / m.clicks : undefined);
  return { impressions, ctr, conversionRate };
}

/** Variant CTR, derived if needed. */
function variantCtr(v: VariantMetrics): number | undefined {
  if (v.ctr !== undefined) return v.ctr;
  if (v.clicks !== undefined && v.impressions) return v.clicks / v.impressions;
  return undefined;
}

/**
 * Detect an avatar that underperforms across >= AVATAR_MIN_HOOKS distinct hooks.
 * Returns the losing avatar key when found.
 */
function findUnderperformingAvatar(variants: VariantMetrics[] | undefined): string | undefined {
  if (!variants || variants.length < 2) return undefined;

  const byAvatar = new Map<string, { ctrs: number[]; hooks: Set<string> }>();
  for (const v of variants) {
    const ctr = variantCtr(v);
    if (v.avatar === undefined || ctr === undefined) continue;
    const entry = byAvatar.get(v.avatar) ?? { ctrs: [], hooks: new Set<string>() };
    entry.ctrs.push(ctr);
    if (v.hook) entry.hooks.add(v.hook);
    byAvatar.set(v.avatar, entry);
  }
  if (byAvatar.size < 2) return undefined;

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const avatars = [...byAvatar.entries()].map(([avatar, e]) => ({
    avatar,
    mean: avg(e.ctrs),
    hooks: e.hooks.size,
  }));

  // Sort worst-first deterministically.
  avatars.sort((a, b) => (a.mean !== b.mean ? a.mean - b.mean : a.avatar.localeCompare(b.avatar)));
  const worst = avatars[0];
  const peers = avatars.slice(1);
  const peerMean = avg(peers.map((p) => p.mean));

  if (
    worst.hooks >= DIAGNOSIS_THRESHOLDS.AVATAR_MIN_HOOKS &&
    peerMean > 0 &&
    worst.mean < peerMean * DIAGNOSIS_THRESHOLDS.AVATAR_UNDERPERFORM_RATIO
  ) {
    return worst.avatar;
  }
  return undefined;
}

function result(
  failed_link: FailedLink,
  rationale: string,
  target_insight_ids: string[],
  recommended_action: Record<string, unknown>,
): Diagnosis {
  return { failed_link, rationale, target_insight_ids, recommended_action };
}

/**
 * Diagnose the failed link for an artifact given its performance + the active
 * insights. Deterministic; checks run in a fixed precedence so a single clear
 * verdict is returned.
 */
export function diagnoseFailure(input: DiagnoseInput): Diagnosis {
  const insights = activeInsights(input.insights ?? []);
  const m = input.performance?.metrics ?? {};
  const { impressions, ctr, conversionRate } = normalizeMetrics(m);
  const T = DIAGNOSIS_THRESHOLDS;

  // 0) Not enough data → no verdict.
  if (impressions < T.MIN_IMPRESSIONS) {
    return result(
      'none',
      `Only ${impressions} impressions (< ${T.MIN_IMPRESSIONS}); not enough data to diagnose — keep the test running.`,
      [],
      { action: 'gather_more_data', min_impressions: T.MIN_IMPRESSIONS },
    );
  }

  const ctrOk = ctr !== undefined && ctr >= T.HEALTHY_CTR;
  const ctrBad = ctr !== undefined && ctr < T.HEALTHY_CTR;
  const convBad = conversionRate !== undefined && conversionRate < T.HEALTHY_CONVERSION_RATE;

  // 1) AVATAR — one sub-audience loses across multiple hooks (interpreted via persona).
  const losingAvatar = findUnderperformingAvatar(m.variants);
  if (losingAvatar) {
    const personaAtoms = pick(insights, 'customers', ['persona']);
    const matched =
      personaAtoms.find((p) => p.content.toLowerCase().includes(losingAvatar.toLowerCase())) ??
      personaAtoms[0];
    const ids = matched ? [matched.id] : [];
    return result(
      'avatar',
      `Avatar "${losingAvatar}" underperformed across ${T.AVATAR_MIN_HOOKS}+ hooks while peers held up` +
        (matched ? `; persona atom (conf ${conf(matched.confidence)}) "${preview(matched.content)}" is the likely mismatch` : '') +
        ` ⇒ avatar link failed, not the hook.`,
      ids,
      { action: 'reframe_or_drop_avatar', avatar: losingAvatar, target_persona_ids: ids },
    );
  }

  // 2) HOOK / CREATIVE — lots of impressions, nobody clicks.
  if (ctrBad) {
    const hookAtom = top(insights, 'bridge', ['hook']) ?? top(insights, 'bridge', ['angle']);
    if (hookAtom) {
      return result(
        'hook',
        `${impressions} impressions but CTR ${(ctr! * 100).toFixed(2)}% < ${(T.HEALTHY_CTR * 100).toFixed(2)}% — the scroll isn't stopping. Hook atom (conf ${conf(hookAtom.confidence)}) "${preview(hookAtom.content)}" isn't landing ⇒ hook link failed.`,
        [hookAtom.id],
        { action: 'rewrite_hook', layer: 'bridge', kind: hookAtom.kind, target_insight_id: hookAtom.id },
      );
    }
    return result(
      'creative',
      `${impressions} impressions but CTR ${(ctr! * 100).toFixed(2)}% < ${(T.HEALTHY_CTR * 100).toFixed(2)}% and no bridge hook atom to point at ⇒ creative link failed; redesign the creative + opening line.`,
      [],
      { action: 'redesign_creative' },
    );
  }

  // 3) OFFER vs FUNNEL — they click, they don't convert.
  if (ctrOk && convBad) {
    const objection = top(insights, 'customers', ['objection']);
    if (objection) {
      return result(
        'offer',
        `CTR is fine (${(ctr! * 100).toFixed(2)}%) but conversions died (${(conversionRate! * 100).toFixed(2)}%), and objection atom "${preview(objection.content)}" (conf ${conf(objection.confidence)}) is still active ⇒ offer link failed; the creative is fine — the offer doesn't answer the objection.`,
        [objection.id],
        { action: 'address_objection', objection: objection.content, target_insight_id: objection.id },
      );
    }
    return result(
      'funnel',
      `CTR is fine (${(ctr! * 100).toFixed(2)}%) but conversions died (${(conversionRate! * 100).toFixed(2)}%) and no unresolved objection atom is active ⇒ funnel link failed; audit the landing page / lead form, not the creative.`,
      [],
      { action: 'audit_funnel', stage: input.artifact?.funnel_stage ?? null },
    );
  }

  // 4) AUDIENCE — saturation: healthy CTR but the audience is over-served.
  if (m.frequency !== undefined && m.frequency >= T.FREQUENCY_CEILING) {
    const personaAtom = top(insights, 'customers', ['persona']);
    const ids = personaAtom ? [personaAtom.id] : [];
    return result(
      'audience',
      `Frequency ${m.frequency} ≥ ${T.FREQUENCY_CEILING} — the audience is saturated` +
        (personaAtom ? `; expand/refresh beyond persona (conf ${conf(personaAtom.confidence)}) "${preview(personaAtom.content)}"` : '') +
        ` ⇒ audience link failed.`,
      ids,
      { action: 'expand_or_refresh_audience', frequency: m.frequency, target_persona_ids: ids },
    );
  }

  // 5) Nothing broke that we can pin down.
  return result(
    'none',
    `Metrics within healthy ranges (CTR ${ctr !== undefined ? (ctr * 100).toFixed(2) + '%' : 'n/a'}, conversion ${conversionRate !== undefined ? (conversionRate * 100).toFixed(2) + '%' : 'n/a'}); no failed link detected.`,
    [],
    { action: 'scale_or_hold' },
  );
}

// internal export for tests
export { findUnderperformingAvatar, normalizeMetrics };
export type { Insight };
