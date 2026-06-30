// lib/decision-engine/audience.ts
//
// Derive a TargetingSpec FROM the customers-layer atoms — never a preset.
//   • interests  ← desire / aspiration / dream / persona / pain atom content
//   • age/gender ← persona atom's `structured` blob when present, else sane defaults
//   • geo        ← client override, else a business `constraint` atom, else "IL"
//   • custom_audience_hint / lookalike_hint ← awareness level + persona strength
//
// Pure + deterministic; returns the spec plus the atom ids it was grounded in
// and human-readable rationale fragments.
import type { DecisionClientContext, Insight, TargetingSpec, Genders } from './types';
import { pick, top, structuredNumber, structuredString, preview, conf } from './select';

export const TARGETING_DEFAULTS = {
  GEO:        'IL',
  AGE_MIN:    25,
  AGE_MAX:    55,
  GENDERS:    'all' as Genders,
  MAX_INTERESTS: 6,
  /** Persona confidence at/above which we suggest a lookalike seed. */
  LOOKALIKE_CONFIDENCE: 0.6,
} as const;

export interface TargetingResult {
  spec:        TargetingSpec;
  grounded_in: string[];
  rationale:   string[];
}

const GENDER_VALUES: ReadonlySet<string> = new Set(['all', 'male', 'female']);

function normalizeGenders(raw: string | undefined): Genders | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase().trim();
  if (GENDER_VALUES.has(v)) return v as Genders;
  if (/(women|female|נשים|נשי)/.test(v)) return 'female';
  if (/(men|male|גברים|גברי)/.test(v)) return 'male';
  return undefined;
}

/**
 * Build the audience definition from the customers-layer atoms.
 * `awareness` is the active awareness atom (passed by decide so it isn't
 * re-selected) — it informs the custom-audience / lookalike strategy.
 */
export function deriveTargeting(
  insights: Insight[],
  opts: { client?: DecisionClientContext | null; awareness?: Insight } = {},
): TargetingResult {
  const grounded = new Set<string>();
  const rationale: string[] = [];

  // ── interests: seed phrases pulled from the customers' wants ───────────────
  const interestAtoms = pick(insights, 'customers', [
    'desire', 'aspiration', 'dream', 'persona', 'pain', 'unspoken_want',
  ]).slice(0, TARGETING_DEFAULTS.MAX_INTERESTS);

  const interests: string[] = [];
  for (const a of interestAtoms) {
    const seed = preview(a.content, 60);
    if (seed && !interests.includes(seed)) {
      interests.push(seed);
      grounded.add(a.id);
    }
  }
  if (interests.length) {
    rationale.push(
      `Interests seeded from ${interestAtoms.length} customers-layer atoms (e.g. "${interests[0]}").`,
    );
  } else {
    rationale.push('No customers-layer want atoms — interests left for broad/lookalike targeting.');
  }

  // ── persona → age / gender ─────────────────────────────────────────────────
  const persona = top(insights, 'customers', ['persona']);
  const age_min = structuredNumber(persona, 'age_min') ?? TARGETING_DEFAULTS.AGE_MIN;
  const age_max = structuredNumber(persona, 'age_max') ?? TARGETING_DEFAULTS.AGE_MAX;
  const genders =
    normalizeGenders(structuredString(persona, 'genders') ?? structuredString(persona, 'gender')) ??
    TARGETING_DEFAULTS.GENDERS;
  if (persona) {
    grounded.add(persona.id);
    rationale.push(
      `Age/gender from persona atom (conf ${conf(persona.confidence)}): "${preview(persona.content)}".`,
    );
  }

  // ── geo: client override → business constraint atom → default ──────────────
  let geo = TARGETING_DEFAULTS.GEO as string;
  if (opts.client?.default_geo && opts.client.default_geo.trim()) {
    geo = opts.client.default_geo.trim();
    rationale.push(`Geo from client context: ${geo}.`);
  } else {
    const geoConstraint = pick(insights, 'business', ['constraint']).find((a) =>
      /(geo|location|area|region|city|אזור|מיקום|עיר|ארץ)/i.test(a.content),
    );
    if (geoConstraint) {
      grounded.add(geoConstraint.id);
      rationale.push(`Geo informed by business constraint: "${preview(geoConstraint.content)}".`);
    }
  }

  // ── custom-audience + lookalike hints ──────────────────────────────────────
  const spec: TargetingSpec = {
    geo,
    age_min: Math.min(age_min, age_max),
    age_max: Math.max(age_min, age_max),
    genders,
    interests,
  };

  const awarenessLevel = (opts.awareness?.content ?? '').toLowerCase();
  if (/(product-aware|most-aware|product aware|most aware|מודע)/.test(awarenessLevel)) {
    spec.custom_audience_hint =
      `Retarget warm/engaged users (awareness: "${preview(opts.awareness!.content, 40)}").`;
    grounded.add(opts.awareness!.id);
    rationale.push('Warm awareness ⇒ suggest a custom (retargeting) audience.');
  }
  if (persona && persona.confidence >= TARGETING_DEFAULTS.LOOKALIKE_CONFIDENCE) {
    spec.lookalike_hint = `Lookalike seeded from persona: "${preview(persona.content, 50)}".`;
  }

  return { spec, grounded_in: [...grounded], rationale };
}
