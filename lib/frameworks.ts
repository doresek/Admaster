// ════════════════════════════════════════════
// 8 Copywriting Frameworks — for AI generation
// Each framework injects its structure into the
// system prompt while keeping the [POST]/[HASHTAGS]/...
// output contract used by /create.
// ════════════════════════════════════════════

export type FrameworkId =
  | 'pas'
  | 'aida'
  | 'bab'
  | 'fab'
  | 'fourps'
  | 'quest'
  | 'story'
  | 'aicpbsawn';

export interface Framework {
  id:          FrameworkId;
  name_he:     string;
  name_en:     string;
  emoji:       string;
  description: string;
  /** Hebrew, displayed in UI as a structure preview */
  structure:   string[];
  /** Body of the framework instructions, injected into the system prompt */
  prompt:      string;
}

export const FRAMEWORKS: Framework[] = [
  {
    id: 'pas',
    name_he: 'PAS — בעיה, החרפה, פתרון',
    name_en: 'PAS (Problem-Agitation-Solution)',
    emoji: '🎯',
    description: 'הצף בעיה, החרף אותה, ואז הצע את הפתרון. עובד מצוין לקהל קר.',
    structure: ['Problem — מה כואב לקהל', 'Agitation — למה הכאב גרוע יותר משחושבים', 'Solution — איך המוצר פותר את זה'],
    prompt: `בנה את הטקסט לפי framework PAS:
1) Problem — הצג את הבעיה המרכזית של הקהל במשפט אחד חזק
2) Agitation — תאר את ההשלכות הרגשיות והמעשיות אם לא יפעלו
3) Solution — הצג את המוצר כפתרון המדויק, עם תוצאה ברורה`,
  },
  {
    id: 'aida',
    name_he: 'AIDA — תשומת לב, עניין, רצון, פעולה',
    name_en: 'AIDA (Attention-Interest-Desire-Action)',
    emoji: '🧲',
    description: 'הקלאסיקה — מושך עין, יוצר עניין, מצית רצון, ומבקש פעולה ברורה.',
    structure: ['Attention — Hook חזק', 'Interest — סקרנות עם עובדה/סיפור', 'Desire — מציג את החזון', 'Action — CTA חד'],
    prompt: `בנה את הטקסט לפי framework AIDA:
1) Attention — Hook חד שמכריח לעצור (שאלה / עובדה / טוויסט)
2) Interest — בנה סקרנות עם עובדה או סיפור קצר
3) Desire — שדר תוצאה ספציפית שהקהל ירצה לעצמו
4) Action — CTA יחיד וחד עם פועל ציווי`,
  },
  {
    id: 'bab',
    name_he: 'BAB — לפני, אחרי, גשר',
    name_en: 'BAB (Before-After-Bridge)',
    emoji: '🌉',
    description: 'מתאר את המצב הנוכחי, את המצב הרצוי, ואיך עוברים ביניהם.',
    structure: ['Before — איפה אתה היום', 'After — איפה תהיה אחרי', 'Bridge — המוצר/השירות שמחבר'],
    prompt: `בנה את הטקסט לפי framework BAB:
1) Before — תאר את המציאות הקיימת של הקהל (תסכול / סטגנציה)
2) After — תאר באופן חי את התוצאה אחרי השימוש
3) Bridge — הסבר במשפט אחד איך המוצר מוביל מ-Before ל-After`,
  },
  {
    id: 'fab',
    name_he: 'FAB — תכונות, יתרונות, תועלות',
    name_en: 'FAB (Features-Advantages-Benefits)',
    emoji: '💎',
    description: 'מתרגם תכונות טכניות לתועלות רגשיות. מצוין למוצרים מורכבים.',
    structure: ['Feature — מה זה', 'Advantage — למה זה טוב', 'Benefit — מה זה אומר לך אישית'],
    prompt: `בנה את הטקסט לפי framework FAB:
1) Features — 2–3 תכונות מרכזיות של המוצר
2) Advantages — לכל תכונה: למה זה עדיף על האלטרנטיבה
3) Benefits — תרגום לתועלת קונקרטית בחיי הלקוח ("זה חוסך לך 5 שעות בשבוע")`,
  },
  {
    id: 'fourps',
    name_he: '4Ps — הבטחה, תמונה, הוכחה, דחיפה',
    name_en: '4Ps (Promise-Picture-Proof-Push)',
    emoji: '🔥',
    description: 'מסגרת מכוונת המרה — מבטיח, ממחיש, מוכיח, ודוחף לפעולה.',
    structure: ['Promise — הבטחה גדולה', 'Picture — תמונה ויזואלית', 'Proof — הוכחה (מספרים/עדויות)', 'Push — דחיפה לפעולה'],
    prompt: `בנה את הטקסט לפי framework 4Ps:
1) Promise — הבטחה גדולה וספציפית (לא "טובים יותר", אלא "פי 3 מהר יותר")
2) Picture — תאר באופן חזותי איך זה ייראה / יורגש
3) Proof — מספרים, עדויות, אחוזים, גיבויים
4) Push — שילוב דחיפות + CTA חד`,
  },
  {
    id: 'quest',
    name_he: 'QUEST — סינון, הבנה, חינוך, גירוי, מעבר',
    name_en: 'QUEST (Qualify-Understand-Educate-Stimulate-Transition)',
    emoji: '🧭',
    description: 'בונה אמון לאט — מתאים למוצרי שירות יקרים ולקהלים סקפטיים.',
    structure: ['Qualify — סינון הקהל', 'Understand — הזדהות', 'Educate — חינוך', 'Stimulate — גירוי', 'Transition — מעבר ל-CTA'],
    prompt: `בנה את הטקסט לפי framework QUEST:
1) Qualify — פתח עם משפט שמסנן את הקהל הנכון ("אם אתה X — קרא הלאה")
2) Understand — הראה הזדהות עם המצב שלהם
3) Educate — לימד אותם משהו חדש על הבעיה / הפתרון
4) Stimulate — צייר את התוצאה הרצויה
5) Transition — עבר חלק ל-CTA`,
  },
  {
    id: 'story',
    name_he: 'Story — סיפור הגיבור',
    name_en: 'Story (Hero\'s Journey)',
    emoji: '📖',
    description: 'סיפור אישי או של לקוח שעבר מסע מ-A ל-B. גבוה במעורבות.',
    structure: ['Hero — הגיבור והקושי', 'Conflict — נקודת השפל', 'Guide — המנטור/המוצר', 'Resolution — איך זה השתנה'],
    prompt: `בנה את הטקסט בסגנון Story (Hero's Journey):
1) הצג גיבור (לקוח / אתה עצמך) בנקודת התחלה מאתגרת
2) תאר את הקונפליקט / נקודת השפל
3) הצג את הגאידלף (המוצר / השירות) כעזרה
4) תאר את התוצאה הסופית — הטרנספורמציה
5) חבר ללקוח: "גם אתה יכול"`,
  },
  {
    id: 'aicpbsawn',
    name_he: 'AICPBSAWN — של Eugene Schwartz',
    name_en: 'AICPBSAWN (Schwartz)',
    emoji: '🏛',
    description: 'המסגרת הטהורה של Schwartz — 9 שלבים. למודעות ארוכות וקופי עוצמתי.',
    structure: ['Attention', 'Interest', 'Credibility', 'Prove', 'Benefits', 'Scarcity', 'Action', 'Warn', 'Now'],
    prompt: `בנה את הטקסט לפי framework AICPBSAWN של Eugene Schwartz (גרסה קומפקטית, כל שלב משפט–שניים):
1) Attention — Hook
2) Interest — שמירת תשומת לב
3) Credibility — למה להאמין לך
4) Prove — הוכחה קונקרטית
5) Benefits — מה הקהל מקבל
6) Scarcity — מה מוגבל
7) Action — מה לעשות עכשיו
8) Warn — מה יקרה אם לא יפעלו
9) Now — דחיפות מיידית`,
  },
];

