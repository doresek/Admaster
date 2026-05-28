import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { composeScorePrompt, parseScoreResponse, type ScoreInput, type ScoreChannel } from '@/lib/scoring';
import { matchMetaPolicy } from '@/lib/policy-rules/meta.he';
import { matchGooglePolicy } from '@/lib/policy-rules/google.he';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const SCORE_MODEL = process.env.CLAUDE_SCORE_MODEL || 'claude-haiku-4-5-20251001';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit(`score:${user.id}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = await req.json() as Partial<ScoreInput> & {
    source?: { kind: string; id?: string };
    persist?: boolean;
  };

  if (!body.copy || !body.channel) {
    return NextResponse.json({ error: 'Missing fields: copy, channel' }, { status: 400 });
  }
  if (body.copy.length > 2000) body.copy = body.copy.slice(0, 2000);

  // 1. Deduct
  const deduct = await deductCredits(supabase, user.id, 'score');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  // 2. Pull brand DNA for prompt context
  const { data: userRow } = await supabase.from('users').select('brand').eq('id', user.id).single();
  const input: ScoreInput = {
    copy:    body.copy,
    channel: body.channel as ScoreChannel,
    locale:  body.locale ?? 'he',
    brand:   userRow?.brand,
    audience_segment: body.audience_segment,
  };

  // 3. Call Claude
  const { system, user: userPrompt } = composeScorePrompt(input);
  let text: string;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const message = await anthropic.messages.create({
      model:       SCORE_MODEL,
      max_tokens:  900,
      temperature: 0.2,
      system,
      messages:    [{ role: 'user', content: userPrompt }],
    });
    text  = message.content.find(b => b.type === 'text')?.text ?? '';
    usage = { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens };
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'score', deduct.cost);
    console.error('[score route] provider error:', err);
    return NextResponse.json(
      { error: extractErrorMessage(err), refunded: deduct.cost },
      { status: err?.status || 502 }
    );
  }

  // 4. Parse
  const parsed = parseScoreResponse(text);
  if (!parsed.ok) {
    await refundCredits(supabase, user.id, 'score', deduct.cost);
    console.error('[score route] parse error:', parsed.error, 'raw:', text.slice(0, 300));
    return NextResponse.json({ error: 'parse_failed', refunded: deduct.cost }, { status: 502 });
  }

  // 5. Merge deterministic policy flags with model-emitted flags
  const channelRules = body.channel.startsWith('google') ? matchGooglePolicy(body.copy)
                     : body.channel.startsWith('meta')   ? matchMetaPolicy(body.copy)
                     : [];
  parsed.value.policy_flags = [...channelRules, ...parsed.value.policy_flags];

  // 6. Persist (unless persist:false)
  let score_id: string | undefined;
  if (body.persist !== false) {
    const { data: row, error: insErr } = await supabase.from('scores').insert({
      user_id:          user.id,
      source_kind:      body.source?.kind ?? 'manual',
      source_id:        body.source?.id   ?? null,
      copy_text:        body.copy,
      channel:          body.channel,
      audience_segment: body.audience_segment ?? {},
      locale:           input.locale,
      score:            parsed.value.score,
      band:             parsed.value.band,
      demographics:     parsed.value.demographics,
      emotions:         parsed.value.emotions,
      extracts:         parsed.value.extracts,
      policy_flags:     parsed.value.policy_flags,
      predicted_hook:   parsed.value.predicted_hook,
      model_version:    SCORE_MODEL,
      prompt_tokens:    usage.input_tokens,
      output_tokens:    usage.output_tokens,
      boost_iteration:  0,
    }).select('id').single();
    if (insErr) console.error('[score route] insert failed:', insErr.message);
    else score_id = row?.id;
  }

  return NextResponse.json({
    ok: true,
    score_id,
    ...parsed.value,
    credits: deduct.credits,
  });
}
