// lib/intelligence/analyze.ts
//
// The DEEP 3-layer analysis. Where lib/analyze-brief.ts produces a single
// flat StrategyAnalysis, this analyzer asks a senior strategist to go BENEATH
// the brief's stated answers and emit a SET of discrete, tagged beliefs (atoms)
// across three layers:
//   • business  — the REAL solution, REAL USP, pains actually solved, true value
//   • customers — pains, desires, aspirations, dreams, UNSPOKEN wants,
//                 objections, awareness level, persona
//   • bridge    — translations of business-value -> customer-want, angles, hooks,
//                 the recommended platform + funnel
//
// Each atom carries a confidence in [0..1] and a one-line rationale. The LLM
// call is injectable (mirroring lib/master-studio's StageRunner) so tests need
// no API key; the default runner is a real Anthropic call using CLAUDE_MODEL.
// Parsing NEVER throws — a malformed response yields an empty candidate list.
import Anthropic from '@anthropic-ai/sdk';
import {
  KINDS,
  type ClientInsight,
  type InsightCandidate,
  type InsightLayer,
} from './types';

/** Calls the LLM with a (system, user) prompt and returns the raw text. */
export type AnalysisRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

const LAYERS: InsightLayer[] = ['business', 'customers', 'bridge'];

/** Extract content inside `[TAG]…[/TAG]`. Empty string if missing. */
function xt(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  return m ? m[1].trim() : '';
}

/**
 * Build the (system, user) prompt for the deep 3-layer analysis. Hebrew, senior
 * strategist. The model is instructed to dig beneath the stated answers and to
 * RECONCILE with what we already believe (the active atoms are listed so it can
 * corroborate, refine, or contradict them rather than blindly re-stating).
 */
export function composeAnalysisPrompt(
  briefValues:            Record<string, string>,
  existingActiveInsights: ClientInsight[] = [],
): { system: string; user: string } {
  const kindList = (layer: InsightLayer) => KINDS[layer].join(', ');

  const system = `אתה אסטרטג שיווק בכיר ברמה הגבוהה ביותר. אל תסתפק בתשובות שהלקוח כתב בבריף — חפור מתחתן ותגלה את האמת.

⛔ כלל-על — אסור להמציא: אל תמציא ואל תבדה שמות של אנשים, בעלי עסקים, מקומות, תאריכים, מחירים, הסמכות, או כל עובדה ספציפית שאינה מופיעה בבריף. אם שם בעל העסק לא ניתן — פנה בצורה כללית (למשל "בעל העסק", "הצוות", "אנחנו") ולעולם אל תמציא שם. הסקה אסטרטגית מותרת (וסומנה ב-confidence), אך עובדות ספציפיות — רק כאלה שהבריף באמת מספק.

המשימה: לפרק את הידע על הלקוח לאטומים בודדים, ברורים וניתנים לפעולה, בשלוש שכבות:

1. business (העסק) — מה באמת הפתרון שהעסק מספק (לא מה שכתוב), מהו ה-USP האמיתי, אילו כאבים הוא באמת פותר, מהו הערך האמיתי, המטרה השיווקית, ההצעה המרכזית, ואילוצים.
   kinds מותרים: ${kindList('business')}
2. customers (הלקוחות) — כאבים, רצונות, שאיפות, חלומות, רצונות לא-מדוברים (unspoken), התנגדויות, רמת מודעות (Schwartz), ופרסונה.
   kinds מותרים: ${kindList('customers')}
3. bridge (הגשר) — תרגום של ערך עסקי לרצון של הלקוח, זוויות (angles), הוקים (hooks), הפלטפורמה המומלצת, וסוג המשפך.
   kinds מותרים: ${kindList('bridge')}

שאלות בעל העסק (Group A) — שפת הבעלים, המקור הראשי. עבד דרכן ככה:
- own_about, own_differentiator, own_cost_of_no → שכבת business: גזור real_solution, real_usp, true_value, pain_solved (מה באמת נפתר ומה הערך האמיתי).
- own_happy_customer, own_unspoken_need → שכבת customers: גזור persona, desire ו-unspoken_want (במיוחד את הרצון הלא-מדובר).
- own_proof → ראיה עסקית: חזק true_value / pain_solved, ואם יש — גם dream / aspiration של הלקוח.
- את שכבת bridge (value_translation, angle, hook) אל תמפה ישירות מהבריף — גזור אותה מההצלבה של business × customers (איך מתרגמים את הערך העסקי לרצון של הלקוח).
- תשובה שערכה בדיוק "__unsure__" פירושה שבעל העסק סימן "לא בטוח / לא יודע": הסק בזהירות והנמך confidence (≤ 0.4) לכל אטום שנשען עליה בלבד.
- שדות מקצועיים (Group B) שמולאו במפורש — צרוך אותם ב-confidence גבוה יותר כשהם תומכים.

לכל אטום תן:
- layer: business / customers / bridge
- kind: אחד מה-kinds המותרים לשכבה
- content: משפט אחד חד וספציפי (האמת, לא ניסוח שיווקי כללי)
- confidence: מספר בין 0 ל-1 — כמה אתה בטוח (0.9 = ראיה חזקה בבריף; 0.5 = הסקה סבירה; 0.3 = ניחוש מושכל)
- rationale: נימוק קצר במשפט אחד — על מה התבססת

החזר אך ורק את הבלוק הזה, שורה אחת לכל אטום, מופרד בפסיק-אנכי (|), בסדר: layer | kind | content | confidence | rationale
אל תוסיף טקסט מחוץ לבלוק. אל תשתמש ב-| בתוך השדות.

[INSIGHTS]
business | real_usp | ... | 0.8 | ...
customers | pain | ... | 0.7 | ...
bridge | angle | ... | 0.6 | ...
[/INSIGHTS]`;

  const parts: string[] = [`הבריף של הלקוח:\n${JSON.stringify(briefValues, null, 2)}`];

  if (existingActiveInsights.length) {
    const known = existingActiveInsights
      .slice(0, 40)
      .map((i) => `- [${i.layer}/${i.kind}] (conf ${i.confidence.toFixed(2)}) ${i.content}`)
      .join('\n');
    parts.push(
      `מה שאנחנו כבר מאמינים על הלקוח (אטומים פעילים). חזק אותם אם הבריף תומך, חדד אותם, או סתור אותם אם הבריף סותר — אל תחזור עליהם סתם:\n${known}`,
    );
  }

  return { system, user: parts.join('\n\n') };
}

