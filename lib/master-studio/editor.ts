// lib/master-studio/editor.ts
import { type Marketer } from '@/lib/marketers';
import {
  type MasterStudioInput, type VariantDraft, type VariantScore, type MarketerPick,
  SCORE_DIMS, MASTER_NOTES_MAX, localeWord, parsePostTags,
} from './index';

export function composeEditorPrompt(
  draft: VariantDraft, marketer: MarketerPick | Marketer, score: VariantScore, input: MasterStudioInput,
): { system: string; user: string } {
  const notes = (input.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const weak = SCORE_DIMS
    .map(d => ({ d, v: score.dims[d] }))
    .sort((a, b) => a.v - b.v).slice(0, 3)
    .map(x => `${x.d} (${x.v})`).join(', ');

  const system = `אתה ${marketer.name} ${marketer.emoji} עורך גרסה קודמת של הפוסט. שמור על הקול, ה-framework וה-Master Notes — אבל חזק את הממדים החלשים: ${weak}.

כתוב ${localeWord(input.locale)}.

═══ MASTER NOTES (🔒 עדיפות עליונה) ═══
${notes || '— אין —'}

═══ OUTPUT CONTRACT (אותן תגיות בדיוק) ═══
[PRINCIPLES_APPLIED]
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המשופר[/POST]
[HASHTAGS]...[/HASHTAGS]
[IMAGE_PROMPT]...[/IMAGE_PROMPT]
[TIPS]...[/TIPS]
[WHATSAPP]...[/WHATSAPP]`;

  const user = `בריף: ${input.brief}\n\nהגרסה הקודמת (ציון ${score.score}):\n${draft.post}`;
  return { system, user };
}

export function parseEditor(raw: string): VariantDraft | null {
  return parsePostTags(raw);
}
