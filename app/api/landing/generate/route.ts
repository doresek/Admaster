import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { TEMPLATES_BY_ID, type LandingTemplate } from '@/lib/landing-templates';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

// POST /api/landing/generate
// body: { template, brief, locale }
// returns: { content: LandingContent }
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { template, brief, locale = 'he' } = await req.json() as {
    template: LandingTemplate;
    brief:    string;
    locale?:  'he' | 'en' | 'ar';
  };

  if (!template || !brief?.trim()) {
    return NextResponse.json({ error: 'Missing template or brief' }, { status: 400 });
  }

  const def = TEMPLATES_BY_ID[template];
  if (!def) return NextResponse.json({ error: 'Invalid template' }, { status: 400 });

  // 5 credits — landing-page generation is a heavy multi-section AI call.
  // We re-use the 'campaign' action since 'lp' isn't a registered CreditAction
  // and this matches the heaviness of a one-shot campaign generation.
  const deduct = await deductCredits(supabase, user.id, 'campaign');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  try {

    const lang = locale === 'he' ? 'בעברית' : locale === 'ar' ? 'בערבית' : 'in English';

    const system = `אתה מומחה ליצירת דפי נחיתה ממירים. צור תוכן ${lang} עבור דף מסוג "${def.name}".

מבנה הדף: ${def.sections.join(' → ')}
תיאור: ${def.description}

החזר תוכן בפורמט הזה בלבד (אל תוסיף טקסט מחוץ לתגים):
[HERO_TITLE]כותרת ראשית קצרה וחדה (עד 60 תווים)[/HERO_TITLE]
[HERO_SUB]תת-כותרת — 1-2 משפטים שמסבירים את ה-value (עד 200 תווים)[/HERO_SUB]
[CTA]טקסט הכפתור (2-4 מילים, בלשון ציווי)[/CTA]
[BULLETS]
- נקודה 1
- נקודה 2
- נקודה 3
- נקודה 4
[/BULLETS]
[FAQ]
שאלה 1?||תשובה 1
שאלה 2?||תשובה 2
שאלה 3?||תשובה 3
[/FAQ]
${def.sections.includes('testimonials') ? `[TESTIMONIALS]
שם 1||תפקיד 1||ציטוט 1
שם 2||תפקיד 2||ציטוט 2
[/TESTIMONIALS]` : ''}
${def.sections.includes('qualifier') ? `[QUALIFIER]פסקה קצרה שמסננת את הקהל הנכון[/QUALIFIER]` : ''}
${def.sections.includes('trust') ? `[TRUST]
🏆||כותרת trust signal 1
⭐||כותרת trust signal 2
📈||כותרת trust signal 3
[/TRUST]` : ''}
${def.sections.includes('story') ? `[STORY_TITLE]כותרת לסיפור[/STORY_TITLE]
[STORY_BODY]פסקה בת 3-4 משפטים[/STORY_BODY]` : ''}`;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: `בריף: ${brief}` }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text ?? '';

    // Parse output back into LandingContent
    const bulletsRaw = xt(text, 'BULLETS');
    const bullets = bulletsRaw
      .split('\n')
      .map(l => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean);

    const faqRaw = xt(text, 'FAQ');
    const faq = faqRaw
      .split('\n')
      .map(l => l.split('||').map(s => s.trim()))
      .filter(parts => parts.length === 2 && parts[0] && parts[1])
      .map(([q, a]) => ({ q, a }));

    const testimonialsRaw = xt(text, 'TESTIMONIALS');
    const testimonials = testimonialsRaw
      ? testimonialsRaw.split('\n')
          .map(l => l.split('||').map(s => s.trim()))
          .filter(parts => parts.length >= 3 && parts[2])
          .map(([name, role, quote]) => ({ name, role, quote }))
      : undefined;

    const trustRaw = xt(text, 'TRUST');
    const trust_signals = trustRaw
      ? trustRaw.split('\n')
          .map(l => l.split('||').map(s => s.trim()))
          .filter(parts => parts.length === 2 && parts[1])
          .map(([icon, label]) => ({ icon, label }))
      : undefined;

    const content = {
      ...def.defaultContent,
      hero_title:    xt(text, 'HERO_TITLE') || def.defaultContent.hero_title,
      hero_sub:      xt(text, 'HERO_SUB')   || def.defaultContent.hero_sub,
      cta_label:     xt(text, 'CTA')        || def.defaultContent.cta_label,
      bullets:       bullets.length > 0 ? bullets : def.defaultContent.bullets,
      faq:           faq.length > 0 ? faq : def.defaultContent.faq,
      ...(testimonials   && testimonials.length   > 0 ? { testimonials }   : {}),
      ...(trust_signals  && trust_signals.length  > 0 ? { trust_signals }  : {}),
      ...(xt(text, 'QUALIFIER')   ? { qualifier: xt(text, 'QUALIFIER') } : {}),
      ...(xt(text, 'STORY_TITLE') ? { story: [{ title: xt(text, 'STORY_TITLE'), body: xt(text, 'STORY_BODY') }] } : {}),
    };

    return NextResponse.json({ content, credits: deduct.credits });
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'campaign', deduct.cost);
    console.error('[landing/generate]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
