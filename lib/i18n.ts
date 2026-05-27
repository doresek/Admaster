// ════════════════════════════════════════════
// i18n — Hebrew, English, Arabic
// Cookie-based locale persistence, no URL routing change
// ════════════════════════════════════════════

export type Locale = 'he' | 'en' | 'ar';

export const LOCALES: { id: Locale; name: string; emoji: string; dir: 'rtl' | 'ltr' }[] = [
  { id: 'he', name: 'עברית',   emoji: '🇮🇱', dir: 'rtl' },
  { id: 'en', name: 'English', emoji: '🇺🇸', dir: 'ltr' },
  { id: 'ar', name: 'العربية', emoji: '🇸🇦', dir: 'rtl' },
];

export const DEFAULT_LOCALE: Locale = 'he';
export const LOCALE_COOKIE = 'admaster_locale';

// ── Dictionary ────────────────────────────────
// Note: only translates the "shell" (nav, common buttons, headers, public-marketing).
// Body content (dashboard pages) currently shows Hebrew strings; we'll expand over time.
// AI-generated content adapts to locale via the `locale` param passed to /api/ai.

type Dict = {
  // Common UI
  common: {
    login:           string;
    logout:          string;
    register:        string;
    cancel:          string;
    save:            string;
    back:            string;
    next:            string;
    loading:         string;
    error:           string;
    success:         string;
    credits:         string;
    copy:            string;
    copied:          string;
    free:            string;
    new:             string;
    pro:             string;
    language:        string;
    delete:          string;
    confirm:         string;
  };
  // Sidebar
  nav: {
    dashboard:       string;
    brand:           string;
    analytics:       string;
    competitor:      string;
    reports:         string;
    create:          string;
    quick_campaign:  string;
    images:          string;
    analyze:         string;
    variations:      string;
    lab:             string;
    refine:          string;
    calendar:        string;
    messages:        string;
    series:          string;
    landing:         string;
    schedule:        string;
    approvals:       string;
    history:         string;
    library:         string;
    support:         string;
    clients:         string;
    briefs:          string;
    publish:         string;
    campaign:        string;
    pixel:           string;
    team:            string;
    agency:          string;
    credits:         string;
    // section headers
    sec_analyze:     string;
    sec_create:      string;
    sec_messages:    string;
    sec_content:     string;
    sec_meta:        string;
    sec_manage:      string;
  };
  // Marketing-site nav
  public: {
    home:            string;
    features:        string;
    pricing:         string;
    how_it_works:    string;
    faq:             string;
    blog:            string;
    contact:         string;
    start_free:      string;
    hero_badge:      string;
    hero_title_pre:  string;
    hero_title_em:   string;
    hero_title_post: string;
    hero_sub:        string;
    cta_start_free:  string;
    cta_how:         string;
  };
};

const HE: Dict = {
  common: {
    login: 'התחברות',
    logout: 'יציאה',
    register: 'הרשמה',
    cancel: 'ביטול',
    save: 'שמירה',
    back: 'חזרה',
    next: 'הבא',
    loading: 'בטעינה...',
    error: 'שגיאה',
    success: 'הצלחה',
    credits: 'קרדיטים',
    copy: 'העתקה',
    copied: 'הועתק!',
    free: 'חינם',
    new: 'חדש',
    pro: 'Pro',
    language: 'שפה',
    delete: 'מחיקה',
    confirm: 'אישור',
  },
  nav: {
    dashboard: 'לוח בקרה',
    brand: 'Brand DNA',
    analytics: 'ביצועים Meta',
    competitor: 'מחקר מתחרים',
    reports: 'דוחות',
    create: 'יצירת פוסט',
    quick_campaign: 'קמפיין מהיר',
    images: 'מחולל תמונות',
    analyze: 'ניתוח מודעה',
    variations: 'וריאציות',
    lab: 'The Lab',
    refine: 'שיפור אוטומטי',
    calendar: 'לוח חגים',
    messages: 'Email/SMS/WA',
    series: 'סדרת הודעות',
    landing: 'דפי נחיתה',
    schedule: 'לוח תוכן',
    approvals: 'אישורי לקוח',
    history: 'היסטוריה',
    library: 'ספריית מודעות',
    support: 'תמיכה',
    clients: 'לקוחות',
    briefs: 'בריפים',
    publish: 'פרסום',
    campaign: 'קמפיין',
    pixel: 'Pixel Builder',
    team: 'צוות',
    agency: 'White-Label',
    credits: 'קרדיטים',
    sec_analyze: '📊 ניתוח',
    sec_create: '✨ יצירה',
    sec_messages: '📧 הודעות',
    sec_content: '📅 תוכן',
    sec_meta: '🔌 Meta',
    sec_manage: '⚙️ ניהול',
  },
  public: {
    home: 'בית',
    features: 'יכולות',
    pricing: 'מחירים',
    how_it_works: 'איך זה עובד',
    faq: 'שאלות נפוצות',
    blog: 'בלוג',
    contact: 'יצירת קשר',
    start_free: 'תתחילו חינם',
    hero_badge: '🚀 AI שמקצר 80% מהזמן שלך',
    hero_title_pre: 'AI שעושה',
    hero_title_em: '90%',
    hero_title_post: 'מהעבודה של אנשי השיווק',
    hero_sub: 'מבריף לפוסט, לתמונה, לקמפיין מלא ב-Meta — בעברית, אנגלית וערבית. בלי לכתוב prompts. בלי להעתיק טקסט. ישר על המסך, מוכן לפרסום.',
    cta_start_free: 'תתחילו חינם — 150 קרדיטים מתנה',
    cta_how: 'איך זה עובד',
  },
};

