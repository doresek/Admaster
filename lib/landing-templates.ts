// ════════════════════════════════════════════
// Landing Page templates — 6 high-converting structures
// ════════════════════════════════════════════
import type { DesignSpec } from './landing-design';

export type LandingTemplate =
  | 'squeeze'
  | 'local_service'
  | 'vsl'
  | 'launch'
  | 'application'
  | 'webinar'
  | 'custom';

export interface LandingContent {
  hero_title:    string;
  hero_sub:      string;
  cta_label:     string;
  cta_href?:     string;     // external CTA URL (otherwise opens form)
  video_url?:    string;     // youtube embed url
  bullets?:      string[];   // 3-5 short benefits
  testimonials?: { name: string; role?: string; quote: string }[];
  faq?:          { q: string; a: string }[];
  countdown_to?: string;     // ISO date — for launch/webinar
  webinar_at?:   string;     // ISO date — for webinar
  qualifier?:    string;     // application — short paragraph "this is for you if..."
  form_fields:   { name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea'; required?: boolean }[];
  theme: {
    primary:   string;
    secondary: string;
    bg:        'light' | 'dark';
  };
  /** AI-written design spec (colors, fonts, hero variant, etc). Optional for back-compat. */
  design?: DesignSpec;
  /** Optional URL of a hero image / logo to display */
  hero_image?: string;
  // Optional structured story / pain / dream blocks
  story?: { title: string; body: string }[];
  // For local-service: trust signals
  trust_signals?: { icon: string; label: string }[];
}

export interface LandingTemplateDef {
  id:          LandingTemplate;
  name:        string;
  emoji:       string;
  tagline:     string;
  description: string;
  /** Sections rendered by the public viewer, in order */
  sections:    Array<'hero' | 'video' | 'bullets' | 'story' | 'qualifier' | 'countdown' | 'webinar_info' | 'testimonials' | 'trust' | 'faq' | 'cta' | 'form'>;
  defaultContent: LandingContent;
}

const DEFAULT_FORM = [
  { name: 'name',  label: 'שם מלא', type: 'text'  as const, required: true },
  { name: 'phone', label: 'טלפון',  type: 'tel'   as const, required: true },
  { name: 'email', label: 'אימייל', type: 'email' as const },
];

export const LANDING_TEMPLATES: LandingTemplateDef[] = [
  {
    id: 'squeeze',
    name: 'דף Squeeze — איסוף לידים',
    emoji: '🧲',
    tagline: 'עמוד קצר ואגרסיבי שנועד להמיר תנועה במהירות',
    description: 'אידיאלי למדריכים, צ\'קליסטים והרשמות. דף קצר, hook חזק, טופס קצר.',
    sections: ['hero','bullets','form','cta'],
    defaultContent: {
      hero_title: 'הורד את המדריך החינמי',
      hero_sub:   '5 דקות קריאה שישנו את הדרך שאתה משווק. בלי לבזבז כסף על מודעות שלא עובדות.',
      cta_label:  'שלח לי את המדריך',
      bullets: [
        '✅ טמפלייט מוכן לשימוש מיידי',
        '✅ מבוסס על 1,000+ קמפיינים מנצחים',
        '✅ בעברית, מותאם לקהל הישראלי',
      ],
      form_fields: [
        { name: 'name',  label: 'שם מלא', type: 'text',  required: true },
        { name: 'email', label: 'אימייל', type: 'email', required: true },
      ],
      theme: { primary: '#0A7AFF', secondary: '#D4AF55', bg: 'dark' },
    },
  },
  {
    id: 'local_service',
    name: 'שירות מקומי / סוכנות',
    emoji: '🏢',
    tagline: 'עמוד שירות שבונה אמון וסמכות',
    description: 'אידיאלי לסוכנויות, יועצים ושירותים מקומיים. בנוי על trust signals + testimonials + טופס יצירת קשר.',
    sections: ['hero','trust','bullets','testimonials','faq','form','cta'],
    defaultContent: {
      hero_title: 'הסוכנות שמביאה ללקוחות שלך תוצאות אמיתיות',
      hero_sub:   '10 שנים במגרש. 500+ קמפיינים. תוצאות שאפשר למדוד.',
      cta_label:  'בוא נדבר',
      bullets: [
        '🏆 ניסיון של 10+ שנים בתחום',
        '💎 התמחות בעסקים קטנים וסוכנויות',
        '📞 תגובה תוך 24 שעות לכל פנייה',
      ],
      trust_signals: [
        { icon: '👥', label: '500+ לקוחות מרוצים' },
        { icon: '⭐', label: '4.9/5 ביקורות Google' },
        { icon: '📈', label: 'ROI ממוצע 340%' },
      ],
      testimonials: [
        { name: 'דני כהן', role: 'בעלים, סטודיו כהן', quote: 'תוך חודש קיבלנו 23 לידים איכותיים. תוצאה שלא ראיתי 3 שנים.' },
      ],
      faq: [
        { q: 'תוך כמה זמן רואים תוצאות?', a: 'בדרך כלל 7-14 ימים מההתחלה.' },
        { q: 'מה כולל המחיר?',           a: 'יצירת קמפיין, ניהול שוטף, דוחות שבועיים, וייעוץ.' },
      ],
      form_fields: DEFAULT_FORM,
      theme: { primary: '#059669', secondary: '#D4AF55', bg: 'dark' },
    },
  },
  {
    id: 'vsl',
    name: 'VSL — דף מכירה עם וידאו',
    emoji: '🎬',
    tagline: 'עמוד ממוקד וידאו להעברת תהליך מכירה פסיכולוגי מלא',
    description: 'אידיאלי לקורסים ותוכניות ליווי. וידאו 5-30 דקות בלב הדף, מתחתיו CTA + bullets + FAQ.',
    sections: ['hero','video','bullets','testimonials','faq','cta'],
    defaultContent: {
      hero_title: 'הדרך החדשה לבנות עסק מצליח בלי לבזבז על פרסום',
      hero_sub:   'צפה בוידאו של 12 דקות שמסביר איך עשינו את זה — 0 הוצאות פרסום, 100% תוצאות.',
      cta_label:  'אני רוצה להתחיל עכשיו',
      video_url:  '',
      bullets: [
        '🎯 שיטה צעד-אחר-צעד — בלי תיאוריות',
        '💡 דוגמאות אמיתיות מ-200+ עסקים',
        '🛡 100% החזר אם לא תהיה מרוצה',
      ],
      testimonials: [
        { name: 'מיכל לוי', quote: 'תוך 60 ימים העסק שלי גדל פי 3. בלי גימיקים.' },
      ],
      faq: [
        { q: 'כמה זמן לוקח להתחיל לראות תוצאות?', a: 'רוב הלקוחות רואים שינוי משמעותי כבר ב-30 הימים הראשונים.' },
      ],
      form_fields: DEFAULT_FORM,
      theme: { primary: '#6D28D9', secondary: '#D4AF55', bg: 'dark' },
    },
  },
  {
    id: 'launch',
    name: 'השקת מוצר / Waitlist',
    emoji: '🚀',
    tagline: 'עמוד השקה מינימליסטי ליצירת ציפייה',
    description: 'אידיאלי לסטארטאפים ומוצרים חדשים. countdown + form הרשמה ל-waitlist.',
    sections: ['hero','countdown','bullets','form','cta'],
    defaultContent: {
      hero_title: 'משהו גדול בדרך',
      hero_sub:   'הירשם ל-waitlist וקבל גישה מוקדמת + הנחת לאנצ\'ר של 50%.',
      cta_label:  'אני בפנים',
      countdown_to: '',
      bullets: [
        '🎁 גישה מוקדמת לפני כולם',
        '💰 הנחה של 50% רק לרשומים',
        '🔒 ללא ספאם — רק עדכון אחד עם ההשקה',
      ],
      form_fields: [
        { name: 'email', label: 'אימייל', type: 'email', required: true },
      ],
      theme: { primary: '#DC2626', secondary: '#D4AF55', bg: 'dark' },
    },
  },
  {
    id: 'application',
    name: 'משפך סינון / Application',
    emoji: '🧭',
    tagline: 'עמוד סינון שמושך לקוחות רלוונטיים',
    description: 'אידיאלי לייעוץ ושירותי פרימיום. qualifier + טופס ארוך שמסנן לידים.',
    sections: ['hero','qualifier','bullets','form','cta'],
    defaultContent: {
      hero_title: 'תוכנית הליווי הזו לא לכולם',
      hero_sub:   'אם אתה רציני, מוכן להשקיע ויש לך עסק קיים — מלא את הטופס ונחזור אליך תוך 48 שעות.',
      qualifier:  'התוכנית מיועדת לבעלי עסקים עם הכנסה חודשית של 30K+ שמוכנים להשקיע בצמיחה. אם זה לא אתה — בבקשה אל תמלא.',
      cta_label:  'שלח טופס',
      bullets: [
        '🎯 ליווי 1-on-1 לאורך 90 ימים',
        '📞 שיחת ייעוץ ראשונית בחינם',
        '🚪 סינון קפדני — מקבלים רק 5 בחודש',
      ],
      form_fields: [
        { name: 'name',     label: 'שם מלא',                       type: 'text',     required: true },
        { name: 'phone',    label: 'טלפון',                        type: 'tel',      required: true },
        { name: 'email',    label: 'אימייל',                       type: 'email',    required: true },
        { name: 'revenue',  label: 'הכנסה חודשית ממוצעת',           type: 'text',     required: true },
        { name: 'goal',     label: 'מה המטרה שלך ב-12 החודשים הבאים?', type: 'textarea', required: true },
      ],
      theme: { primary: '#B8953A', secondary: '#0A7AFF', bg: 'dark' },
    },
  },
  {
    id: 'webinar',
    name: 'הרשמה לוובינר',
    emoji: '📡',
    tagline: 'עמוד הרשמה ממוקד אירוע',
    description: 'אידיאלי לשידורים חיים, סדנאות ומפגשים מקוונים. תאריך + countdown + bullets + טופס הרשמה.',
    sections: ['hero','webinar_info','bullets','countdown','form','cta'],
    defaultContent: {
      hero_title: 'וובינר חינמי: 3 הטעויות הקריטיות בשיווק דיגיטלי',
      hero_sub:   'יום שלישי, 20:00 (זמן ישראל). 90 דקות שיחסכו לך שנים של ניסוי וטעייה.',
      webinar_at: '',
      countdown_to: '',
      cta_label:  'שריין מקום',
      bullets: [
        '📅 שידור חי + מענה לשאלות בזמן אמת',
        '🎁 בונוס: PDF עם 12 טמפלייטים מוכנים',
        '🔁 הקלטה תישלח רק לנרשמים',
      ],
      form_fields: [
        { name: 'name',  label: 'שם מלא', type: 'text',  required: true },
        { name: 'email', label: 'אימייל', type: 'email', required: true },
      ],
      theme: { primary: '#0A7AFF', secondary: '#D4AF55', bg: 'dark' },
    },
  },
];

export const TEMPLATES_BY_ID: Record<LandingTemplate, LandingTemplateDef> =
  LANDING_TEMPLATES.reduce((acc, t) => { acc[t.id] = t; return acc; },
    {} as Record<LandingTemplate, LandingTemplateDef>);
