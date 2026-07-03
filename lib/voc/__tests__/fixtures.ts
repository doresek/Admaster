// Real-shaped Hebrew fixtures for the voc tests: three source documents that
// exercise the voc-mining craft cases (§1 source hierarchy, §4 Hebrew
// specifics) plus a deterministic MockLlm and canned model outputs whose
// quotes are EXACT spans of the fixtures (the containment gate demands it).

import type { LlmComplete } from '../extract';

// ── fixture 1: Google-reviews paste, dental clinic ────────────────────────────
// Contains: a phone number (PII), a zero-information superlative (skip case),
// a sarcastic review (polarity-inversion case), pain/desire/proof/alternative
// language, a metric + a date that must SURVIVE PII stripping.
export const GOOGLE_REVIEWS_DENTAL = `ביקורות Google — מרפאת שיניים ד"ר לוי

רותי כהן ★★★★★
אחרי שנים של פחד ממרפאות, פחדתי שיכאב ודחיתי את הטיפול. בסוף הגעתי כי הייתי מתביישת לחייך בתמונות. הצוות הרגיע אותי, בלי לחץ, וענו לי תוך דקה בוואטסאפ. אפשר להתקשר אליי: 050-1234567

דנה ★★★★★
מדהים!!! ממליצה!!!

יוסי ★★☆☆☆
ברור, כי יש לי כסף לזרוק על הלבנת שיניים כפולה במחיר.

מיכל ★★★★★
במקום ללכת למרפאה הגדולה בקניון ניסיתי אצלם. סוף סוף יש לי שקט עם הפה. שילמתי 12,000 ₪ ב-15.3.2024 ושווה כל שקל.`;

// ── fixture 2: ad-comments batch ──────────────────────────────────────────────
// The live-wire questions ("כמה זה עולה?", "מיקום?") are objection evidence
// (skill §1: objections to THIS exact offer; §5: hidden-price funnel finding).
export const AD_COMMENTS_BATCH = `תגובות למודעה — קמפיין הלבנת שיניים

שרה: כמה זה עולה?
דוד: מיקום?
נועה: פחדתי שיכאב אבל הבנות שם מקסימות
רן: כמעט לא באתי כי אין חניה בסביבה`;

// ── fixture 3: "ממליצים על…?" community thread ───────────────────────────────
// The richest Israeli VoC format (§4): the asker reveals trigger + objections;
// the comments reveal the comparison set, identity phrases and trust markers.
export const COMMUNITY_THREAD = `פוסט בקבוצת "מומלצים ראשון לציון":
ממליצים על רופא שיניים לילדים באזור? אחרי שהילד אמר לי שכואב לו כבר שבוע, ניסיתי את המרפאה של הקופה ונאלצתי לחכות חודשיים.

תגובות:
- לכי לד"ר לוי, אמא של שלושה פה וכולם מטופלים אצלו. בלי לחץ ובלי הפחדות.
- אנחנו הלכנו למרפאת סמייל במקום, פחות מרוצים.`;

// ── MockLlm ───────────────────────────────────────────────────────────────────

/** Deterministic LlmComplete: canned response(s), prompts recorded. */
export class MockLlm implements LlmComplete {
  readonly prompts: string[] = [];
  private readonly responses: string[];
  constructor(...responses: string[]) {
    this.responses = responses;
  }
  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const next = this.responses.length > 1 ? this.responses.shift() : this.responses[0];
    if (next === undefined) throw new Error('MockLlm: no canned response left');
    return next;
  }
}

/** LlmComplete that always throws — the network-failure case. */
export class ThrowingLlm implements LlmComplete {
  async complete(): Promise<string> {
    throw new Error('llm unavailable');
  }
}

// ── canned model outputs (quotes are exact spans of the fixtures above) ──────

/** Well-behaved extraction over GOOGLE_REVIEWS_DENTAL. */
export const DENTAL_EXTRACTION_JSON = JSON.stringify({
  quotes: [
    {
      quote: 'פחדתי שיכאב',
      extractable: 'objection',
      polarity: 'positive',
      segment_tags: { gender: 'female' },
      funnel_fit: 'MOFU',
      target_hint: 'פחד שהטיפול יכאב',
    },
    {
      quote: 'הייתי מתביישת לחייך',
      extractable: 'pain',
      polarity: 'positive',
      segment_tags: { gender: 'female' },
      funnel_fit: 'TOFU',
    },
    {
      quote: 'בלי לחץ',
      extractable: 'proof',
      polarity: 'positive',
      segment_tags: {},
      funnel_fit: 'BOFU',
    },
    {
      quote: 'במקום ללכת למרפאה הגדולה בקניון',
      extractable: 'alternative',
      polarity: 'neutral',
      segment_tags: {},
      funnel_fit: 'MOFU',
    },
  ],
});

/** Output whose second quote is FABRICATED (not a span of the source). */
export const FABRICATED_EXTRACTION_JSON = JSON.stringify({
  quotes: [
    { quote: 'פחדתי שיכאב', extractable: 'objection', polarity: 'positive', segment_tags: {}, funnel_fit: 'MOFU' },
    { quote: 'הטיפול הזה שינה לי את החיים לגמרי', extractable: 'desire', polarity: 'positive', segment_tags: {}, funnel_fit: null },
  ],
});

export const EMPTY_EXTRACTION_JSON = JSON.stringify({ quotes: [] });
