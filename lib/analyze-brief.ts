// lib/analyze-brief.ts
//
// Shared MARKETING STRATEGY analysis logic. Originally a shallow brief-
// completeness critique, upgraded (Strategy Analysis task) into an AutoAds-depth
// strategy the whole client core is built on: a strategic summary, the single
// recommended sub-audience (with a Schwartz awareness level), the recommended
// platform + ad-format + funnel (each with a reason), and an offer-stack
// assessment grounded in the client's saved Hormozi stack when one exists.
//
// `analyzeBrief` composes the prompt, runs it through Claude (injectable for
// tests via `run`, mirroring lib/master-studio's StageRunner), and parses the
// tagged response into a StrategyAnalysis. `persistBusinessAnalysis` is a
// separate best-effort helper that writes the analysis onto the client's core
// (client_strategy.business_analysis) when a client is resolvable.
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FRAMEWORKS } from '@/lib/avatar/frameworks';

export interface StrategyAnalysis {
  strategic_summary: { goal: string; core_offer: string; usp: string; constraints: string[] };
  sub_audience:      { name: string; awareness_level: string; persona: string; explanation: string };
  platform_funnel:   { platform: string; ad_format: string; funnel_type: string;
                       platform_reason: string; format_reason: string; funnel_reason: string };
  offer_stack:       { components: string[]; strengths: string[]; assessment: string };
  raw_text:          string;
}

/**
 * Back-compat alias. Old callers/tests imported `BriefAnalysis`; the type is now
 * the richer StrategyAnalysis. (Legacy completeness-shape ROWS already stored in
 * the DB are still rendered by buildAiContext via its legacy branch.)
 */
export type BriefAnalysis = StrategyAnalysis;

/** A saved Hormozi offer stack used to ground the offer-stack assessment. */
export interface OfferStackSeed {
  product_name?: string | null;
  main_offer?:   any;
  bonuses?:      any;
  guarantee?:    string | null;
  full_pitch?:   string | null;
  total_value?:  number | null;
  final_price?:  number | null;
}

/** Calls Claude with a (system, user) prompt and returns the raw text. */
export type BriefRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

function parseList(s: string): string[] {
  return s.split('\n')
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

/** Extract a single-line `key: value` field from inside a tagged block. */
function field(block: string, key: string): string {
  const m = block.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+)$`, 'im'));
  return m ? m[1].trim() : '';
}

/**
 * Extract a list field that starts at `key:` and runs (as `- item` lines or an
 * inline comma/pipe list) until the next `stopKeys` field or the block end.
 * Reuses parseList for the per-line cleanup.
 */
function listField(block: string, key: string, stopKeys: string[] = []): string[] {
  const m = block.match(new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.*)$`, 'im'));
  if (!m || m.index == null) return [];
  let rest = block.slice(m.index + m[0].length);
  for (const sk of stopKeys) {
    const skm = rest.match(new RegExp(`^[ \\t]*${sk}[ \\t]*:`, 'im'));
    if (skm && skm.index != null) rest = rest.slice(0, skm.index);
  }
  const out = parseList(rest);
  const inline = m[1].trim();
  if (inline) {
    out.unshift(...inline.split(/[,|]/).map(s => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean));
  }
  return out.filter(Boolean);
}

/**
 * Build the (system, user) prompt for the senior-strategist analysis. A Hebrew
 * (or locale-selected) tagged block is returned so the same `[TAG]…[/TAG]`
 * extraction that has always parsed reliably keeps working.
 *
 * `contextPrefix` is the Brand DNA + active-client + brief context block the
 * caller prepends; `offerStack` (when present) grounds the OFFER_STACK section.
 */
