import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { TEMPLATES_BY_ID, type LandingTemplate } from '@/lib/landing-templates';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { coerceDesignSpec, FONT_PAIRS } from '@/lib/landing-design';
import { getSkillContext } from '@/lib/landing-skill-loader';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

// POST /api/landing/generate
// Approach A: Single Claude call with the full ui-ux-pro-max skill knowledge
// loaded as a CACHED system prompt block (paid once, then ~free).
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { template, brief, locale = 'he', hero_image, image_kind, target_audience, target_emotion, auto_bg } = await req.json() as {
    template:   LandingTemplate;
    brief:      string;
    locale?:    'he' | 'en' | 'ar';
    hero_image?:      string;
    image_kind?:      'product' | 'portrait' | 'logo' | 'lifestyle' | 'other';
    target_audience?: string;
    target_emotion?:  string;
    auto_bg?:         boolean;  // ask AI to generate a background image via Ideogram
  };

  if (!template || !brief?.trim()) {
    return NextResponse.json({ error: 'Missing template or brief' }, { status: 400 });
  }

  const def = TEMPLATES_BY_ID[template];
  if (!def) return NextResponse.json({ error: 'Invalid template' }, { status: 400 });

  const deduct = await deductCredits(supabase, user.id, 'campaign');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  // Recent landings + unified AI context (Brand DNA + active client + brief)
  const activeClientId = readActiveClientCookie(req.headers.get('cookie') ?? '');
  const [priorRes, aiCtx] = await Promise.all([
    supabase.from('landing_pages').select('content').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
    buildAiContext(supabase, { userId: user.id, clientId: activeClientId }),
  ]);

  const priorDesigns = (priorRes.data ?? [])
    .map((p: any) => p?.content?.design)
    .filter(Boolean)
    .slice(0, 5);

  try {
    const lang = locale === 'he' ? 'בעברית' : locale === 'ar' ? 'בערבית' : 'in English';
    const FONT_OPTIONS = Object.keys(FONT_PAIRS).join(' | ');

    // Brand DNA + active client + brief — pre-assembled by buildAiContext()
    const brandSummary = aiCtx.combined ? `\n${aiCtx.combined}\n` : '';

    const priorSummary = priorDesigns.length === 0
      ? ''
      : `\n═══ RECENT DESIGNS BY THIS USER — DO NOT REPEAT ═══\nThe user already has ${priorDesigns.length} landing page(s). Do not reuse these palettes, fonts, or hero variants — pick genuinely different options to give the user visual variety:\n${priorDesigns.map((d: any, i: number) =>
  `${i+1}. primary=${d.primary} bg=${d.bg} fonts=${d.fonts} hero=${d.hero} card=${d.card}`).join('\n')}\nIf this brief's sector matches a prior page, find a DIFFERENT-but-still-appropriate palette (e.g. mocha+vanilla vs cinnamon+cream vs honey+rose — all work for a bakery).`;

    // ─── System prompt — split into [cacheable knowledge] + [task instructions]
    // Anthropic prompt cache: knowledge block is cached after first call (90% cheaper, faster).
    const skillContext = getSkillContext();

    const taskInstructions = `You are a Senior UI/UX Designer + Senior Copywriter. Use the design intelligence above (frontend-design + ui-ux-pro-max) to design a landing page ${lang} for template "${def.name}".

Section structure: ${def.sections.join(' → ')}
Template description: ${def.description}
${target_audience ? `Target audience: ${target_audience}` : ''}
${target_emotion ? `Emotion to evoke: ${target_emotion}` : ''}

═══ RULE #1 (NON-NEGOTIABLE): RESPECT THE BRIEF ═══
The brief describes a SPECIFIC business sector. Your entire output MUST be about THAT business:
- If the brief says "מאפייה / קינוחים / עוגות" → it's a BAKERY. Headlines about pastries, customers buying cakes. NOT marketing agency, NOT SaaS, NOT consulting.
- If it says "יוגה / מדיטציה" → wellness studio. NOT B2B.
- If it says "עורך דין" → law firm.
- If it says "מסעדה" → restaurant.
- Read the brief 3 times. The hero_title MUST reflect THAT specific business.
- Never default to "agency / consultant / SaaS / digital marketing" unless the brief explicitly mentions them.

═══ RULE #2 (NON-NEGOTIABLE): COLOR VARIETY ═══
Most landing pages from generic AI are blue+purple. STOP. Pick palette by sector:
- Bakery / patisserie / cafe → warm cream + caramel + chocolate + dusty rose (#F5E6D3 + #8B4513 + #D2691E + #C71585 family)
- Yoga / wellness / spa → sage + cream + dusty terracotta (#9CAF88 + #EFE4D2 + #C97B63)
- Law / finance / B2B → navy + ivory + brass (#1A2B4A + #F4F0E8 + #B8953A)
- Restaurant → deep burgundy + butter + olive (#722F37 + #F5DEB3 + #708238)
- Tech / SaaS → ONLY here use electric blue / cyan / purple
- Beauty / fashion → blush + plum + champagne (#F4C7C3 + #5D2F4F + #E9D9B5)
- Children / family → coral + sky + sunshine (#FF7F50 + #87CEEB + #FFD700)
- Education / coaching → forest green + sand + amber (#2D5016 + #E5D4B1 + #F59E0B)

**FORBIDDEN unless brief explicitly demands**: pure blue (#2563EB, #0A7AFF, #3D9FFF) and purple gradients on white. These are the cliché "generic AI" colors. Use them ONLY for tech/SaaS/fintech and even then prefer cobalt/indigo variants.
${brandSummary}
${priorSummary}

═══ RULE #3: TYPOGRAPHY VARIETY ═══
NEVER pick Inter+Inter or Space Grotesk+Inter by default. Pick by sector:
- Bakery → playful (Fraunces) or editorial (Playfair) — never bold_sans
- Luxury → luxury (Cormorant) or editorial (Playfair Display)
- Wellness → humanist (Frank Ruhl Libre + Heebo)
- Tech → tech_minimal — but ONLY for actual tech briefs
- Editorial / personal brand → editorial or classic_serif
- Bold cosmetics → bold_sans

═══ Process ═══
1. Read brief. Identify EXACT sector (re-read 3 times).
2. From colors.csv, find a row whose "Product Type" matches the sector — use those exact hexes.
3. From typography.csv, pick the pairing whose "Mood/Style Keywords" matches the brand feeling.
4. From landing.csv, pick a pattern that fits.
5. From styles.csv, pick a style that complements (Brutalism for bold? Editorial for refined? Glassmorphism for tech?).
6. Apply UX guidelines (contrast, hit areas).
7. Write copy IN HEBREW that is specific to THAT business — names of products/services from the brief itself.
${hero_image ? `
6. **IMPORTANT — there is a hero image** (${image_kind ?? 'image'}): ${hero_image}
   - If kind=product → prefer hero="split" so the image sits prominently next to the headline.
   - If kind=portrait (person/founder/presenter) → prefer hero="split" or hero="magazine" with the portrait as the visual anchor.
   - If kind=logo → prefer hero="minimal" or hero="centered", logo sits above eyebrow.
   - If kind=lifestyle → prefer hero="dramatic" or hero="gradient_blob" with image as background context.
   - The image is rendered by the renderer — do NOT mention it in copy; design around it.
   - Choose a palette whose primary/accent complement typical image colors (assume real-world photo unless told otherwise).
` : ''}

Return ONE valid JSON object between [JSON]...[/JSON] tags. No markdown, no explanations outside the tags.

[JSON]
{
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
    "eyebrow":   "short label above hero (up to 40 chars)",
    "hero_emoji": "single emoji"
  },
  "bg_image_prompt": "If no upload exists and the brief benefits from a background photo (bakery, restaurant, spa, fashion, lifestyle, etc.) — write a detailed Ideogram prompt in English for a HERO BACKGROUND IMAGE. Style: editorial photography, soft natural lighting, depth of field, no text overlays, no people unless brand is personal. Examples: 'Artisan bakery interior, golden hour, warm cream tones, croissants on marble counter, shallow depth of field, editorial style' OR 'Cozy yoga studio, soft morning light, sage green walls, wooden floor, candle lit, photographic'. Leave empty string if not applicable (B2B, SaaS, abstract). Max 200 chars.",
  "design_notes": "1-2 sentences citing which colors.csv row / landing.csv pattern / styles.csv style you used and why",
  "hero_title":   "headline ≤70 chars — specific promise, not generic marketing",
  "hero_sub":     "subhead 1-2 sentences ≤220 chars — what/who/how/result",
  "cta_label":    "button label, 2-4 words, first-person imperative",
  "bullets":      ["benefit 1 (emotional/practical, not feature)", "benefit 2", "benefit 3", "benefit 4"],
  "faq":          [{"q":"real question","a":"honest answer"}, {"q":"...","a":"..."}, {"q":"...","a":"..."}]${def.sections.includes('testimonials') ? ',\n  "testimonials": [{"name":"first + last","role":"job/biz","quote":"specific quote with numeric result"},{...}]' : ''}${def.sections.includes('qualifier') ? ',\n  "qualifier":   "filtering paragraph — \\"not for everyone. for X who Y and want Z\\""' : ''}${def.sections.includes('trust') ? ',\n  "trust_signals": [{"icon":"🏆","label":"trust 1 with number"},{"icon":"⭐","label":"trust 2"},{"icon":"📈","label":"trust 3"}]' : ''}${def.sections.includes('story') ? ',\n  "story": [{"title":"curiosity-driving title","body":"3-4 sentences, personal story, strong hook"}]' : ''}
}
[/JSON]

Rules:
- 6-digit hex colors only (#XXXXXX), not #RGB shorthand
- All bg+text combinations must pass WCAG AA (4.5:1) — use the colors.csv contrast notes
- Hero variant must match landing.csv pattern intent
- Font choice must match the brand mood from typography.csv "Mood/Style Keywords" column
- Every landing page must look genuinely different from previous ones — pick uncommon combos when justified`;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 3000,
      system: [
        {
          type: 'text',
          text: skillContext,
          cache_control: { type: 'ephemeral' },  // Cache the 65K-token knowledge block
        },
        {
          type: 'text',
          text: taskInstructions,
        },
      ] as any,
      messages: [{ role: 'user', content: `בריף: ${brief}` }],
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

    const design = coerceDesignSpec(parsed.design);

    const content: any = {
      ...def.defaultContent,
      hero_title: typeof parsed.hero_title === 'string' && parsed.hero_title.trim()
                    ? parsed.hero_title.trim() : def.defaultContent.hero_title,
      hero_sub:   typeof parsed.hero_sub   === 'string' && parsed.hero_sub.trim()
                    ? parsed.hero_sub.trim()   : def.defaultContent.hero_sub,
      cta_label:  typeof parsed.cta_label  === 'string' && parsed.cta_label.trim()
                    ? parsed.cta_label.trim()  : def.defaultContent.cta_label,
      bullets:    Array.isArray(parsed.bullets) && parsed.bullets.length
                    ? parsed.bullets.filter((b: any) => typeof b === 'string' && b.trim()).slice(0, 6)
                    : def.defaultContent.bullets,
      faq:        Array.isArray(parsed.faq)
                    ? parsed.faq.filter((f: any) => f?.q && f?.a).slice(0, 8)
                    : def.defaultContent.faq,
      design,
    };

    if (Array.isArray(parsed.testimonials)) {
      content.testimonials = parsed.testimonials.filter((t: any) => t?.name && t?.quote).slice(0, 6);
    }
    if (Array.isArray(parsed.trust_signals)) {
      content.trust_signals = parsed.trust_signals.filter((t: any) => t?.label).slice(0, 6);
    }
    if (typeof parsed.qualifier === 'string' && parsed.qualifier.trim()) {
      content.qualifier = parsed.qualifier.trim();
    }
    if (Array.isArray(parsed.story)) {
      content.story = parsed.story.filter((s: any) => s?.title && s?.body).slice(0, 4);
    }

    // Attach uploaded image — renderer uses content.hero_image
    if (hero_image && typeof hero_image === 'string') {
      content.hero_image = hero_image;
      (content as any).image_kind = image_kind ?? 'other';
    }

    // Auto-generate background image with Ideogram if requested
    const bgPrompt = typeof parsed.bg_image_prompt === 'string' ? parsed.bg_image_prompt.trim() : '';
    if (auto_bg && !hero_image && bgPrompt && process.env.IDEOGRAM_API_KEY) {
      try {
        const imgRes = await fetch('https://api.ideogram.ai/generate', {
          method: 'POST',
          headers: {
            'Api-Key': process.env.IDEOGRAM_API_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_request: {
              prompt:        bgPrompt,
              aspect_ratio:  'ASPECT_16_9',
              model:         'V_2',
              style_type:    'REALISTIC',
              magic_prompt_option: 'AUTO',
            },
          }),
        });
        const imgData = await imgRes.json();
        const imgUrl = imgData?.data?.[0]?.url;
        if (imgUrl) {
          content.hero_image = imgUrl;
          (content as any).image_kind = 'lifestyle';
          // Save the generated image to history for the user
          await supabase.from('generated_images').insert({
            user_id:      user.id,
            prompt:       `[landing-bg] ${bgPrompt}`,
            image_url:    imgUrl,
            provider:     'ideogram',
            style:        'REALISTIC',
            aspect_ratio: 'ASPECT_16_9',
          });
        }
      } catch (imgErr) {
        console.error('[landing/generate] bg image failed:', imgErr);
        // Don't fail the whole request — just continue without bg image
      }
    }

    // Log design notes for debugging (Claude's reasoning)
    if (typeof parsed.design_notes === 'string') {
      console.log('[landing/generate] design notes:', parsed.design_notes);
    }

    // Usage info — tells us if cache hit
    const usage = (msg as any).usage;
    if (usage) {
      console.log('[landing/generate] usage:', {
        input: usage.input_tokens,
        cached_read: usage.cache_read_input_tokens,
        cache_creation: usage.cache_creation_input_tokens,
        output: usage.output_tokens,
      });
    }

    return NextResponse.json({ content, credits: deduct.credits, design_notes: parsed.design_notes });
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'campaign', deduct.cost);
    console.error('[landing/generate]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
