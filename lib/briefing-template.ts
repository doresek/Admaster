// ════════════════════════════════════════════════════════════════
// Universal client-briefing template — single source of truth shared by
// the marketer wizard (/clients/[id]/briefing) and the public fill page
// (/brief/[token]). Modeled on auto-ads.io's "תבנית בריפינג אוניברסלית".
//
// Keys extend BriefValues (types/index.ts). New "soul"/links/notes keys are
// stored in the same `briefs.values` jsonb, so nothing schema-side is needed
// for the fields themselves.
// ════════════════════════════════════════════════════════════════

export type BriefFieldType = 'text' | 'textarea' | 'select';

export interface BriefField {
  key:        string;          // stored in briefs.values[key]
  label:      string;          // shown to the marketer AND the client
  type:       BriefFieldType;
  required?:  boolean;
  options?:   string[];        // for type='select'
  placeholder?: string;
}

export interface BriefStep {
  id:     string;
  title:  string;
  intro?: string;
  fields: BriefField[];
}

export const BRIEFING_TEMPLATE: BriefStep[] = [
  {
    id: 'business',
    title: 'בוא נכיר את העסק (והנשמה שמאחוריו)',
    fields: [
      { key: 'biz_name',           label: 'מה שם העסק שלך?', type: 'text', required: true },
      { key: 'biz_what',           label: 'במה העסק עוסק (במילים פשוטות)?', type: 'textarea', required: true },
      { key: 'biz_promote_now',    label: 'מה המוצר או השירות הספציפי שנרצה לקדם עכשיו?', type: 'textarea', required: true },
      { key: 'biz_language',       label: 'מה השפה שבה נכתוב את המודעות?', type: 'select', required: true, options: ['עברית', 'אנגלית', 'ערבית'] },
      { key: 'biz_founding_story', label: 'סיפור ההקמה: למה הקמת את העסק? האם עברת בעצמך את הקושי שאתה פותר היום לאחרים?', type: 'textarea' },
      { key: 'biz_presenter',      label: 'הפנים מאחורי המותג: האם המודעות ידברו "בשמך" או בשם "המותג"?', type: 'select', required: true, options: ['בשמי', 'בשם המותג', 'שילוב'] },
      { key: 'biz_about_you',      label: 'אם המודעות ידברו בשמך – ספר לנו עליך: מי אתה, מה הרקע שלך, ולמה אתה הכתובת הנכונה בתחום הזה?', type: 'textarea' },
      { key: 'biz_mission',        label: 'השליחות: מה הדבר שהכי מרגש אותך בעסק או בתוצאות של הלקוחות שלך?', type: 'textarea' },
    ],
  },
  {
    id: 'links',
    title: 'איפה אפשר לראות אתכם?',
    fields: [
      { key: 'link_website',   label: 'כתובת האתר או דף הנחיתה', type: 'text', placeholder: 'https://' },
      { key: 'link_instagram', label: 'לינק לאינסטגרם', type: 'text', placeholder: 'https://instagram.com/' },
      { key: 'link_facebook',  label: 'לינק לפייסבוק', type: 'text', placeholder: 'https://facebook.com/' },
    ],
  },
  {
    id: 'offer',
    title: 'מה הלקוח מקבל? (הצעה לעומק)',
    fields: [
      { key: 'offer_price',     label: 'כמה המוצר/שירות עולה?', type: 'text' },
      { key: 'offer_what_gets', label: 'מה הלקוח מקבל בתכלס?', type: 'textarea' },
      { key: 'biz_usp',         label: 'למה כדאי לקנות דווקא מכם ולא מהמתחרים?', type: 'textarea' },
    ],
  },
  {
    id: 'psychology',
    title: 'מי הלקוח ומה כואב לו? (פסיכולוגיה עמוקה)',
    fields: [
      { key: 'pain_main',    label: 'מה הבעיה הכי גדולה של הלקוח שלך לפני שהוא מגיע אליך? (מה מפריע לו לישון בלילה?)', type: 'textarea' },
      { key: 'desire_dream', label: 'איך החיים שלו ייראו אחרי שהוא ישתמש במוצר שלך? (התמונה האידיאלית שלו)', type: 'textarea' },
    ],
  },
  {
    id: 'extra',
    title: 'עוד משהו שחשוב שנדע?',
    fields: [
      { key: 'extra_notes', label: 'הערות, הנחיות מיוחדות, דברים שאסור להגיד וכו׳', type: 'textarea' },
    ],
  },
];

/** All field keys, flat. */
export const BRIEFING_FIELD_KEYS: string[] = BRIEFING_TEMPLATE.flatMap(s => s.fields.map(f => f.key));

/** Required field keys, flat. */
export const BRIEFING_REQUIRED_KEYS: string[] = BRIEFING_TEMPLATE
  .flatMap(s => s.fields).filter(f => f.required).map(f => f.key);

/** Completion % (0-100) based on REQUIRED fields filled. */
export function briefCompletion(values: Record<string, unknown> | null | undefined): number {
  if (!values) return 0;
  const filled = BRIEFING_REQUIRED_KEYS.filter(k => String((values as any)[k] ?? '').trim() !== '').length;
  return Math.round((filled * 100) / BRIEFING_REQUIRED_KEYS.length);
}

/** Whether all required fields in a given step are filled (gates the wizard's "next"). */
export function isStepComplete(step: BriefStep, values: Record<string, unknown> | null | undefined): boolean {
  return step.fields.filter(f => f.required).every(f => String((values as any)?.[f.key] ?? '').trim() !== '');
}
