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

═══ GROUNDING (🔒 גובר על הנטייה להוסיף "צבע") ═══
⛔ אסור להמציא: אל תמציא ואל תבדה שמות של אנשים, בעלי עסקים, מקומות, תאריכים, מחירים, הסמכות, או כל עובדה ספציפית שאינה מופיעה בבריף. אם שם בעל העסק לא ניתן — פנה בצורה כללית (למשל "בעל העסק", "הצוות", "אנחנו") ולעולם אל תמציא שם. מותר לכתוב בסגנון של המשווק ולהוסיף רגש, אך לא לבדות פרטים ספציפיים — השתמש אך ורק בפרטים שהבריף באמת מספק.

═══ OVERRIDES ═══
- ${fw}
- ${hook}
- Platform: ${input.platform} | Tone: ${input.tone ?? '—'} | Post type: ${input.type ?? '—'}

═══ SCROLL-STOP (🛑 עצירת-גלילה — קריטי) ═══
מודעה מנצחת חייבת לעצור פיזית את האגודל בחצי-השנייה הראשונה, לפני שקוראים מילה אחת. עצירת-הגלילה היא לרוב המניע הכי חזק של ביצועי מודעה — ובנה אותה מתוך הכאב/התשוקה/החלום של האווטאר הספציפי הזה, לא מ"יופי" גנרי.
• ההוק הפותח (המשפט הראשון ב-POST): pattern-interrupt שנוגע מיד ב-fears/desires של האווטאר — לא פתיח נעים ושקוף. שיעצור מישהו שמרגיש <הכאב שלו> ורוצה <התשוקה שלו>.
• ה-IMAGE_PROMPT: תאר תמונה ARRESTING — נועזת, ניגודיות גבוהה, מוקד-מבט יחיד וחזק, משיכה רגשית מיידית, שוברת דפוס. תאר תמונה שעוצרת את הגלילה עבור מישהו שחי את <הכאב> ומשתוקק ל-<התשוקה> — לא סצנת סטוק גנרית. כלול: הנושא/המוקד היחיד, הרגש שהוא משדר, בחירת צבע/ניגודיות/תאורה, והזווית שהופכת אותו לבלתי-ניתן-לגלילה. באנגלית, מפורט.

═══ OUTPUT CONTRACT (החזר רק את התגיות, בסדר הזה) ═══
[PRINCIPLES_APPLIED]
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המלא — פתח בהוק עוצר-גלילה, ואז אמוג'ים וקריאה לפעולה[/POST]
[HASHTAGS]12-15 האשטגים[/HASHTAGS]
[IMAGE_PROMPT]Detailed English prompt — a scroll-STOPPING image (bold, high-contrast, single strong focal point, pattern-interrupt, emotional pull) engineered for THIS avatar's pain/desire, not a generic stock scene[/IMAGE_PROMPT]
[TIPS]3 טיפים לפרסום[/TIPS]
[WHATSAPP]גרסה קצרה לוואטסאפ[/WHATSAPP]`;

  const user = `בריף: ${input.brief}`;
  return { system, user };
}

export function parseCreator(raw: string): VariantDraft | null {
  return parsePostTags(raw);
}
