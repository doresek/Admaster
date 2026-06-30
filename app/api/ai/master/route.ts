import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits } from '@/lib/credits';
import { recordArtifactWith, contextHash } from '@/lib/intelligence/artifacts';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';
import { runMasterPipeline, type StageRunner } from '@/lib/master-studio/pipeline';
import { withRetry, classifyError } from '@/lib/master-studio/retry';
import { deriveFunnelStage, type MasterStudioInput } from '@/lib/master-studio';
import { MARKETERS_BY_ID, type Marketer, type MarketerId } from '@/lib/marketers';

// Best-of-N runs 5-6 sequential Anthropic calls; the default 10s/60s function
// budget is not enough. Vercel Fluid Compute allows up to 300s on Node.
export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: best-of-N is expensive — 10 master calls / minute / user.
  const rl = checkRateLimit(`master:${user.id}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = await req.json();
  const { brief, masterNotes, platform, tone, type, framework, hook, locale, client_id, brief_id } = body as
    MasterStudioInput & { client_id?: string | null; brief_id?: string | null };

  if (!brief?.trim() || !platform) {
    return NextResponse.json({ error: 'Missing fields: brief, platform' }, { status: 400 });
  }

  // Brand DNA + active client + brief context (prepended to every stage system prompt).
  const activeClientId = client_id ?? readActiveClientCookie(req.headers.get('cookie') ?? '');
  const ctx = await buildAiContext(supabase, {
    userId:   user.id,
    clientId: activeClientId,
    briefId:  brief_id ?? null,
  });
  const ctxPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

  // Deduct 6 credits once, up front.
  const deduct = await deductCredits(supabase, user.id, 'master_post');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  // Anthropic-backed stage runner. Brand context is prepended to each stage's system prompt.
  // Wrapped in withRetry: each stage retries ONCE on a transient provider error
  // (429 / 5xx / network) with a short backoff before giving up.
  const run: StageRunner = withRetry(async (system, userPrompt, maxTokens) => {
    const msg = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     ctxPrefix + system,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const block = msg.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  });

  const input: MasterStudioInput = { brief, masterNotes, platform, tone, type, framework, hook, locale };

  let result;
  try {
    result = await runMasterPipeline(input, run);
  } catch (e) {
    // Refund first — never swallow it, regardless of how we classify the error.
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    const kind = classifyError(e);
    console.error(`[master route] pipeline failed (${kind}):`, e);
    return NextResponse.json(
      { error: 'נכשל ביצירה — נסה שוב', kind, detail: `${kind}: ${String(e).slice(0, 200)}` },
      { status: 502 }
    );
  }

  if (!result.ok) {
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    return NextResponse.json({ error: 'תוצאה חלקית — נסה שוב', reason: result.reason }, { status: 502 });
  }

  // Persist for history/analytics (best-effort; do not fail the request on insert error).
  const out = result.output;
  const { error: insertErr } = await supabase.from('generated_content').insert({
    user_id:   user.id,
    client_id: activeClientId ?? null,
    type:      'master_post',
    platform:  platform ?? null,
    input:     { brief: brief.substring(0, 500) },
    output: {
      post:      out.winner.draft.post.substring(0, 2000),
      marketer:  out.winner.marketer,
      score:     out.winner.score,
      boosted:   out.boosted,
      avatar:    out.avatar,
      scores:    out.scores,
      why:       out.judgeRationale,
    },
  });
  if (insertErr) console.error('[master route] insert failed:', insertErr.message);

  // Tagged write-through to the living-knowledge artifact log (best-effort).
  // Records the winning post tagged with the framework/hook it used and the
  // insight ids buildAiContext grounded on, so the user-signal loop can later
  // resolve which beliefs this post relied on. Only when an active client exists.
  // Resolve the framework the post actually used: the user's explicit choice when
  // given, otherwise the winning marketer's default framework (the pipeline lets
  // each marketer write in their own framework, so this is the AI-chosen one).
  // Likewise tag the funnel stage so the artifact is fully isolatable; both were
  // landing null before.
  const winnerFramework =
    (MARKETERS_BY_ID as Record<string, Marketer>)[out.winner.marketer.id as MarketerId]?.framework_default;
  const resolvedFramework = framework ?? winnerFramework ?? null;
  const funnelStage = deriveFunnelStage(type);

  let artifactId: string | null = null;
  if (activeClientId) {
    const artifact = await recordArtifactWith(createAdminClient, {
      clientId:    activeClientId,
      ownerUserId: user.id,
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
      angle:        hook ?? null,
      funnelStage,
      avatarRef:    (out.avatar as Record<string, unknown> | null) ?? null,
      insightIds:   ctx.insightIds,
      generatedFrom: { model: MODEL, context_hash: contextHash(ctx.combined), platform: platform ?? null },
    });
    artifactId = artifact?.id ?? null;
  }

  return NextResponse.json({ ...out, credits: deduct.credits, artifact_id: artifactId });
}
