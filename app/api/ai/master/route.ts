import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';
import { runMasterPipeline, type StageRunner } from '@/lib/master-studio/pipeline';
import { type MasterStudioInput } from '@/lib/master-studio';

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
  const run: StageRunner = async (system, userPrompt, maxTokens) => {
    const msg = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     ctxPrefix + system,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const block = msg.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  };

  const input: MasterStudioInput = { brief, masterNotes, platform, tone, type, framework, hook, locale };

  let result;
  try {
    result = await runMasterPipeline(input, run);
  } catch (e) {
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    return NextResponse.json(
      { error: 'נכשל ביצירה — נסה שוב', detail: String(e).slice(0, 200) },
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

  return NextResponse.json({ ...out, credits: deduct.credits });
}
