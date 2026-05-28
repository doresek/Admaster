import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

// POST /api/landing/refine
// body: { landing_id, section, instruction }
// section: 'hero' | 'bullets' | 'faq' | 'testimonials' | 'cta' | 'story'
// instruction: free-form Hebrew/English "make this shorter / sharper / more emotional / change CTA to 'now buy' / etc."
// Returns: updated content fragment, applies to DB, deducts 3 credits.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { landing_id, section, instruction } = await req.json() as {
    landing_id: string;
    section:    'hero' | 'bullets' | 'faq' | 'testimonials' | 'cta' | 'story' | 'qualifier';
    instruction: string;
  };

  if (!landing_id || !section || !instruction?.trim()) {
    return NextResponse.json({ error: 'Missing landing_id, section, or instruction' }, { status: 400 });
  }

  // Load existing landing page
  const { data: page, error: loadErr } = await supabase
    .from('landing_pages')
    .select('id, title, content')
    .eq('id', landing_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadErr || !page) {
    return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
  }

  const c = (page.content || {}) as any;

  // Build the section-specific prompt
  const sectionContext = (() => {
    switch (section) {
      case 'hero':
        return `Current hero:
- title: ${c.hero_title || ''}
- subtitle: ${c.hero_sub || ''}
Return JSON: {"hero_title": "...", "hero_sub": "..."}`;
      case 'cta':
        return `Current CTA: ${c.cta_label || ''}
Return JSON: {"cta_label": "..."}`;
      case 'bullets':
        return `Current bullets:\n${(c.bullets || []).map((b: string, i: number) => `${i+1}. ${b}`).join('\n')}
Return JSON: {"bullets": ["...", "...", "...", "..."]}`;
      case 'faq':
        return `Current FAQ:\n${(c.faq || []).map((f: any, i: number) => `Q${i+1}: ${f.q}\nA${i+1}: ${f.a}`).join('\n\n')}
Return JSON: {"faq": [{"q":"...","a":"..."},...]}`;
      case 'testimonials':
        return `Current testimonials:\n${(c.testimonials || []).map((t: any, i: number) => `${i+1}. ${t.name} (${t.role || ''}): "${t.quote}"`).join('\n')}
Return JSON: {"testimonials": [{"name":"...","role":"...","quote":"..."},...]}`;
      case 'qualifier':
        return `Current qualifier: ${c.qualifier || ''}
Return JSON: {"qualifier": "..."}`;
      case 'story':
        return `Current story:\n${(c.story || []).map((s: any, i: number) => `${i+1}. ${s.title}\n${s.body}`).join('\n\n')}
Return JSON: {"story": [{"title":"...","body":"..."},...]}`;
      default:
        return '';
    }
  })();

  // Deduct credits
  const deduct = await deductCredits(supabase, user.id, 'refine');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  try {
    const system = `You are a Senior Copywriter refining a section of an existing landing page in Hebrew.

Page context: ${page.title || ''}
${sectionContext}

Apply this instruction from the user:
"${instruction.trim()}"

Return ONLY a JSON object between [JSON]...[/JSON] tags. No explanations.`;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: 'Refine the section above per the instruction.' }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text ?? '';
    const jsonStr = xt(text, 'JSON') || text;

    let parsed: any = null;
    try { parsed = JSON.parse(jsonStr); }
    catch {
      const m = jsonStr.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI returned malformed JSON');
    }

    // Merge into content
    const next = { ...c, ...parsed };

    // Save
    const { data: updated, error: upErr } = await supabase
      .from('landing_pages')
      .update({ content: next, updated_at: new Date().toISOString() })
      .eq('id', landing_id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (upErr) throw new Error(upErr.message);

    return NextResponse.json({ content: updated.content, credits: deduct.credits });
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'refine', deduct.cost);
    console.error('[landing/refine]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
