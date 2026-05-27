import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

// POST /api/quick-campaign
// body: { brief, platform, locale, framework?, generateImage? }
// returns: {
//   texts: [{ framework, post, hashtags, wa, image_prompt }],
//   image_urls: string[] (if generateImage and provider configured)
// }
//
// "Campaign" = 3 ad variants in 3 different frameworks + matching image prompts (and optionally generated images)
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    brief,
    platform = 'Facebook',
    locale = 'he',
    generateImage = false,
  } = await req.json() as {
    brief:    string;
    platform?: string;
    locale?:   'he' | 'en' | 'ar';
    generateImage?: boolean;
  };

  if (!brief?.trim()) return NextResponse.json({ error: 'Missing brief' }, { status: 400 });

  const deduct = await deductCredits(supabase, user.id, 'campaign');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  try {

    const frameworks: FrameworkId[] = ['pas', 'aida', 'bab']; // 3 variants
    const lang = locale === 'en' ? 'in English' : locale === 'ar' ? 'بالعربية' : 'בעברית';

    // Build a single combined prompt to generate all 3 variants in one shot
    const sysParts = frameworks.map((f, i) => {
      const fw = FRAMEWORKS_BY_ID[f];
      return `[VARIANT ${i+1}: ${fw.name_en}]\n${fw.prompt}`;
    }).join('\n\n');

    const system = `אתה מומחה קופירייטינג ל-${platform}. צור 3 גרסאות מודעה ${lang}, כל גרסה לפי framework שונה.

${sysParts}

החזר בפורמט הזה בלבד:
[V1_POST]טקסט המודעה לגרסה 1 (PAS), עם אמוג'ים ו-CTA[/V1_POST]
[V1_HASHTAGS]8-12 hashtags[/V1_HASHTAGS]
[V1_WA]גרסה קצרה ל-WhatsApp[/V1_WA]
[V1_IMG]Detailed English prompt for Ideogram/Midjourney for variant 1[/V1_IMG]
[V2_POST]טקסט המודעה לגרסה 2 (AIDA)[/V2_POST]
[V2_HASHTAGS]8-12 hashtags[/V2_HASHTAGS]
[V2_WA]גרסה ל-WhatsApp[/V2_WA]
[V2_IMG]Detailed English image prompt for variant 2[/V2_IMG]
[V3_POST]טקסט המודעה לגרסה 3 (BAB)[/V3_POST]
[V3_HASHTAGS]8-12 hashtags[/V3_HASHTAGS]
[V3_WA]גרסה ל-WhatsApp[/V3_WA]
[V3_IMG]Detailed English image prompt for variant 3[/V3_IMG]`;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 3500,
      system,
      messages: [{ role: 'user', content: `בריף: ${brief}` }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text ?? '';

    const variants = [1, 2, 3].map(n => ({
      framework:     frameworks[n - 1],
      framework_name: FRAMEWORKS_BY_ID[frameworks[n - 1]].name_en,
      post:          xt(text, `V${n}_POST`),
      hashtags:      xt(text, `V${n}_HASHTAGS`).split(/\s+/).filter(h => h.startsWith('#')),
      wa:            xt(text, `V${n}_WA`),
      image_prompt:  xt(text, `V${n}_IMG`),
      image_url:     null as string | null,
    })).filter(v => v.post);

    // Save each variant to generated_content
    if (variants.length > 0) {
      await supabase.from('generated_content').insert(
        variants.map(v => ({
          user_id:  user.id,
          type:     'campaign',
          platform,
          input:    { brief: brief.substring(0, 500), framework: v.framework },
          output:   { post: v.post, hashtags: v.hashtags, wa: v.wa, image_prompt: v.image_prompt },
        }))
      );
    }

    // Optional: generate images for each variant (best effort; failures don't block the response)
    if (generateImage && process.env.IDEOGRAM_API_KEY) {
      await Promise.all(variants.map(async (v) => {
        if (!v.image_prompt) return;
        try {
          const res = await fetch('https://api.ideogram.ai/generate', {
            method: 'POST',
            headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_request: {
                prompt: v.image_prompt,
                aspect_ratio: 'ASPECT_1_1',
                model: 'V_2',
                style_type: 'REALISTIC',
                magic_prompt_option: 'AUTO',
              },
            }),
          });
          const d = await res.json();
          v.image_url = d?.data?.[0]?.url ?? null;
          if (v.image_url) {
            await supabase.from('generated_images').insert({
              user_id: user.id, prompt: v.image_prompt, image_url: v.image_url,
              provider: 'ideogram', style: 'REALISTIC', aspect_ratio: 'ASPECT_1_1',
            });
          }
        } catch {} // tolerated
      }));
    }

    return NextResponse.json({ variants, credits: deduct.credits });
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'campaign', deduct.cost);
    console.error('[quick-campaign]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