export const FRAMEWORKS_BY_ID: Record<FrameworkId, Framework> =
  FRAMEWORKS.reduce((acc, f) => { acc[f.id] = f; return acc; }, {} as Record<FrameworkId, Framework>);

/**
 * Compose the system prompt for /create by injecting the framework body
 * into the existing output-contract instructions.
 */
export function composeSystemPrompt(opts: {
  framework: FrameworkId;
  platform:  string;
  tone:      string;
  type:      string;
  hook:      string;
  locale?:   'he' | 'en' | 'ar';
}): string {
  const fw     = FRAMEWORKS_BY_ID[opts.framework] ?? FRAMEWORKS_BY_ID.pas;
  const locale = opts.locale ?? 'he';
  const langInstr = locale === 'he' ? 'בעברית'
                  : locale === 'ar' ? 'בערבית'
                  : 'in English';

  return `סוכן שיווק מקצועי. פלטפורמה:${opts.platform} טון:${opts.tone} סוג:${opts.type} פתיחה:${opts.hook}
כתוב ${langInstr}.

${fw.prompt}

החזר בפורמט זה בלבד (אל תוסיף טקסט מחוץ לתגים):
[POST]הפוסט המלא לפי framework ${fw.name_en}, עם אמוג'ים וקריאה לפעולה[/POST]
[HASHTAGS]12-15 האשטגים בעברית ואנגלית[/HASHTAGS]
[IMAGE_PROMPT]Detailed English prompt for Ideogram/Midjourney[/IMAGE_PROMPT]
[TIPS]3 טיפים לפרסום: מתי, לאיזה קהל, תקציב[/TIPS]
[WHATSAPP]גרסה קצרה לWhatsApp ללא אמוג'ים מוגזמים[/WHATSAPP]`;
}