export function composeStrategyPrompt(
  briefValues: Record<string, string>,
  locale: 'he' | 'en' | 'ar' = 'he',
  contextPrefix = '',
  offerStack?: OfferStackSeed | null,
): { system: string; user: string } {
  const lang = locale === 'he' ? 'בעברית' : locale === 'ar' ? 'بالعربية' : 'in English';

  // Schwartz awareness levels — SAME names as lib/avatar/frameworks.ts (imported
  // so the awareness tag stays consistent with the avatar path).
  const awarenessGuide = FRAMEWORKS.awareness_levels.promptFragment;

  const system = `${contextPrefix}אתה אסטרטג שיווק בכיר ברמת AutoAds. תפקידך לקרוא את בריף הלקוח ולבנות אסטרטגיית שיווק מלאה וברורה: סיכום אסטרטגי, תת-קהל מומלץ אחד לתקיפה, פלטפורמה + פורמט מודעה + סוג משפך מומלצים (כל אחד עם נימוק), והערכת חבילת הצעה (offer stack). חשוב בעומק, היה ספציפי, וכתוב ${lang}.

⛔ כלל-על — אסור להמציא: אל תמציא ואל תבדה שמות של אנשים, בעלי עסקים, מקומות, תאריכים, מחירים, הסמכות, או כל עובדה ספציפית שאינה מופיעה בבריף. אם שם בעל העסק לא ניתן — פנה בצורה כללית (למשל "בעל העסק", "הצוות", "אנחנו") ולעולם אל תמציא שם. השתמש אך ורק בפרטים שהבריף באמת מספק.

חובה למלא offer_stack: תמיד החזר offer_stack מלא ולא ריק — components (מה כלול בהצעה), strengths (חוזקות), ו-assessment (הערכה כוללת). סנתז אותם משדות ההצעה/מחיר/אחריות/בידול/בונוסים שבבריף ומתשובות בעל העסק (Group A), גם כאשר אין שורת חבילת-הצעה שמורה. לעולם אל תחזיר offer_stack ריק; אם פרטי ההצעה דלים — הסק חבילה סבירה ממה שהעסק מוכר וציין במפורש שזו הסקה.

לגבי רמת המודעות (awareness) — בחר רמה אחת בלבד לפי שמות הרמות של יוג׳ין שוורץ:
${awarenessGuide}
השתמש בשם הרמה המדויק (Unaware / Problem-aware / Solution-aware / Product-aware / Most-aware) בשדה awareness.

החזר בפורמט הזה בלבד — שמור על התגים והשדות בדיוק כך:
[STRATEGIC_SUMMARY]
goal: המטרה השיווקית המרכזית של הלקוח במשפט אחד
core_offer: ההצעה המרכזית — מה בעצם נמכר
usp: מה באמת מייחד את ההצעה הזו מול המתחרים
constraints:
- אילוץ או סיכון 1 שצריך לקחת בחשבון (תקציב, רגולציה, עונתיות וכו')
- אילוץ 2
[/STRATEGIC_SUMMARY]
[SUB_AUDIENCE]
name: שם קצר ותיאורי לתת-הקהל המומלץ לתקיפה
awareness: רמת מודעות אחת מהרשימה למעלה
persona: פרסונה תמציתית — מי הם, מה מניע אותם
explanation: למה דווקא תת-הקהל הזה הוא נקודת ההתחלה הנכונה
[/SUB_AUDIENCE]
[PLATFORM_FUNNEL]
platform: הפלטפורמה המומלצת (לדוגמה Meta / Google / TikTok)
ad_format: פורמט המודעה המומלץ (לדוגמה Reels / תמונה בודדת / קרוסלה / וידאו)
funnel_type: סוג המשפך המומלץ (לדוגמה lead-gen / מכירה ישירה / שיחת ייעוץ)
platform_reason: נימוק לבחירת הפלטפורמה
format_reason: נימוק לבחירת הפורמט
funnel_reason: נימוק לבחירת המשפך
[/PLATFORM_FUNNEL]
[OFFER_STACK]
components:
- רכיב 1 בהצעה
- רכיב 2
strengths:
- חוזקה 1 של ההצעה
- חוזקה 2
assessment: הערכה כוללת של עוצמת ההצעה ומה הכי כדאי לחזק
[/OFFER_STACK]`;

  const parts: string[] = [`הבריף:\n${JSON.stringify(briefValues, null, 2)}`];
  if (offerStack && (offerStack.product_name || offerStack.main_offer || offerStack.full_pitch)) {
    parts.push(
      `חבילת ההצעה השמורה של הלקוח (בסס עליה את components / strengths / assessment):\n${JSON.stringify(
        {
          product_name: offerStack.product_name ?? undefined,
          main_offer:   offerStack.main_offer ?? undefined,
          bonuses:      offerStack.bonuses ?? undefined,
          guarantee:    offerStack.guarantee ?? undefined,
          total_value:  offerStack.total_value ?? undefined,
          final_price:  offerStack.final_price ?? undefined,
          full_pitch:   offerStack.full_pitch ?? undefined,
        },
        null,
        2,
      )}`,
    );
  } else {
    parts.push('אין חבילת הצעה שמורה — סנתז offer_stack מלא (components / strengths / assessment) מתוך הבריף עצמו: שדות ההצעה, המחיר, האחריות, הבידול והבונוסים. אל תשאיר אותו ריק.');
  }
  return { system, user: parts.join('\n\n') };
}

