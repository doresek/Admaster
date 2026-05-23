import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_COSTS, type CreditAction } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    const cost = CREDIT_COSTS[action];
    if (!cost) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    // 2. Deduct credits atomically via DB function
    const { data: deductResult } = await supabase.rpc('deduct_credits', {
      p_user_id: user.id,
      p_action:  action,
      p_cost:    cost,
    });

    if (!deductResult?.success) {
      return NextResponse.json(
        { error: 'insufficient_credits', credits: deductResult?.credits ?? 0 },
        { status: 402 }
      );
    }

    // 3. Call Claude
    const message = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages:   [{ role: 'user', content: prompt }],
    });

    const text = message.content.find(b => b.type === 'text')?.text ?? '';

    // 4. Save to generated_content
    await supabase.from('generated_content').insert({
      user_id:  user.id,
      type:     action,
      platform: body.platform ?? null,
      input:    { prompt: prompt.substring(0, 500) },
      output:   { text: text.substring(0, 2000) },
    });

    return NextResponse.json({ text, credits: deductResult.credits });

  } catch (err: any) {
    console.error('[AI route]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
