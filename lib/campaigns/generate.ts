// lib/campaigns/generate.ts
//
// The PRODUCTION creative generator — the injectable `generate` dep the runner
// uses outside tests. It wraps lib/master-studio's best-of-N pipeline:
//   • compose a MasterStudioInput FROM the insight-driven decision (the angle,
//     sub-audience, funnel stage, and platform the moat chose),
//   • prepend the brand/brief/insight context (buildAiContext) to every stage,
//   • run the pipeline on an Anthropic-backed StageRunner,
//   • record the winning post as a content_artifacts row tagged with the
//     decision's `grounded_in` atoms, and return it (with the artifact id) so the
//     runner can stamp the campaign_items.
//
// This module only IMPORTS lib/master-studio + lib/intelligence (never edits
// them). Tests stub `generate` directly and never reach this file.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runMasterPipeline, type StageRunner } from '@/lib/master-studio/pipeline';
import { withRetry } from '@/lib/master-studio/retry';
import type { MasterStudioInput } from '@/lib/master-studio';
import { buildAiContext } from '@/lib/ai-context';
import { recordArtifactWith, contextHash } from '@/lib/intelligence/artifacts';
import { createAdminClient } from '@/lib/supabase/server';
import type { GenerateCreative, GeneratedCreative } from './runner';

/** Map the decision platform to a master-studio platform label. */
function platformLabel(platform: string): string {
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'whatsapp') return 'WhatsApp';
  return 'Instagram';
}

export interface MasterStudioGeneratorOptions {
  /** The authenticated owner (for context + artifact ownership). */
  userId: string;
  /** A request-scoped supabase client (for buildAiContext reads). */
  supabase: SupabaseClient;
  /** Override the Anthropic client (tests). Default constructed from env. */
  anthropic?: Anthropic;
  /** Model id; defaults to CLAUDE_MODEL env or claude-sonnet-4-6. */
  model?: string;
}

/**
 * Build the runner's `generate` dep backed by the master-studio pipeline.
 * Grounds generation in the decision + the client's living context, records a
 * tagged content_artifacts row, and returns the creative + its artifact id.
 */
export function masterStudioGenerator(opts: MasterStudioGeneratorOptions): GenerateCreative {
  const anthropic = opts.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = opts.model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  return async (req): Promise<GeneratedCreative> => {
    const { decision, clientId } = req;

    // Brand / brief / insight context for THIS client, prepended to each stage.
    const ctx = await buildAiContext(opts.supabase, { userId: opts.userId, clientId });
    const ctxPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

    const run: StageRunner = withRetry(async (system, userPrompt, maxTokens) => {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: ctxPrefix + system,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const block = msg.content.find((b) => b.type === 'text');
      return block && block.type === 'text' ? block.text : '';
    });

    // The brief the studio writes against IS the insight-driven decision.
    const brief = [
      `Angle: ${decision.angle}`,
      `Audience: ${decision.sub_audience}`,
      `Funnel stage: ${decision.funnel_stage}`,
      `Objective: ${decision.objective}`,
      ``,
      `Why (insight-grounded): ${decision.rationale}`,
    ].join('\n');

    const input: MasterStudioInput = {
      brief,
      platform: platformLabel(decision.platform),
      locale: 'he',
      hook: decision.angle,
    };

    const result = await runMasterPipeline(input, run);
    if (!result.ok) {
      throw new Error(`master-studio pipeline failed: ${result.reason}`);
    }

    const out = result.output;
    const draft = out.winner.draft;

    // Record the artifact tagged with the decision's grounded atoms (best-effort).
    const artifact = await recordArtifactWith(createAdminClient, {
      clientId,
      ownerUserId: req.ownerUserId,
      type: 'post',
      content: {
        post: draft.post,
        hashtags: draft.hashtags,
        whatsapp: draft.whatsapp,
        image: draft.image,
        marketer: out.winner.marketer,
        score: out.winner.score,
      },
      angle: decision.angle,
      funnelStage: decision.funnel_stage,
      avatarRef: (out.avatar as Record<string, unknown> | null) ?? null,
      insightIds: decision.grounded_in,
      generatedFrom: {
        model,
        context_hash: contextHash(ctx.combined),
        platform: decision.platform,
        source: 'campaign-runner',
      },
    });

    return {
      post: draft.post,
      hashtags: draft.hashtags,
      whatsapp: draft.whatsapp,
      // master-studio's `image` is a generation PROMPT, not a URL; the dry-run
      // paid creative falls back to a placeholder image. Carried in `raw`.
      imageUrl: undefined,
      artifactId: artifact?.id ?? null,
      raw: { imagePrompt: draft.image, marketer: out.winner.marketer, score: out.winner.score },
    };
  };
}
