import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { composeScorePrompt, parseScoreResponse } from '@/lib/scoring';
import { matchMetaPolicy } from '@/lib/policy-rules/meta.he';
import { matchGooglePolicy } from '@/lib/policy-rules/google.he';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const SCORE_MODEL = process.env.CLAUDE_SCORE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ITERATIONS = 2;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit(`score_boost:${user.id}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited', retryAfter: rl.retryAfter }, { status: 429 });

  const body = await req.json() as { prior_score_id: string };
  if (!body.prior_score_id) return NextResponse.json({ error: 'Missing prior_score_id' }, { status: 400 });

  // 1. Load the prior score row + parent chain to count iterations
  const { data: prior, error: loadErr } = await supabase.from('scores')
    .select('*').eq('id', body.prior_score_id).eq('user_id', user.id).single();
  if (loadErr || !prior) return NextResponse.json({ error: 'prior_not_found' }, { status: 404 });
  if (prior.boost_iteration >= MAX_ITERATIONS) {
    return NextResponse.json({ error: 'max_iterations_reached', max: MAX_ITERATIONS }, { status: 409 });
  }

  // 2. Deduct
  const deduct = await deductCredits(supabase, user.id, 'score_boost');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error }, { status: deduct.status });

  // 3. Rewrite (Sonnet)
  const rewriteSystem = `You are a Hebrew-native performance copywriter. Rewrite the given Hebrew/English/Arabic ad copy to score higher on predicted CTR + conversion. The current score is ${prior.score}/100, band="${prior.band}". The detected weaknesses are encoded in the policy flags and missing extracts. Keep the same channel (${prior.channel}) and the same locale (${prior.locale}). Return ONLY the rewritten copy, no commentary, no markdown.`;
  const rewriteUser = `Current copy:\n${prior.copy_text}\n\nIssues to address:\n- Predicted hook: ${prior.predicted_hook}\n- Emotions present: ${(prior.emotions as string[]).join(', ') || 'none'}\n- Policy flags: ${JSON.stringify(prior.policy_flags)}\n\nRewrite for a stronger hook, stronger benefit framing, and a clear CTA. Preserve the brand voice.`;

  let rewritten: string;
  try {
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 600, temperature: 0.7,
      system: rewriteSystem,
      messages: [{ role: 'user', content: rewriteUser }],
    });
    rewritten = message.content.find(b => b.type === 'text')?.text?.trim() ?? '';
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'score_boost', deduct.cost);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
  if (!rewritten) {
    await refundCredits(supabase, user.id, 'score_boost', deduct.cost);
    return NextResponse.json({ error: 'rewrite_empty', refunded: deduct.cost }, { status: 502 });
  }

  // 4. Re-score (Haiku, same path as /api/ai/score)
  const { data: userRow } = await supabase.from('users').select('brand').eq('id', user.id).single();
  const { system, user: userPrompt } = composeScorePrompt({
    copy:    rewritten,
    channel: prior.channel,
    locale:  prior.locale,
    brand:   userRow?.brand,
    audience_segment: prior.audience_segment,
  });
  let scoreText: string;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const message = await anthropic.messages.create({
      model: SCORE_MODEL, max_tokens: 900, temperature: 0.2,
      system, messages: [{ role: 'user', content: userPrompt }],
    });
    scoreText = message.content.find(b => b.type === 'text')?.text ?? '';
    usage = { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens };
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'score_boost', deduct.cost);
    return NextResponse.json({ error: extractErrorMessage(err), rewritten, refunded: deduct.cost }, { status: 502 });
  }
  const parsed = parseScoreResponse(scoreText);
  if (!parsed.ok) {
    await refundCredits(supabase, user.id, 'score_boost', deduct.cost);
    return NextResponse.json({ error: 'parse_failed', rewritten, refunded: deduct.cost }, { status: 502 });
  }

  const channelRules = prior.channel.startsWith('google') ? matchGooglePolicy(rewritten)
                     : prior.channel.startsWith('meta')   ? matchMetaPolicy(rewritten)
                     : [];
  parsed.value.policy_flags = [...channelRules, ...parsed.value.policy_flags];

  // 5. Persist boosted row
  const { data: row, error: insErr } = await supabase.from('scores').insert({
    user_id:          user.id,
    source_kind:      prior.source_kind,
    source_id:        prior.source_id,
    copy_text:        rewritten,
    channel:          prior.channel,
    audience_segment: prior.audience_segment,
    locale:           prior.locale,
    score:            parsed.value.score,
    band:             parsed.value.band,
    demographics:     parsed.value.demographics,
    emotions:         parsed.value.emotions,
    extracts:         parsed.value.extracts,
    policy_flags:     parsed.value.policy_flags,
    predicted_hook:   parsed.value.predicted_hook,
    model_version:    `${MODEL}+${SCORE_MODEL}`,
    prompt_tokens:    usage.input_tokens,
    output_tokens:    usage.output_tokens,
    boost_iteration:  prior.boost_iteration + 1,
    parent_score_id:  prior.id,
  }).select('id').single();
  if (insErr) console.error('[boost] insert failed:', insErr.message);

  return NextResponse.json({
    ok: true,
    score_id:   row?.id,
    copy:       rewritten,
    iteration:  prior.boost_iteration + 1,
    max:        MAX_ITERATIONS,
    ...parsed.value,
    credits:    deduct.credits,
  });
}
