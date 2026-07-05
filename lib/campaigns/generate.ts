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
import { formatQuotesForPrompt, getQuoteBank } from '@/lib/voc';
import { lintArtifact } from '@/lib/brand-lint';
import { generateAndStoreCreativeImage } from './creative-image';
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

    // W2: episodic precedents recalled by the runner — what similar bets did
    // for THIS client before — join the standing context of every stage.
    const precedentsBlock =
      req.precedents && req.precedents.length > 0
        ? `═══ תקדימים (זיכרון אפיזודי) ═══\n${req.precedents.map((p) => `- ${p}`).join('\n')}\n\n`
        : '';
    const ctxPrefix =
      (ctx.combined ? `${ctx.combined}\n\n` : '') + precedentsBlock +
      (ctx.combined || precedentsBlock ? `═══ TASK ═══\n` : '');

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

    // W3 (C-08): verbatim customer language for this funnel stage — the best
    // hooks are the customer's own words. Best-effort: an empty/failed bank
    // never blocks generation, but the failure REASON is stamped onto the
    // artifact (generated_from.voc_bank_error) so it is observable, not lost.
    let vocAmmunition = '';
    let vocBankError: string | null = null;
    try {
      const quotes = await getQuoteBank(opts.supabase, clientId, req.ownerUserId, {
        funnelFit: decision.funnel_stage,
        limit: 6,
      });
      vocAmmunition = formatQuotesForPrompt(quotes);
    } catch (err) {
      vocBankError = err instanceof Error ? err.message : String(err);
    }

    // The brief the studio writes against IS the insight-driven decision.
    const brief = [
      `Angle: ${decision.angle}`,
      `Audience: ${decision.sub_audience}`,
      `Funnel stage: ${decision.funnel_stage}`,
      `Objective: ${decision.objective}`,
      ``,
      `Why (insight-grounded): ${decision.rationale}`,
      ...(vocAmmunition
        ? ['', 'ציטוטי לקוחות אמיתיים (VoC) — העדף את המילים שלהם להוקים:', vocAmmunition]
        : []),
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

    // W3 (C-07): lint the winning draft against the client's brand_voice atoms
    // BEFORE recording — 100% mechanical brand coverage. Deterministic rules
    // only here (no judge): the stamp must be fast and can never block on an
    // LLM. Violations are STAMPED, not fatal — the publish gate reads them.
    const lint = await lintArtifact(draft.post, req.insights ?? []);

    // Turn the studio's image PROMPT into a REAL stored creative image — but
    // ONLY when an image provider is configured. DORMANT-SAFE: with no provider
    // (dry-run) this returns null and generation is unaffected; publish then
    // falls back to the placeholder, exactly as before. Never throws / blocks.
    const admin = createAdminClient();
    // SCROLL-STOP: campaign/ad hero creatives are the thumb-stop-critical path, so
    // request maxImpact — the creative-image module then routes to the higher-
    // fidelity provider (OpenAI gpt-image-1) when configured. Dormant-safe: with no
    // provider this still returns null and generation is unaffected.
    const imageUrl =
      (await generateAndStoreCreativeImage(admin, req.ownerUserId, draft.image, {
        maxImpact: true,
      })) ?? undefined;

    // Record the artifact tagged with the decision's grounded atoms (best-effort).
    const artifact = await recordArtifactWith(createAdminClient, {
      clientId,
      ownerUserId: req.ownerUserId,
      type: 'post',
      content: {
        post: draft.post,
        hashtags: draft.hashtags,
        whatsapp: draft.whatsapp,
        // `image` stays the generation PROMPT; `image_url` (when we generated
        // one) is what publish.ts reads to skip the placeholder.
        image: draft.image,
        ...(imageUrl ? { image_url: imageUrl } : {}),
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
        // W3 stamp: brand-lint verdict travels with the artifact (spec C-07).
        lint: {
          score: lint.score,
          passed: lint.passed,
          violations: lint.violations.map((v) => ({ rule: v.rule, severity: v.severity, message: v.message })),
        },
        // W2 stamp: which precedents were in context when this was written.
        precedents_in_context: req.precedents?.length ?? 0,
        ...(vocBankError ? { voc_bank_error: vocBankError } : {}),
      },
    });

    return {
      post: draft.post,
      hashtags: draft.hashtags,
      whatsapp: draft.whatsapp,
      // master-studio's `image` is a generation PROMPT. When a provider is
      // configured we turned it into a real stored URL (imageUrl); otherwise it
      // stays undefined and the paid creative falls back to a placeholder. The
      // prompt is always carried in `raw`.
      imageUrl,
      artifactId: artifact?.id ?? null,
      raw: { imagePrompt: draft.image, marketer: out.winner.marketer, score: out.winner.score },
    };
  };
}
