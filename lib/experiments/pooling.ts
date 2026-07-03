// lib/experiments/pooling.ts
//
// PURE hierarchical evidence pooling (spec C-11 / creative-testing-discipline
// §3 "the pooling escape hatch": evidence pools along the atom graph — the
// same hook tested across 3 audiences resolves the HOOK ATOM on the combined
// sample; pool before declaring a floor unreachable).
//
// SCOPE — what pooling does and deliberately does NOT do:
//   DOES: aggregate observed samples across every test whose insight_ids
//   include the atom, reuse each test's OWN registered floor (via C-01's
//   armFloorProgress) to measure its contribution, and flag when the combined
//   structure holds one full floor quantum of evidence.
//   DOES NOT: resolve anything, move atoms, or touch hypothesis status. The
//   flag says "an atom-level verdict is READABLE"; the actual pooled
//   resolution (verdict + atom moves) remains a C-01 resolveAndLearn call by
//   the consumer — this module keeps no shadow lifecycle.

import { armFloorProgress } from '@/lib/hypotheses';
import type { ArmObservation, HypothesisRow } from '@/lib/hypotheses';
import { round2 } from './info-value';
import type { PooledCounts, PooledEvidence, PooledTestEvidence } from './types';

const isFiniteNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const COUNT_FIELDS = ['impressions', 'clicks', 'conversions', 'marked_leads'] as const;

const emptyCounts = (): PooledCounts => ({ impressions: 0, clicks: 0, conversions: 0, marked_leads: 0 });

/** Sum one test's arms into a single pooled observation (non-finite → 0). */
function sumArms(observations: ArmObservation[]): PooledCounts {
  const total = emptyCounts();
  for (const obs of observations) {
    for (const field of COUNT_FIELDS) {
      const v = obs[field];
      if (isFiniteNum(v) && v > 0) total[field] += v;
    }
  }
  return total;
}

/**
 * Aggregate evidence for one atom across every test that references it.
 *
 * Per test: its arms' counts are summed and measured against the test's OWN
 * per-arm floor via C-01's armFloorProgress — one "floor quantum" is the
 * sample the test registered as sufficient for a verdict. The per-arm split
 * inside a test cannot be attributed to the atom (test_refs do not map arms
 * to atoms), so the whole test's sample counts as evidence on the shared atom
 * — the honest granularity available.
 *
 * Combined progress = Σ per-test progress; ready when ≥ 1 — three tests each
 * 40% toward their floors jointly hold 1.2 quanta, so the atom-level question
 * is readable even though every individual test is under-floor ("floors met
 * by structure"). Tests provided without observations contribute 0 (nothing
 * observed ≠ something pooled).
 */
export function pooledEvidence(
  atomId:                   string,
  hypotheses:               HypothesisRow[],
  observationsByHypothesis: Record<string, ArmObservation[]>,
): PooledEvidence {
  const sharing = hypotheses.filter((h) => h.insight_ids.includes(atomId));

  if (sharing.length === 0) {
    return {
      atom_id:           atomId,
      ready:             false,
      combined_progress: 0,
      combined_n:        emptyCounts(),
      per_test:          [],
      reason:            `no tests reference atom ${atomId} — nothing to pool`,
    };
  }

  const combined = emptyCounts();
  const perTest: PooledTestEvidence[] = [];

  for (const h of sharing) {
    const observations = observationsByHypothesis[h.id] ?? [];
    const samples = sumArms(observations);
    for (const field of COUNT_FIELDS) combined[field] += samples[field];

    // Reuse C-01's floor math on the test's pooled sample: "how many of THIS
    // test's floor quanta does its combined evidence hold".
    const progress = armFloorProgress(h.floor_spec, { arm: 'pooled', ...samples });
    perTest.push({ hypothesis_id: h.id, floor_progress: round2(progress), samples });
  }

  const combinedProgress = round2(perTest.reduce((sum, t) => sum + t.floor_progress, 0));
  const ready = combinedProgress >= 1;

  return {
    atom_id:           atomId,
    ready,
    combined_progress: combinedProgress,
    combined_n:        combined,
    per_test:          perTest,
    reason: ready
      ? `pooled evidence across ${sharing.length} test(s) holds ${combinedProgress}× one floor quantum — ` +
        `an atom-level verdict is readable (readiness only; resolution stays a C-01 resolveAndLearn call)`
      : `pooled evidence across ${sharing.length} test(s) holds ${combinedProgress}× one floor quantum — ` +
        `below the 1.0 needed; keep running or widen the structure (§3 pooling escape hatch)`,
  };
}