/**
 * Parse the analyzer's `[INSIGHTS]` block into candidates. Lenient and total —
 * malformed lines are skipped, unknown layers dropped, confidence clamped to
 * [0..1] (defaulting to 0.5). NEVER throws.
 */
export function parseAnalysis(raw: string): InsightCandidate[] {
  if (!raw || typeof raw !== 'string') return [];

  // Prefer the tagged block; fall back to the whole text if the model omitted
  // the wrapper but still emitted pipe-delimited rows.
  const block = xt(raw, 'INSIGHTS') || raw;

  const out: InsightCandidate[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.replace(/^[-•*\d.)\s]+/, '').trim();
    if (!trimmed || !trimmed.includes('|')) continue;

    const cols = trimmed.split('|').map((s) => s.trim());
    if (cols.length < 3) continue;

    const layer = cols[0].toLowerCase() as InsightLayer;
    if (!LAYERS.includes(layer)) continue;

    const kind    = cols[1].toLowerCase();
    const content = cols[2];
    if (!kind || !content) continue;

    const confRaw = cols.length > 3 ? parseFloat(cols[3]) : NaN;
    const confidence = Number.isFinite(confRaw) ? Math.max(0, Math.min(1, confRaw)) : 0.5;
    const rationale  = cols.length > 4 ? cols.slice(4).join(' | ').trim() : '';

    out.push({ layer, kind, content, confidence, rationale });
  }
  return out;
}

// ── default LLM runner (real Anthropic call) ───────────────────────────────────
let _anthropic: Anthropic | null = null;
const defaultRun: AnalysisRunner = async (system, user, maxTokens) => {
  _anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const msg = await _anthropic.messages.create({
    model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
  });
  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
};

/**
 * Run the deep analysis: compose -> run -> parse. `run` defaults to a real
 * Anthropic call and is injectable for tests. Parsing never throws; the runner
 * may throw and is the caller's responsibility to wrap.
 */
export async function analyzeToInsights(opts: {
  briefValues:             Record<string, string>;
  existingActiveInsights?: ClientInsight[];
  run?:                    AnalysisRunner;
}): Promise<InsightCandidate[]> {
  const { briefValues, existingActiveInsights = [], run = defaultRun } = opts;
  const { system, user } = composeAnalysisPrompt(briefValues, existingActiveInsights);
  const raw = await run(system, user, 3000);
  return parseAnalysis(raw);
}
