// lib/master-studio/judge.ts
import {
  type MasterStudioInput, type MarketerPick, type VariantDraft,
  type JudgeResult, type VariantScore, SCORE_DIMS, type ScoreDim,
  SCROLL_STOP_WEIGHT, weightedSelectionScore,
  localeWord, stripFence,
} from './index';

export interface JudgeVariant { marketer: MarketerPick; draft: VariantDraft; }

export function composeJudgePrompt(
  variants: JudgeVariant[], input: MasterStudioInput,
): { system: string; user: string } {
  const pct = Math.round(SCROLL_STOP_WEIGHT * 100);
  const system = `אתה שופט קופי שיווקי שדירג 250,000 מודעות. נקד כל גרסה 0-100 לפי פוטנציאל CTR והמרה ${localeWord(input.locale)}.

ממדי ניקוד (כל אחד 0-100): ${SCORE_DIMS.join(', ')}.
ה-score הסופי לכל גרסה הוא שקלול הממדים.

═══ עוגני סקאלה (חלים על כל ממד ועל ה-score הסופי) ═══
• 90-100 = יוצא דופן, נדיר — קופי שמנהל קריאייטיב היה מהמר עליו בתקציב אמיתי בלי לגעת.
• 75-89 = חזק — עובד, אבל עם חולשה מורגשת אחת לפחות.
• 60-74 = בינוני — תקין אך צפוי; לא יבלוט בפיד.
• מתחת 60 = חלש — לא היה עובר אישור לפרסום.
עוגנים התנהגותיים ל-scroll_stop:
• 90-100: עוצר את האגודל מיידית גם בפיד עמוס — בלתי אפשרי לגלול מעליו.
• 75-89: תופס את העין של רוב הקהל, אך חלק ימשיכו לגלול.
• 60-74: נעים אך שקוף — נטמע בפיד, רוב הקהל גולל מעליו.
• מתחת 60: בלתי נראה בפיד — אפס עצירה.
נקד בכנות ובפיזור אמיתי: אל תדחס הכל ל-80-87; השתמש בכל הסקאלה. פוסט טוב-אך-רגיל הוא 60-74, לא 85.

═══ scroll_stop (עצירת-גלילה) — הממד הכי חשוב, שוקלל ${pct}% מבחירת המנצח ═══
scroll_stop מודד את כוח עצירת-האגודל בחצי-השנייה הראשונה — לפני שקוראים מילה אחת. נקד גבוה רק אם הקריאייטיב:
• ויזואל נועז, ניגודיות גבוהה, מוקד-מבט יחיד וחזק (single strong focal point).
• pattern-interrupt — שובר את דפוס הגלילה, לא עוד תמונת סטוק "יפה".
• משיכה רגשית מיידית שנוגעת בדיוק בכאב/בתשוקה/בחלום של הקהל הספציפי הזה.
• ההוק הפותח של הפוסט תופס ומקבע את העין באותה חצי-שנייה.
מודעה משכנעת שגוללים מעליה = 0 המרות. תן ל-scroll_stop משקל מכריע, ואל תתגמל גרסה "יפה אך שקופה".

═══ OUTPUT CONTRACT — החזר אובייקט JSON תקין אחד בלבד, ללא markdown ═══
{
  "variants": [
    { "index": 0, "score": <0-100>, "dims": { ${SCORE_DIMS.map(d => `"${d}": <0-100>`).join(', ')} }, "note": "<משפט>" }
  ],
  "winner_index": <int>,
  "rationale": "<2-3 משפטים למה המנצח ניצח — כולל עצירת-הגלילה>"
}`;

  const body = variants.map((v, i) =>
    `── Variant ${i} (${v.marketer.name}) ──\n${v.draft.post}`).join('\n\n');
  const user = `פלטפורמה: ${input.platform}\nבריף: ${input.brief}\n\n${body}`;
  return { system, user };
}

function clamp(n: unknown): number {
  const x = Number(n); if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function parseJudge(raw: string, variantCount: number): JudgeResult | null {
  let obj: any;
  try { obj = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!obj || !Array.isArray(obj.variants) || obj.variants.length === 0) return null;

  const scores: VariantScore[] = obj.variants.slice(0, variantCount).map((v: any, i: number) => {
    const dims = {} as Record<ScoreDim, number>;
    for (const d of SCORE_DIMS) dims[d] = clamp(v?.dims?.[d]);
    const score = clamp(v?.score);
    return {
      index: Number.isInteger(v?.index) ? v.index : i,
      score,
      dims,
      note: typeof v?.note === 'string' ? v.note : '',
      // Selection score up-weights scroll_stop so the best-of-N winner is the
      // most thumb-stopping creative, not merely the best-argued one.
      weighted: weightedSelectionScore(score, dims.scroll_stop),
    };
  });
  if (scores.length === 0) return null;

  // Winner = the highest scroll-stop-WEIGHTED variant. The model's winner_index
  // is honored only as a tie-breaker (when weighted scores are equal), so
  // scroll_stop genuinely decides close calls.
  const best = scores.reduce((b, s) => (s.weighted > b.weighted ? s : b), scores[0]);
  const modelPick = Number(obj.winner_index);
  const modelPickIsWinnerWeight =
    scores.some(s => s.index === modelPick && s.weighted === best.weighted);
  const winnerIndex = modelPickIsWinnerWeight ? modelPick : best.index;
  return { scores, winnerIndex, rationale: typeof obj.rationale === 'string' ? obj.rationale : '' };
}
