// app/api/articles/generate/route.ts — P3-3 endpoint.
//
//   POST /api/articles/generate   run the article pipeline on an owned idea row
//                                 body: { article_id }
//                                 → { article_id, status, outline, body_md?,
//                                     gate: {passed, failures}, lint, credits }
//
// Pattern per app/api/ai/master/route.ts: Anthropic StageRunner wrapped in
// withRetry, buildAiContext prefix on every stage system prompt, CLAUDE_MODEL,
// deduct-up-front / refund-on-failure. Credits NOTE: there is no 'article'
// action in CREDIT_COSTS — 'master_post' (6⚡, the multi-call generation
// action) is the closest existing action and is used here deliberately.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { getQuoteBank } from '@/lib/voc';
import { type StageRunner } from '@/lib/master-studio/pipeline';
import { withRetry } from '@/lib/master-studio/retry';
import { generateArticle } from '@/lib/articles/generate';
import type { VocQuoteRow } from '@/lib/capability-contracts';

// The pipeline runs 1 outline + 3-5 sections + 1 FAQ + 1 edit ≈ 6-8 sequential
// Anthropic calls — same Fluid Compute budget as the master route.
export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Long multi-call generation — 5 article runs / minute / user.
  const rl = checkRateLimit(`article-gen:${user.id}`, { max: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { article_id?: string };
  const articleId = body.article_id?.trim() ?? '';
  if (!UUID_RE.test(articleId)) {
    return NextResponse.json({ error: 'article_id must be a UUID' }, { status: 400 });
  }

  // Owner-scoped load (RLS: articles_owner_all returns the row only to its owner).
  const { data: article } = await supabase
    .from('articles')
    .select('id, client_id, owner_user_id, title, kind, keywords, topic_source, status, grounded_in, rationale')
    .eq('id', articleId)
    .maybeSingle();
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 'idea' is the P3-2 entry state; 'outline' re-runs are allowed so a
  // gate-failed article can be regenerated. Drafted/published rows are not
  // silently overwritten.
  if (article.status !== 'idea' && article.status !== 'outline') {
    return NextResponse.json(
      { error: `המאמר בסטטוס '${article.status}' — יצירה אפשרית רק מ-idea/outline` },
      { status: 409 }
    );
  }

  // Brand DNA + client brain prefix for every stage system prompt.
  const ctx = await buildAiContext(supabase, { userId: user.id, clientId: article.client_id });
  const ctxPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

  // NOTE: no 'article' CreditAction exists — 'master_post' (6⚡) is the closest
  // existing multi-call generation action (do not edit lib/credits this wave).
  const deduct = await deductCredits(supabase, user.id, 'master_post');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  const admin = createAdminClient();

  // Grounding: the living atoms + the VoC quote bank (enrichment, best-effort).
  const atoms = await listActiveInsights(admin, article.client_id);
  let quotes: VocQuoteRow[] = [];
  try {
    quotes = await getQuoteBank(admin, article.client_id, user.id, { limit: 20 });
  } catch {
    quotes = [];
  }

  // Anthropic-backed stage runner (withRetry: one retry on transient errors).
  const run: StageRunner = withRetry(async (system, userPrompt, maxTokens) => {
    const msg = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     ctxPrefix + system,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const block = msg.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  });

  const result = await generateArticle({
    article: {
      id:           article.id,
      title:        article.title,
      kind:         article.kind,
      keywords:     article.keywords ?? [],
      topic_source: article.topic_source ?? null,
      grounded_in:  article.grounded_in ?? [],
      rationale:    article.rationale ?? null,
    },
    atoms,
    quotes,
    run,
    admin,
    currentYear: new Date().getFullYear(),
  });

  if (!result.ok) {
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    console.error(`[articles/generate] pipeline failed at ${result.stage}:`, result.error);
    return NextResponse.json(
      { error: 'נכשל ביצירת המאמר — נסה שוב', stage: result.stage, detail: result.error.slice(0, 200) },
      { status: 502 }
    );
  }

  return NextResponse.json({
    article_id: result.article_id,
    status:     result.status,
    outline:    result.outline,
    body_md:    result.body_md,
    gate:       { passed: result.gate.passed, failures: result.gate.failures },
    lint:       { score: result.lint.score, passed: result.lint.passed, violations: result.lint.violations },
    seo:        result.seo,
    credits:    deduct.credits,
  });
}