const EN: Dict = {
  common: {
    login: 'Sign in',
    logout: 'Sign out',
    register: 'Sign up',
    cancel: 'Cancel',
    save: 'Save',
    back: 'Back',
    next: 'Next',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    credits: 'credits',
    copy: 'Copy',
    copied: 'Copied!',
    free: 'Free',
    new: 'New',
    pro: 'Pro',
    language: 'Language',
    delete: 'Delete',
    confirm: 'Confirm',
  },
  nav: {
    dashboard: 'Dashboard',
    brand: 'Brand DNA',
    analytics: 'Meta Analytics',
    competitor: 'Competitor Research',
    reports: 'Reports',
    create: 'Create Post',
    quick_campaign: 'Quick Campaign',
    images: 'Image Generator',
    analyze: 'Analyze Ad',
    variations: 'Variations',
    lab: 'The Lab',
    refine: 'Auto-Refine',
    calendar: 'Holiday Calendar',
    messages: 'Email/SMS/WA',
    series: 'Message Series',
    landing: 'Landing Pages',
    schedule: 'Content Calendar',
    approvals: 'Client Approvals',
    history: 'History',
    library: 'Ad Library',
    support: 'Support',
    clients: 'Clients',
    briefs: 'Briefs',
    publish: 'Publish',
    campaign: 'Campaign',
    pixel: 'Pixel Builder',
    team: 'Team',
    agency: 'White-Label',
    credits: 'Credits',
    sec_analyze: '📊 Analyze',
    sec_create: '✨ Create',
    sec_messages: '📧 Messages',
    sec_content: '📅 Content',
    sec_meta: '🔌 Meta',
    sec_manage: '⚙️ Manage',
  },
  public: {
    home: 'Home',
    features: 'Features',
    pricing: 'Pricing',
    how_it_works: 'How it works',
    faq: 'FAQ',
    blog: 'Blog',
    contact: 'Contact',
    start_free: 'Start free',
    hero_badge: '🚀 AI that saves 80% of your time',
    hero_title_pre: 'AI does',
    hero_title_em: '90%',
    hero_title_post: 'of the marketer\'s work',
    hero_sub: 'From brief to post, to image, to a full Meta campaign — in Hebrew, English, and Arabic. No prompts. No copy-paste. Straight on screen, ready to publish.',
    cta_start_free: 'Start free — 150 credits gift',
    cta_how: 'How it works →',
  },
};

const AR: Dict = {
  common: {
    login: 'تسجيل الدخول',
    logout: 'خروج',
    register: 'تسجيل',
    cancel: 'إلغاء',
    save: 'حفظ',
    back: 'رجوع',
    next: 'التالي',
    loading: 'جار التحميل...',
    error: 'خطأ',
    success: 'نجاح',
    credits: 'رصيد',
    copy: 'نسخ',
    copied: 'تم النسخ!',
    free: 'مجاني',
    new: 'جديد',
    pro: 'Pro',
    language: 'اللغة',
    delete: 'حذف',
    confirm: 'تأكيد',
  },
  nav: {
    dashboard: 'لوحة التحكم',
    brand: 'Brand DNA',
    analytics: 'تحليلات Meta',
    competitor: 'بحث المنافسين',
    reports: 'التقارير',
    create: 'إنشاء منشور',
    quick_campaign: 'حملة سريعة',
    images: 'مولّد الصور',
    analyze: 'تحليل الإعلان',
    variations: 'إصدارات',
    lab: 'The Lab',
    refine: 'تحسين تلقائي',
    calendar: 'تقويم الأعياد',
    messages: 'Email/SMS/WA',
    series: 'سلسلة رسائل',
    landing: 'صفحات هبوط',
    schedule: 'تقويم المحتوى',
    approvals: 'موافقات العميل',
    history: 'السجل',
    library: 'مكتبة الإعلانات',
    support: 'الدعم',
    clients: 'العملاء',
    briefs: 'الموجزات',
    publish: 'نشر',
    campaign: 'حملة',
    pixel: 'Pixel Builder',
    team: 'الفريق',
    agency: 'White-Label',
    credits: 'الرصيد',
    sec_analyze: '📊 التحليل',
    sec_create: '✨ الإنشاء',
    sec_messages: '📧 الرسائل',
    sec_content: '📅 المحتوى',
    sec_meta: '🔌 Meta',
    sec_manage: '⚙️ الإدارة',
  },
  public: {
    home: 'الرئيسية',
    features: 'الميزات',
    pricing: 'الأسعار',
    how_it_works: 'كيف يعمل',
    faq: 'أسئلة شائعة',
    blog: 'مدونة',
    contact: 'تواصل',
    start_free: 'ابدأ مجانًا',
    hero_badge: '🚀 ذكاء اصطناعي يوفر 80% من وقتك',
    hero_title_pre: 'الذكاء الاصطناعي يقوم بـ',
    hero_title_em: '90%',
    hero_title_post: 'من عمل المسوّق',
    hero_sub: 'من الموجز إلى المنشور، إلى الصورة، إلى حملة Meta كاملة — بالعربية والعبرية والإنجليزية. بدون prompts. بدون نسخ ولصق. جاهز للنشر مباشرة.',
    cta_start_free: 'ابدأ مجانًا — هدية 150 رصيد',
    cta_how: 'كيف يعمل →',
  },
};

const DICTS: Record<Locale, Dict> = { he: HE, en: EN, ar: AR };

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
}

export function getDir(locale: Locale): 'rtl' | 'ltr' {
  return LOCALES.find(l => l.id === locale)?.dir ?? 'rtl';
}

export function parseLocale(input: string | undefined | null): Locale {
  const l = (input || '').toLowerCase().slice(0, 2);
  return (LOCALES.some(x => x.id === l) ? l : DEFAULT_LOCALE) as Locale;
}
