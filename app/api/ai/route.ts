import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { type CreditAction } from '@/types';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: 30 AI calls / minute per user.
  const rl = checkRateLimit(`ai:${user.id}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = await req.json();
  const { action, system, prompt, maxTokens = 1200 } = body as {
    action: CreditAction;
    system: string;
    prompt: string;
    maxTokens?: number;
  };

  if (!action || !system || !prompt) {
    return NextResponse.json({ error: 'Missing fields: action, system, prompt' }, { status: 400 });
  }

  // 1. Deduct credits
  const deduct = await deductCredits(supabase, user.id, action);
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  // 2. Call Claude — refund on failure so user isn't charged
  let text: string;
  try {
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const message = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages:   [{ role: 'user', content: prompt }],
    });
    text = message.content.find(b => b.type === 'text')?.text ?? '';
  } catch (err: any) {
    await refundCredits(supabase, user.id, action, deduct.cost);
    console.error('[AI route] provider error:', err);
    const status = err?.status || err?.response?.status || 502;
    return NextResponse.json(
      { error: extractErrorMessage(err), refunded: deduct.cost },
      { status: status === 401 ? 502 : status }
    );
  }

  // 3. Save to generated_content (best-effort)
  const { error: insertErr } = await supabase.from('generated_content').insert({
    user_id:  user.id,
    type:     action,
    platform: body.platform ?? null,
    input:    { prompt: prompt.substring(0, 500) },
    output:   { text: text.substring(0, 2000) },
  });
  if (insertErr) console.error('[AI route] insert failed:', insertErr.message);

  return NextResponse.json({ text, credits: deduct.credits });
}
