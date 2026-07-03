// lib/brand-lint/lint.ts
//
// C-07 composition: pick the client's brand-voice atom, run the deterministic
// pass (rules.ts), optionally run the register judge (types.ts seam), score.
//
// Totality contract: lintArtifact NEVER throws and NEVER rejects — every
// string input yields a LintResult. In particular, the register judge is
// advisory: a judge error (LLM outage, malformed output) becomes a single
// 'register_inconclusive' FLAG — publishing must never be hostage to an LLM.
// That flag IS the log of the failure (message carries the error), so nothing
// is silently swallowed.

import type { ClientInsight } from '@/lib/intelligence/types';
import { computeScore, DETERMINISTIC_RULES } from './rules';
import {
  DEFAULT_BRAND_VOICE,
  parseBrandVoice,
  type BrandVoiceSpec,
  type LintResult,
  type LintViolation,
  type RegisterJudge,
} from './types';

/**
 * Pick the brand-voice atom to lint against: among ACTIVE atoms of kind
 * 'brand_voice', the highest confidence wins; equal confidence → the newest
 * (updated_at) wins. Mirrors listActiveInsights' confidence-first ordering
 * (lib/intelligence/insights.ts) with recency as the tie-break, so a freshly
 * corroborated voice beats a stale twin. Returns null when none exists.
 */
export function selectBrandVoiceAtom(brandAtoms: readonly ClientInsight[]): ClientInsight | null {
  const ts = (s: string): number => {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  };
  let best: ClientInsight | null = null;
  for (const atom of brandAtoms) {
    if (atom.kind !== 'brand_voice' || atom.status !== 'active') continue;
    if (
      best === null ||
      atom.confidence > best.confidence ||
      (atom.confidence === best.confidence && ts(atom.updated_at) > ts(best.updated_at))
    ) {
      best = atom;
    }
  }
  return best;
}

/** Resolve the effective spec + the spec-level violations (missing/broken voice). */
function resolveSpec(brandAtoms: readonly ClientInsight[]): { spec: BrandVoiceSpec; violations: LintViolation[] } {
  const atom = selectBrandVoiceAtom(brandAtoms);
  if (!atom) {
    return {
      spec: {
        ...DEFAULT_BRAND_VOICE,
        address:     { ...DEFAULT_BRAND_VOICE.address },
        taboo_words: [...DEFAULT_BRAND_VOICE.taboo_words],
      },
      violations: [{
        rule:     'no_brand_voice',
        severity: 'flag',
        message:  'לא הוגדר קול מותג (brand_voice atom) — הבדיקה רצה מול ברירות המחדל',
        excerpt:  '',
      }],
    };
  }

  const { spec, warnings } = parseBrandVoice(atom.structured);
  // Surface parse degradations as flags: a broken spec should be VISIBLE to
  // the owner (and nudge a fix), never a silent lint-against-defaults.
  return {
    spec,
    violations: warnings.map((w): LintViolation => ({
      rule:     'brand_voice_spec',
      severity: 'flag',
      message:  `הגדרת קול המותג חלקית/פגומה: ${w}`,
      excerpt:  '',
    })),
  };
}

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Lint one artifact against the client's brand atoms (spec C-07).
 *
 * Passes:
 *   1. deterministic rules — always run; their 'block' violations fail the
 *      artifact (passed=false);
 *   2. register judge (optional) — advisory only: a register mismatch FLAGS
 *      with the judge's concerns; a judge ERROR flags 'register_inconclusive'
 *      (checked.register stays false — the check did not complete).
 *
 * Total: never throws, never rejects — any string in, a LintResult out.
 */
export async function lintArtifact(
  content:    string,
  brandAtoms: readonly ClientInsight[],
  judge?:     RegisterJudge,
): Promise<LintResult> {
  // Defensive totality: a non-string smuggled past the types (jsonb, JS
  // callers) lints as empty rather than crashing the publish path.
  const text = typeof content === 'string' ? content : '';

  const { spec, violations } = resolveSpec(brandAtoms);

  for (const rule of DETERMINISTIC_RULES) {
    violations.push(...rule(text, spec));
  }

  let registerChecked = false;
  if (judge) {
    try {
      const verdict = await judge.judge(text, spec);
      registerChecked = true;
      if (!verdict.registerMatch) {
        violations.push({
          rule:     'register_mismatch',
          severity: 'flag',
          message:  `הטקסט לא תואם את המשלב המוצהר (${spec.register})${verdict.concerns.length ? `: ${verdict.concerns.join('; ')}` : ''}`,
          excerpt:  '',
        });
      }
    } catch (e) {
      // NOT a silent catch: the violation carries the failure and is the log.
      // An LLM outage may only degrade the register check — never block.
      violations.push({
        rule:     'register_inconclusive',
        severity: 'flag',
        message:  `בדיקת המשלב לא הושלמה (register check inconclusive): ${errorMessage(e)}`,
        excerpt:  '',
      });
    }
  }

  return {
    score:      computeScore(violations),
    violations,
    passed:     violations.every((v) => v.severity !== 'block'),
    checked:    { deterministic: true, register: registerChecked },
  };
}

/**
 * Batch audit (spec C-07 "batch-audits existing drafts"): lint many artifacts
 * against the same brand atoms, judge calls running CONCURRENTLY. Uses
 * Promise.allSettled so one artifact's failure can never fail the batch —
 * lintArtifact is itself total, so the rejected branch is defensive-only, but
 * it still degrades to a flagged result rather than dropping the artifact.
 */
export async function lintBatch(
  contents:   readonly string[],
  brandAtoms: readonly ClientInsight[],
  judge?:     RegisterJudge,
): Promise<LintResult[]> {
  const settled = await Promise.allSettled(contents.map((c) => lintArtifact(c, brandAtoms, judge)));
  return settled.map((s): LintResult => {
    if (s.status === 'fulfilled') return s.value;
    const violations: LintViolation[] = [{
      rule:     'lint_error',
      severity: 'flag',
      message:  `הבדיקה נכשלה באופן לא צפוי: ${errorMessage(s.reason)}`,
      excerpt:  '',
    }];
    return {
      score:      computeScore(violations),
      violations,
      passed:     true, // infra failure must not block publishing (advisory flag only)
      checked:    { deterministic: true, register: false },
    };
  });
}
