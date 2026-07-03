// lib/campaigns/precedents.ts
//
// W2 wire-in (spec C-02): before a decision is executed, retrieve the k most
// similar PAST episodes — this client's resolved hypotheses and diagnoses —
// so the run carries its precedents ("8 months ago urgency framing failed at
// BOFU") into the decision log and the generation context. Case-based memory
// applied at the moment it pays.
//
// GRACEFUL BY DESIGN: recall needs an embedder (GOOGLE_AI_API_KEY). When the
// key is absent, when there are no episodes yet, or when recall fails, the
// campaign proceeds with zero precedents and a note — memory enriches a run,
// it never gates one (same doctrine as store persistence in the runner).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketingDecision } from '@/lib/decision-engine';
import { defaultEmbedder, recallSimilar } from '@/lib/episodic';

/** What the runner records + hands to the generator. */
export interface PrecedentBlock {
  /** One-line precedent summaries, ready for prompt/context injection. */
  summaries: string[];
  /** episode ids (audit trail for the decision log). */
  episodeIds: string[];
  /** Present when recall was skipped/degraded — surfaced in runner notes. */
  note?: string;
}

export const NO_PRECEDENTS: PrecedentBlock = { summaries: [], episodeIds: [] };

/**
 * Render the decision as the recall query. The text mirrors the episode
 * composition vocabulary (angle / audience / funnel / objective) so cosine
 * similarity compares like with like.
 */
export function decisionContextText(decision: MarketingDecision): string {
  return [
    `Angle: ${decision.angle}`,
    `Audience: ${decision.sub_audience}`,
    `Funnel: ${decision.funnel_stage} · Objective: ${decision.objective}`,
    `Rationale: ${decision.rationale}`,
  ].join('\n');
}

/** The injectable recall function's shape (the runner's seam). */
export type RecallPrecedents = (args: {
  clientId:    string;
  ownerUserId: string;
  decision:    MarketingDecision;
}) => Promise<PrecedentBlock>;

/**
 * The production recaller: embed the decision context, k-NN over this
 * client's episodes (client scope — verbatim precedents; fleet scope is a
 * later, consent-gated step). Every failure path returns NO_PRECEDENTS with a
 * note instead of throwing.
 */
export function episodicRecaller(admin: SupabaseClient, k = 3): RecallPrecedents {
  return async ({ clientId, decision }) => {
    let embedder;
    try {
      embedder = defaultEmbedder();
    } catch (err) {
      return {
        ...NO_PRECEDENTS,
        note: `precedent recall skipped: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    try {
      const result = await recallSimilar(admin, embedder, {
        clientId,
        contextText: decisionContextText(decision),
        scope: 'client',
        k,
      });
      return {
        summaries: result.matches.map((m) => m.precedent_summary),
        episodeIds: result.matches.map((m) => m.id),
      };
    } catch (err) {
      return {
        ...NO_PRECEDENTS,
        note: `precedent recall failed (run unaffected): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}