/** Back-compat alias for the old prompt-composer name. */
export const composeBriefPrompt = composeStrategyPrompt;

/** Parse Claude's tagged response into a StrategyAnalysis. Never throws. */
export function parseStrategyAnalysis(text: string): StrategyAnalysis {
  const ss = xt(text, 'STRATEGIC_SUMMARY');
  const sa = xt(text, 'SUB_AUDIENCE');
  const pf = xt(text, 'PLATFORM_FUNNEL');
  const os = xt(text, 'OFFER_STACK');

  return {
    strategic_summary: {
      goal:        field(ss, 'goal'),
      core_offer:  field(ss, 'core_offer'),
      usp:         field(ss, 'usp'),
      constraints: listField(ss, 'constraints'),
    },
    sub_audience: {
      name:            field(sa, 'name'),
      awareness_level: field(sa, 'awareness'),
      persona:         field(sa, 'persona'),
      explanation:     field(sa, 'explanation'),
    },
    platform_funnel: {
      platform:        field(pf, 'platform'),
      ad_format:       field(pf, 'ad_format'),
      funnel_type:     field(pf, 'funnel_type'),
      platform_reason: field(pf, 'platform_reason'),
      format_reason:   field(pf, 'format_reason'),
      funnel_reason:   field(pf, 'funnel_reason'),
    },
    offer_stack: {
      components: listField(os, 'components', ['strengths', 'assessment']),
      strengths:  listField(os, 'strengths', ['assessment']),
      assessment: field(os, 'assessment'),
    },
    raw_text: text,
  };
}

/** Back-compat alias for the old parser name. */
export const parseBriefAnalysis = parseStrategyAnalysis;

// Default runner: a real Anthropic call using the same model env var the tools
// route uses. Lazily constructed so importing this module never requires the
// API key (tests inject their own `run`).
let _anthropic: Anthropic | null = null;
const defaultRun: BriefRunner = async (system, user, maxTokens) => {
  _anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const msg = await _anthropic.messages.create({
    model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
  });
  const block = msg.content.find(b => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
};

/**
 * Analyze a brief into a full StrategyAnalysis: compose → run → parse. `run`
 * defaults to a real Anthropic call (same model as the tools route) and is
 * injectable for tests. `offerStack` (when supplied) grounds the offer section.
 */
export async function analyzeBrief(opts: {
  briefValues:    Record<string, string>;
  locale?:        'he' | 'en' | 'ar';
  contextPrefix?: string;
  offerStack?:    OfferStackSeed | null;
  run?:           BriefRunner;
}): Promise<StrategyAnalysis> {
  const { briefValues, locale = 'he', contextPrefix = '', offerStack = null, run = defaultRun } = opts;
  const { system, user } = composeStrategyPrompt(briefValues, locale, contextPrefix, offerStack);
  const text = await run(system, user, 2000);
  return parseStrategyAnalysis(text);
}

/**
 * Best-effort: persist a strategy analysis onto the client-strategy snapshot
 * (client_strategy.business_analysis, one row per client). Upserts on client_id
 * and touches ONLY business_analysis + owner_user_id — it never clobbers the
 * snapshot's avatar or core_generated_at (which the orchestrator owns). No-op
 * when `clientId` is falsy. Errors are logged and swallowed so they never fail
 * the surrounding analysis flow.
 *
 * (Re-pointed from the legacy meta_clients.business_analysis write, which
 * targeted a column that does not exist on prod — a latent silent failure.)
 */
export async function persistBusinessAnalysis(
  supabase: SupabaseClient,
  { userId, clientId, analysis }: {
    userId:   string;
    clientId: string | null | undefined;
    analysis: StrategyAnalysis;
  },
): Promise<void> {
  if (!clientId) return;
  try {
    const { error } = await supabase
      .from('client_strategy')
      .upsert(
        {
          client_id:         clientId,
          owner_user_id:     userId,
          business_analysis: analysis,
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'client_id' },
      );
    if (error) console.error('[persistBusinessAnalysis] upsert failed:', error.message);
  } catch (e: any) {
    console.error('[persistBusinessAnalysis] exception:', e?.message);
  }
}
