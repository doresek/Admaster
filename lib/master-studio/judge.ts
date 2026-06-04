// lib/master-studio/judge.ts
import {
  type MasterStudioInput, type MarketerPick, type VariantDraft,
  type JudgeResult, type VariantScore, SCORE_DIMS, type ScoreDim,
  localeWord, stripFence,
} from './index';

export interface JudgeVariant { marketer: MarketerPick; draft: VariantDraft; }

export function composeJudgePrompt(
  variants: JudgeVariant[], input: MasterStudioInput,
): { system: string; user: string } {
  const system = `אתה שופט קופי שיווקי שדירג 250,000 מודעות. נקד כל גרסה 0-100 לפי פוטנציאל CTR והמרה ${localeWord(input.locale)}.

ממדי ניקוד (כל אחד 0-100): ${SCORE_DIMS.join(', ')}.
ה-score הסופי לכל גרסה הוא שקלול הממדים.

═══ OUTPUT CONTRACT — החזר אובייקט JSON תקין אחד בלבד, ללא markdown ═══
{
  "variants": [
    { "index": 0, "score": <0-100>, "dims": { ${SCORE_DIMS.map(d => `"${d}": <0-100>`).join(', ')} }, "note": "<משפט>" }
  ],
  "winner_index": <int>,
  "rationale": "<2-3 משפטים למה המנצח ניצח>"
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
    return {
      index: Number.isInteger(v?.index) ? v.index : i,
      score: clamp(v?.score),
      dims,
      note: typeof v?.note === 'string' ? v.note : '',
    };
  });
  if (scores.length === 0) return null;

  let winnerIndex = Number(obj.winner_index);
  const valid = scores.some(s => s.index === winnerIndex);
  if (!valid) {
    winnerIndex = scores.reduce((best, s) => (s.score > best.score ? s : best), scores[0]).index;
  }
  return { scores, winnerIndex, rationale: typeof obj.rationale === 'string' ? obj.rationale : '' };
}
