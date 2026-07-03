// lib/experiments/maturity.ts
//
// PURE brain-maturity assessment → explore share (creative-testing-discipline
// §5: "default split 70–80% exploit / 20–30% explore, modulated by brain
// maturity"). Maturity is read off the BRIDGE layer because bridge atoms
// (angles, hooks, value translations) are the beliefs campaigns actually run
// on — a client with proven angles is "mature" regardless of how many
// business-layer facts we hold.

import type { ClientInsight } from '@/lib/intelligence/types';
import type { BrainMaturity, MaturityAssessment } from './types';

/**
 * The confidence bar for a bridge atom to count as "proven". 0.7 aligns with
 * CONFIDENCE.DECISIVE_WEIGHT territory in lib/intelligence — beliefs strong
 * enough that contradicting evidence must be decisive to move them.
 */
export const MATURE_BRIDGE_CONFIDENCE = 0.7;

/**
 * Explore share per maturity (skill §5):
 *   new        (0 proven bridge atoms)  → up to 50% explore — wide, cheap,
 *              CTR-grade tests across angles; each arm a different atom.
 *   developing (1–2)                    → 30% — the middle of the default band.
 *   mature     (≥3 proven angles)       → 20% floor — NEVER zero: zero
 *              exploration = fatigue cliff with no successor ready (the "one
 *              winning ad" death spiral every SMB knows).
 */
export const EXPLORE_SHARE: Record<BrainMaturity, number> = {
  new:        0.5,
  developing: 0.3,
  mature:     0.2,
};

/**
 * Count the active bridge atoms at/above the high-confidence bar and map the
 * count to a maturity band: 0 → 'new', 1–2 → 'developing', ≥3 → 'mature'.
 * Non-finite confidences never count (total math — a broken atom upstream
 * must not inflate maturity and silently shrink exploration).
 */
export function assessMaturity(insights: ClientInsight[]): MaturityAssessment {
  const proven = insights.filter(
    (i) =>
      i.layer === 'bridge' &&
      i.status === 'active' &&
      Number.isFinite(i.confidence) &&
      i.confidence >= MATURE_BRIDGE_CONFIDENCE,
  ).length;

  const maturity: BrainMaturity = proven === 0 ? 'new' : proven <= 2 ? 'developing' : 'mature';
  return {
    maturity,
    high_confidence_bridge_atoms: proven,
    explore_share: EXPLORE_SHARE[maturity],
  };
}
