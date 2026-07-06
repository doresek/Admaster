// lib/organic-perf/verdict.ts
//
// Deterministic, honest verdict math for organic page posts.
//
// The signal is reach-relative engagement rate (engaged / reach) — the one
// ratio that is comparable across posts regardless of page size:
//
//   er >= 0.05          → 'worked'          (5%+ of reached people engaged)
//   0.02 <= er < 0.05   → 'underperformed'
//   er <  0.02          → 'failed'
//   reach < 50          → null              (insufficient data — do not judge noise)
//
// Thresholds are industry-conventional for FB page posts and intentionally
// coarse: the diagnosis layer consumes verdicts, not decimals.

import type { OrganicVerdict } from './types';

/** engagement_rate >= this ⇒ 'worked'. */
export const ORGANIC_WORKED_MIN_ER = 0.05;

/** engagement_rate >= this (and < worked) ⇒ 'underperformed'; below ⇒ 'failed'. */
export const ORGANIC_UNDERPERFORMED_MIN_ER = 0.02;

/** Below this reach we refuse to judge — verdict null (insufficient data). */
export const ORGANIC_MIN_REACH_FOR_VERDICT = 50;

/** engaged / reach, safely: 0 when reach is 0 or inputs are not finite. */
export function organicEngagementRate(engaged: number, reach: number): number {
  if (!Number.isFinite(engaged) || !Number.isFinite(reach) || reach <= 0) return 0;
  return engaged / reach;
}

/** The verdict for one post-day. Pure; boundaries are inclusive as documented. */
export function computeOrganicVerdict(metrics: { reach: number; engaged: number }): OrganicVerdict {
  const reach = Number.isFinite(metrics.reach) ? metrics.reach : 0;
  if (reach < ORGANIC_MIN_REACH_FOR_VERDICT) return null; // don't judge noise
  const er = organicEngagementRate(metrics.engaged, reach);
  if (er >= ORGANIC_WORKED_MIN_ER) return 'worked';
  if (er >= ORGANIC_UNDERPERFORMED_MIN_ER) return 'underperformed';
  return 'failed';
}
