// ════════════════════════════════════════════
// Shared "run one master pipeline and persist the result" logic used by BOTH
// POST /api/ai/master (single) and POST /api/ai/master/batch.
//
// The persistence-on-completion is what makes non-blocking creation work (CP-3
// on top of CP-4): a run that finishes server-side inserts its own
// `generated_content` row immediately, so the create page can pick it up by
// polling GET /api/ai/master even if the user navigated away mid-flight — and a
// batch's results appear progressively as each parallel run lands.
//
// Credit accounting (deduct/refund) intentionally stays in the routes: the
// single route deducts one unit, the batch route deducts count×unit up front
// and refunds per failed run.
// ════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordArtifactWith, contextHash } from '@/lib/intelligence/artifacts';
import { runMasterPipeline, type StageRunner } from '@/lib/master-studio/pipeline';
import { deriveFunnelStage, type MasterStudioInput, type MasterV2Output } from '@/lib/master-studio';
import { MARKETERS_BY_ID, type Marketer, type MarketerId } from '@/lib/marketers';
import type { AiContextBlocks } from '@/lib/ai-context';

export interface RunMasterEnv {
  /** User-scoped client — the `generated_content` insert goes through RLS. */
  supabase: SupabaseClient;
  /** Admin-client factory for artifact recording (recordArtifactWith never throws). */
  createAdmin: () => SupabaseClient;
  /** Stage runner, ALREADY context-prefixed and withRetry-wrapped by the route. */
  runStage: StageRunner;
  userId: string;
  activeClientId: string | null;
  ctx: AiContextBlocks;
  model: string;
}

export type RunMasterOutcome =
  | { ok: true; output: MasterV2Output; artifactId: string | null }
  | { ok: false; kind: 'thrown'; error: unknown }
  | { ok: false; kind: 'partial'; reason: 'strategist' | 'creators' | 'judge' };

/**
 * Run the full best-of-N pipeline (no shortcuts) and, on success, persist:
 *   1. a tagged `content_artifacts` row (when an active client exists) — the
 *      living-knowledge log the user-signal loop resolves against;
 *   2. a `generated_content` row (history + read-back for the create page),
 *      carrying the artifact id so a restore round-trips the full output.
 * Both persistence steps are best-effort exactly as the single route always did:
 * an insert error is logged, never surfaced as a failed generation.
 */
export async function runAndPersistMaster(
  input: MasterStudioInput,
  env:   RunMasterEnv,
): Promise<RunMasterOutcome> {
  let result;
  try {
    result = await runMasterPipeline(input, env.runStage);
  } catch (e) {
    return { ok: false, kind: 'thrown', error: e };
  }
  if (!result.ok) return { ok: false, kind: 'partial', reason: result.reason };

  const out = result.output;

  // Resolve the framework the post actually used: the user's explicit choice when
  // given, otherwise the winning marketer's default framework (the pipeline lets
  // each marketer write in their own framework, so this is the AI-chosen one).
  const winnerFramework =
    (MARKETERS_BY_ID as Record<string, Marketer>)[out.winner.marketer.id as MarketerId]?.framework_default;
  const resolvedFramework = input.framework ?? winnerFramework ?? null;
  const funnelStage = deriveFunnelStage(input.type);

  // Tagged write-through to the living-knowledge artifact log (best-effort).
  let artifactId: string | null = null;
  if (env.activeClientId) {
    const artifact = await recordArtifactWith(env.createAdmin, {
      clientId:    env.activeClientId,
      ownerUserId: env.userId,
      type:        'post',
      content: {
        post:     out.winner.draft.post,
        hashtags: out.winner.draft.hashtags,
        whatsapp: out.winner.draft.whatsapp,
        image:    out.winner.draft.image,
        marketer: out.winner.marketer,
        score:    out.winner.score,
      },
      framework:    resolvedFramework,
      angle:        input.hook ?? null,
      funnelStage,
      avatarRef:    (out.avatar as Record<string, unknown> | null) ?? null,
      insightIds:   env.ctx.insightIds,
      generatedFrom: { model: env.model, context_hash: contextHash(env.ctx.combined), platform: input.platform ?? null },
    });
    artifactId = artifact?.id ?? null;
  }

  // Persist for history + read-back (best-effort; never fail the generation on
  // insert error). Runs AFTER artifact recording so `artifact_id` rides along in
  // the jsonb `output` — the create page restores a full MasterV2Output from it.
  const { error: insertErr } = await env.supabase.from('generated_content').insert({
    user_id:   env.userId,
    client_id: env.activeClientId ?? null,
    type:      'master_post',
    platform:  input.platform ?? null,
    input:     { brief: input.brief.substring(0, 500) },
    output: {
      post:       out.winner.draft.post.substring(0, 2000),
      hashtags:   out.winner.draft.hashtags,
      image:      out.winner.draft.image,
      whatsapp:   out.winner.draft.whatsapp,
      tips:       out.winner.draft.tips,
      principles: out.winner.draft.principles,
      marketer:   out.winner.marketer,
      marketers:  out.marketers,
      score:      out.winner.score,
      boosted:    out.boosted,
      avatar:     out.avatar,
      scores:     out.scores,
      why:        out.judgeRationale,
      artifact_id: artifactId,
    },
  });
  if (insertErr) console.error('[run-master] generated_content insert failed:', insertErr.message);

  return { ok: true, output: out, artifactId };
}
