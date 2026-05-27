import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { type CreditAction } from '@/types';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

function parseList(s: string): string[] {
  return s.split('\n')
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

// POST /api/tools
// body: { tool: 'analyze_brief'|'analyze_weak'|'offer_stack', input: ... }
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tool, input, locale = 'he' } = await req.json() as {
    tool:   'analyze_brief' | 'analyze_weak' | 'offer_stack';
    input:  any;
    locale?: 'he' | 'en' | 'ar';
  };

  const action: CreditAction = tool;
  const deduct = await deductCredits(supabase, user.id, action);
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  try {

    const lang = locale === 'he' ? 'בעברית' : locale === 'ar' ? 'بالعربية' : 'in English';
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

    // ─── BRIEF ANALYZER ────────────────────────────────────────
    if (tool === 'analyze_brief') {
      const briefValues = input?.values ?? input;
      const system = `אתה אסטרטג שיווק בכיר. תפקידך לנתח בריף לקוח ולזהות חוזקות, פערים, שאלות חשובות שלא נשאלו, וצעדים קונקרטיים לחיזוק. כתוב ${lang}.

החזר בפורמט הזה בלבד:
[SCORE]ציון שלמות מ-0 עד 100 (רק מספר)[/SCORE]
[STRENGTHS]
- חוזקה 1
- חוזקה 2
- חוזקה 3
[/STRENGTHS]
[GAPS]
- פער 1 — מה חסר ולמה זה חשוב
- פער 2
- פער 3
[/GAPS]
[QUESTIONS]
- שאלה 1 שכדאי לחזור ולשאול את הלקוח
- שאלה 2
- שאלה 3
- שאלה 4
[/QUESTIONS]
[REFINEMENTS]
- שינוי קונקרטי 1
- שינוי קונקרטי 2
- שינוי קונקרטי 3
[/REFINEMENTS]`;

      const prompt = `הבריף:\n${JSON.stringify(briefValues, null, 2)}`;
      const msg = await anthropic.messages.create({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: prompt }] });
      const text = msg.content.find(b => b.type === 'text')?.text ?? '';

      const result = {
        completeness_score: parseInt(xt(text, 'SCORE')) || 0,
        strengths:   parseList(xt(text, 'STRENGTHS')),
        gaps:        parseList(xt(text, 'GAPS')),
        questions:   parseList(xt(text, 'QUESTIONS')),
        refinements: parseList(xt(text, 'REFINEMENTS')),
        raw_text:    text,
      };

      const { data: row } = await supabase.from('brief_analyses').insert({
        user_id:  user.id,
        brief_id: input?.brief_id ?? null,
        ...result,
      }).select().single();

      return NextResponse.json({ ...result, id: row?.id, credits: deduct.credits });
    }

    // ─── WEAK AD ANALYZER ──────────────────────────────────────
    if (tool === 'analyze_weak') {
      const { ad_text, metrics = {} } = input;
      if (!ad_text?.trim()) return NextResponse.json({ error: 'Missing ad_text' }, { status: 400 });

      const metricsStr = Object.entries(metrics).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ');
      const system = `אתה מומחה performance marketing. קיבלת מודעה עם ביצועים חלשים. נתח למה היא נכשלה ובנה גרסה משופרת. כתוב ${lang}.

החזר בפורמט הזה בלבד:
[DIAGNOSIS]משפט אחד שמסכם את הסיבה המרכזית לכישלון[/DIAGNOSIS]
[CAUSES]
- סיבה 1 (hook חלש / offer לא ברור / קהל לא נכון וכו')
- סיבה 2
- סיבה 3
[/CAUSES]
[IMPROVEMENTS]
- שיפור קונקרטי 1
- שיפור קונקרטי 2
- שיפור קונקרטי 3
- שיפור קונקרטי 4
[/IMPROVEMENTS]
[REWRITTEN]
הגרסה המשופרת המלאה של המודעה, מוכנה לפרסום.
[/REWRITTEN]`;

      const prompt = `המודעה:\n${ad_text}\n\nנתוני ביצוע: ${metricsStr || 'לא סופקו'}`;
      const msg = await anthropic.messages.create({ model, max_tokens: 1800, system, messages: [{ role: 'user', content: prompt }] });
      const text = msg.content.find(b => b.type === 'text')?.text ?? '';

      const result = {
        ad_text,
        metrics,
        diagnosis:    xt(text, 'DIAGNOSIS'),
        root_causes:  parseList(xt(text, 'CAUSES')),
        improvements: parseList(xt(text, 'IMPROVEMENTS')),
        rewritten_ad: xt(text, 'REWRITTEN'),
      };

      const { data: row } = await supabase.from('weak_ad_analyses').insert({
        user_id: user.id, ...result,
      }).select().single();

      return NextResponse.json({ ...result, id: row?.id, credits: deduct.credits });
    }

    // ─── OFFER STACK ───────────────────────────────────────────
    if (tool === 'offer_stack') {
      const { product, audience, outcome, current_price, client_id, brief_id } = input;
      if (!product?.trim()) return NextResponse.json({ error: 'Missing product' }, { status: 400 });

      const system = `אתה Alex Hormozi. תפקידך לבנות "Value Stack" — הצעה שלא ניתן לסרב לה. הגדל את הערך הנתפס עד שהמחיר ייראה בלתי-נמנע. כתוב ${lang}.

החזר בפורמט הזה בלבד:
[MAIN]
NAME: שם המוצר/השירות
PRICE: המחיר הסופי המומלץ (מספר בש"ח)
VALUE: ערך נתפס של ההצעה הראשית (מספר בש"ח)
[/MAIN]
[BONUSES]
NAME: שם בונוס 1||VALUE: ערך בש"ח||WHY: למה זה הופך את ההצעה למפתה
NAME: שם בונוס 2||VALUE: ...||WHY: ...
NAME: שם בונוס 3||VALUE: ...||WHY: ...
NAME: שם בונוס 4||VALUE: ...||WHY: ...
[/BONUSES]
[TOTAL_VALUE]סכום הערך הכולל (מספר)[/TOTAL_VALUE]
[ANCHOR]מחיר עיגון — הערך האמיתי שהקהל היה משלם (מספר)[/ANCHOR]
[FINAL_PRICE]המחיר שאתה ידרוש (מספר)[/FINAL_PRICE]
[GUARANTEE]התחייבות / אחריות שמסירה סיכון מהקונה[/GUARANTEE]
[SCARCITY]מה מוגבל בכמות (מספר, מקומות, מלאי)[/SCARCITY]
[URGENCY]דדליין או הסיבה לפעול עכשיו[/URGENCY]
[CTA]קריאה לפעולה (פועל ציווי קצר)[/CTA]
[PITCH]Pitch מלא מוכן להעתקה — 2-3 פסקאות שמשלבות הכל לתסריט מוכן[/PITCH]`;

      const prompt = `מוצר/שירות: ${product}
קהל יעד: ${audience || 'לא צוין'}
תוצאה רצויה: ${outcome || 'לא צוינה'}
מחיר נוכחי: ${current_price || 'לא צוין'}`;

      const msg = await anthropic.messages.create({ model, max_tokens: 2000, system, messages: [{ role: 'user', content: prompt }] });
      const text = msg.content.find(b => b.type === 'text')?.text ?? '';

      const mainBlock = xt(text, 'MAIN');
      const mainName  = (mainBlock.match(/NAME:\s*(.*)/)  ?? [])[1]?.trim() ?? '';
      const mainPrice = parseInt((mainBlock.match(/PRICE:\s*(\d[\d,]*)/) ?? [])[1]?.replace(/,/g,'') ?? '0') || 0;
      const mainValue = parseInt((mainBlock.match(/VALUE:\s*(\d[\d,]*)/) ?? [])[1]?.replace(/,/g,'') ?? '0') || 0;

      const bonuses = xt(text, 'BONUSES').split('\n')
        .map(l => l.trim()).filter(Boolean)
        .map(l => {
          const name  = (l.match(/NAME:\s*(.*?)(?:\|\||$)/) ?? [])[1]?.trim() ?? '';
          const value = parseInt((l.match(/VALUE:\s*(\d[\d,]*)/) ?? [])[1]?.replace(/,/g,'') ?? '0') || 0;
          const why   = (l.match(/WHY:\s*(.*?)(?:\|\||$)/) ?? [])[1]?.trim() ?? '';
          return { name, value, why_it_matters: why };
        })
        .filter(b => b.name);

      const num = (tag: string) => parseInt((xt(text, tag).match(/\d[\d,]*/) ?? [])[0]?.replace(/,/g,'') ?? '0') || 0;

      const result = {
        product_name:   product,
        target_outcome: outcome ?? null,
        main_offer:     { name: mainName, price: mainPrice, value: mainValue },
        bonuses,
        total_value:    num('TOTAL_VALUE'),
        price_anchor:   num('ANCHOR'),
        final_price:    num('FINAL_PRICE'),
        guarantee:      xt(text, 'GUARANTEE'),
        scarcity:       xt(text, 'SCARCITY'),
        urgency:        xt(text, 'URGENCY'),
        cta:            xt(text, 'CTA'),
        full_pitch:     xt(text, 'PITCH'),
      };

      const { data: row } = await supabase.from('offer_stacks').insert({
        user_id:   user.id,
        client_id: client_id ?? null,
        brief_id:  brief_id ?? null,
        ...result,
      }).select().single();

      return NextResponse.json({ ...result, id: row?.id, credits: deduct.credits });
    }

    return NextResponse.json({ error: 'Unknown tool' }, { status: 400 });
  } catch (err: any) {
    // Refund credits on any failure after deduction
    await refundCredits(supabase, user.id, action, deduct.cost);
    console.error('[tools]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
