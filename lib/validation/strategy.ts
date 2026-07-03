// lib/validation/strategy.ts
//
// The critical guard for finding H1: `business_analysis` is an LLM-produced
// JSONB column read straight off `client_strategy` and fed to the decision
// engine as a trusted `StrategyAnalysis`. Nothing verified its shape at the
// seam, so a malformed/partially-null LLM object propagated as a "valid" typed
// object and first surfaced as a bad campaign, not a caught error.
//
// `isStrategyAnalysis` is a structural check of the required nested objects and
// their field types; `parseStrategyAnalysis` is the tolerant reader the runner
// uses — it returns the verified `StrategyAnalysis` or `null` (never throws),
// so a failed validation degrades to the engine's null-strategy fallback path.

import type { StrategyAnalysis } from '@/lib/analyze-brief';
import { isRecord, isStringArray } from './json';

/**
 * Structural guard for a persisted/LLM `StrategyAnalysis`. Verifies each of the
 * four required nested objects and every field's runtime type (strings for the
 * scalar fields, string[] for the list fields). `raw_text` is part of the type
 * contract (always written by `persistBusinessAnalysis`) and is checked too.
 *
 * Intentionally checks TYPE not emptiness — an empty-string field is a valid
 * (if thin) strategy the engine tolerates via `strategyFallback`; a MISSING or
 * wrongly-typed field is the corruption we must reject.
 */
export function isStrategyAnalysis(x: unknown): x is StrategyAnalysis {
  if (!isRecord(x)) return false;

  const { strategic_summary, sub_audience, platform_funnel, offer_stack, raw_text } = x;

  if (typeof raw_text !== 'string') return false;

  if (!isRecord(strategic_summary)) return false;
  if (
    typeof strategic_summary.goal !== 'string' ||
    typeof strategic_summary.core_offer !== 'string' ||
    typeof strategic_summary.usp !== 'string' ||
    !isStringArray(strategic_summary.constraints)
  ) {
    return false;
  }

  if (!isRecord(sub_audience)) return false;
  if (
    typeof sub_audience.name !== 'string' ||
    typeof sub_audience.awareness_level !== 'string' ||
    typeof sub_audience.persona !== 'string' ||
    typeof sub_audience.explanation !== 'string'
  ) {
    return false;
  }

  if (!isRecord(platform_funnel)) return false;
  if (
    typeof platform_funnel.platform !== 'string' ||
    typeof platform_funnel.ad_format !== 'string' ||
    typeof platform_funnel.funnel_type !== 'string' ||
    typeof platform_funnel.platform_reason !== 'string' ||
    typeof platform_funnel.format_reason !== 'string' ||
    typeof platform_funnel.funnel_reason !== 'string'
  ) {
    return false;
  }

  if (!isRecord(offer_stack)) return false;
  if (
    !isStringArray(offer_stack.components) ||
    !isStringArray(offer_stack.strengths) ||
    typeof offer_stack.assessment !== 'string'
  ) {
    return false;
  }

  return true;
}

/**
 * Validate an already-parsed (or JSONB-loaded) value as a `StrategyAnalysis`.
 * Returns the verified object or `null` on any structural mismatch — never
 * throws. This is the read the runner uses in place of a blind `as` cast, so an
 * invalid persisted strategy becomes `null` (the engine's fallback) instead of
 * being trusted downstream.
 */
export function parseStrategyAnalysis(x: unknown): StrategyAnalysis | null {
  return isStrategyAnalysis(x) ? x : null;
}
