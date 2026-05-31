// lib/master-studio/creator.ts
import { marketerToPromptBlock, type Marketer } from '@/lib/marketers';
import { FRAMEWORKS_BY_ID } from '@/lib/frameworks';
import {
  type MasterStudioInput, type AvatarProfile, type VariantDraft,
  MASTER_NOTES_MAX, localeWord, parsePostTags,
} from './index';

export function composeCreatorPrompt(
  input: MasterStudioInput, marketer: Marketer, avatar: AvatarProfile | null,
): { system: string; user: string } {
  const notes = (input.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const fw = input.framework
    ? `Forced framework: ${input.framework} (${FRAMEWORKS_BY_ID[input.framework]?.name_en ?? input.framework}) — MUST use this`
    : `Framework: use ${marketer.name}'s preferred framework`;
  const hook = input.hook ? `Forced hook style: ${input.hook} — MUST open this way` : 'Hook: pick the strongest for this avatar';
  const avatarBlock = avatar
    ? `persona: ${avatar.persona}\nfears: ${avatar.fears}\ndesires: ${avatar.desires}\nawareness: ${avatar.awareness_level}\nobjections: ${avatar.objections}`
    : '— (infer from brief) —';

  const system = `אתה ${marketer.name} ${marketer.emoji}. גלם אותו במלואו — קולו, signature moves, ה-framework המועדף שלו.

כתוב ${localeWord(input.locale)}.

═══ MASTER NOTES (🔒 עדיפות עליונה) ═══
${notes || '— אין —'}

═══ המשווק שאתה מגלם ═══
${marketerToPromptBlock(marketer)}

═══ אווטאר היעד ═══
${avatarBlock}

═══ OVERRIDES ═══
- ${fw}
- ${hook}
- Platform: ${input.platform} | Tone: ${input.tone ?? '—'} | Post type: ${input.type ?? '—'}

═══ OUTPUT CONTRACT (החזר רק את התגיות, בסדר הזה) ═══
[PRINCIPLES_APPLIED]
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המלא עם אמוג'ים וקריאה לפעולה[/POST]
[HASHTAGS]12-15 האשטגים[/HASHTAGS]
[IMAGE_PROMPT]Detailed English prompt for image generation[/IMAGE_PROMPT]
[TIPS]3 טיפים לפרסום[/TIPS]
[WHATSAPP]גרסה קצרה לוואטסאפ[/WHATSAPP]`;

  const user = `בריף: ${input.brief}`;
  return { system, user };
}

export function parseCreator(raw: string): VariantDraft | null {
  return parsePostTags(raw);
}
