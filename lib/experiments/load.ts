// lib/experiments/load.ts
//
// The ONLY I/O in lib/experiments: load a client's open hypotheses (via C-01's
// listHypotheses — reused, not requeried by hand) and active atoms (via the
// intelligence layer's listActiveInsights), and shape them into slate
// candidates for the pure planner. Exactly ONE query per table; both reads
// follow the lib/intelligence/insights.ts conventions (client injected,
// explicit scoping, every error thrown by the reused data layers).

import type { SupabaseClient } from '@supabase/supabase-js';
import { listHypotheses } from '@/lib/hypotheses';
import type { HypothesisRow } from '@/lib/hypotheses';
import { listActiveInsights } from '@/lib/intelligence/insights';
import type { ClientInsight } from '@/lib/intelligence/types';
import type { CandidateKind, HypothesisCandidate } from './types';

/**
 * The mid-confidence band in which an atom counts as CONTESTED (skill §5:
 * "mid confidence, mixed evidence — cheapest to resolve, highest
 * belief-movement"). Centered on maximum Bernoulli-belief variance (0.5).
 */
export const CONTESTED_BAND = { min: 0.35, max: 0.65 } as const;

/** Default arm count when a registration carries no test_refs yet: a comparison needs two arms. */
export const DEFAULT_ARM_COUNT = 2;

/**
 * Classify WHY an open hypothesis deserves explore budget (the skill-§5
 * ladder), from what the ledger can see:
 *   • ≥ 2 linked atoms → 'decision_unblocking' (the verdict gates multiple beliefs).
 *   • a linked atom in the contested band → 'contested_atom'.
 *   • otherwise → 'wild_variant'.
 * 'fatigue_successor' is never assigned here — fatigue is performance-pipeline
 * knowledge this loader does not have; callers with that context tag
 * candidates themselves before planning.
 */
export function classifyCandidateKind(h: HypothesisRow, atomsById: Map<string, ClientInsight>): CandidateKind {
  if (h.insight_ids.length >= 2) return 'decision_unblocking';
  const contested = h.insight_ids.some((id) => {
    const atom = atomsById.get(id);
    return (
      atom !== undefined &&
      Number.isFinite(atom.confidence) &&
      atom.confidence >= CONTESTED_BAND.min &&
      atom.confidence <= CONTESTED_BAND.max
    );
  });
  return contested ? 'contested_atom' : 'wild_variant';
}

function candidateFromHypothesis(h: HypothesisRow, atomsById: Map<string, ClientInsight>): HypothesisCandidate {
  return {
    id:          h.id,
    claim:       h.claim,
    insight_ids: h.insight_ids,
    domain:      h.domain,
    kind:        classifyCandidateKind(h, atomsById),
    floor_spec:  h.floor_spec,
    horizon:     h.horizon,
    arm_count:   h.test_refs.length > 0 ? h.test_refs.length : DEFAULT_ARM_COUNT,
    hypothesis:  h,
  };
}

export interface LoadedCandidates {
  candidates: HypothesisCandidate[];
  /** The client's full active-atom pool — planSlate's maturity + belief input. */
  insights: ClientInsight[];
}

/**
 * Load everything planSlate needs for one client: open hypotheses as
 * candidates plus the active atom pool. One query per table (the fleet may be
 * hundreds of clients — the weekly heartbeat calls this per attention-ranked
 * client, so each call must stay two round-trips flat).
 */
export async function loadOpenCandidates(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<LoadedCandidates> {
  const [open, insights] = await Promise.all([
    listHypotheses(supabase, { clientId, ownerUserId, status: 'open' }),
    listActiveInsights(supabase, clientId),
  ]);

  const atomsById = new Map(insights.map((i) => [i.id, i]));
  return {
    candidates: open.map((h) => candidateFromHypothesis(h, atomsById)),
    insights,
  };
}
