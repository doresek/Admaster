import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { coerceDesignSpec, FONT_PAIRS, type DesignSpec } from '@/lib/landing-design';
import { getSkillContext } from '@/lib/landing-skill-loader';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

// POST /api/landing/variants
// body: { landing_id }
// Returns 3 design-spec alternatives for an existing landing page.
// The page's content (text) stays the same — only design tokens vary.
// Cost: 3 credits.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { landing_id } = await req.json() as { landing_id: string };
  if (!landing_id) return NextResponse.json({ error: 'Missing landing_id' }, { status: 400 });

  // Load existing landing page
  const { data: page, error: loadErr } = await supabase
    .from('landing_pages')
    .select('id, title, template, content')
    .eq('id', landing_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (loadErr || !page) {
    return NextResponse.json({ error: 'Landing page not found' }, { status: 404 });
  }

  const currentDesign = (page.content as any)?.design ?? null;

  const deduct = await deductCredits(supabase, user.id, 'lp_variants');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  try {
    const skillContext = getSkillContext();
    const FONT_OPTIONS = Object.keys(FONT_PAIRS).join(' | ');

    const currentHex = currentDesign
      ? `primary=${currentDesign.primary} bg=${currentDesign.bg} hero=${currentDesign.hero} fonts=${currentDesign.fonts}`
      : 'none';

    const taskInstructions = `You are a Senior UI/UX Designer. The user has a landing page with this content:
- Title: ${page.title}
- Hero: ${(page.content as any)?.hero_title || ''}
- Sub: ${(page.content as any)?.hero_sub || ''}

Current design: ${currentHex}

Generate **3 ALTERNATIVE design specs** for this same content. Each variant MUST be genuinely different from the current one AND from each other:
- Variant A: Different palette family (cool vs warm vs neutral)
- Variant B: Different mood (bold vs minimal vs editorial)
- Variant C: Different aesthetic (e.g. brutalist, glassmorphism, neumorphism)

Each variant picks all from valid options below. Use the design intelligence above (ui-ux-pro-max + frontend-design) to ground your choices.

Return ONE JSON object between [JSON]...[/JSON]:

[JSON]
{
  "variants": [
    {
      "label": "1-3 word name in Hebrew",
      "summary": "1-line description in Hebrew of the vibe",
      "design": {
        "hero":      "centered | split | magazine | dramatic | minimal | gradient_blob | cinematic",
        "card":      "flat | soft | glass | bordered | gradient | lifted",
        "fonts":     "${FONT_OPTIONS}",
        "primary":   "#XXXXXX",
        "secondary": "#XXXXXX",
        "accent":    "#XXXXXX",
        "bg":        "#XXXXXX",
        "bgAlt":     "#XXXXXX",
        "surface":   "#XXXXXX",
        "text":      "#XXXXXX",
        "textMuted": "#XXXXXX",
        "border":    "#XXXXXX",
        "density":   "dense | airy | medium",
        "isDark":    true | false,
        "heroBg":    "mesh | orbs | grid | noise | solid | duotone",
        "radius":    "sharp | soft | pillowy",
        "eyebrow":   "short label",
        "hero_emoji": "single emoji"
      }
    },
    { "label": "...", "summary": "...", "design": {...} },
    { "label": "...", "summary": "...", "design": {...} }
  ]
}
[/JSON]

Rules:
- 6-digit hex (#XXXXXX) only
- All bg+text combos pass WCAG AA (4.5:1)
- Each variant must look DRAMATICALLY different — not a small color tweak
- Do NOT repeat the current design
- Apply the same content sector (don't switch sectors)`;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 3500,
      system: [
        { type: 'text', text: skillContext, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: taskInstructions },
      ] as any,
      messages: [{ role: 'user', content: 'Generate 3 design variants for the page above.' }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text ?? '';
    const jsonStr = xt(text, 'JSON') || text;

    let parsed: any = null;
    try { parsed = JSON.parse(jsonStr); }
    catch {
      const m = jsonStr.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed?.variants || !Array.isArray(parsed.variants)) {
      throw new Error('AI returned malformed JSON');
    }

    const variants = parsed.variants
      .filter((v: any) => v?.design)
      .slice(0, 3)
      .map((v: any) => ({
        label:   typeof v.label   === 'string' ? v.label.slice(0, 60)   : 'חלופה',
        summary: typeof v.summary === 'string' ? v.summary.slice(0, 200) : '',
        design:  coerceDesignSpec(v.design) as DesignSpec,
      }));

    if (variants.length === 0) throw new Error('AI returned no valid variants');

    return NextResponse.json({ variants, credits: deduct.credits });
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'lp_variants', deduct.cost);
    console.error('[landing/variants]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
