'use client';
import Link from 'next/link';
import { PLAN_CONFIG } from '@/types';
import { useI18n } from '@/lib/i18n-context';
import {
  Dna, PenLine, Wand2, FlaskConical, CalendarClock,
  RefreshCw, BadgeCheck, Rocket, BarChart3, ArrowLeft, ArrowRight,
} from 'lucide-react';

const PROOF_STATS_HE = [
  { v: '500+',    l: 'משתמשים פעילים' },
  { v: '50,000+', l: 'מודעות נוצרו' },
  { v: '80%',     l: 'חיסכון בזמן' },
  { v: '340%',    l: 'שיפור CTR ממוצע' },
];
const PROOF_STATS_EN = [
  { v: '500+',    l: 'active users' },
  { v: '50,000+', l: 'ads generated' },
  { v: '80%',     l: 'time saved' },
  { v: '340%',    l: 'avg CTR boost' },
];
const PROOF_STATS_AR = [
  { v: '500+',    l: 'مستخدم نشط' },
  { v: '50,000+', l: 'إعلان تم إنشاؤه' },
  { v: '80%',     l: 'توفير في الوقت' },
  { v: '340%',    l: 'تحسّن في CTR' },
];

const FEATURES_HE = [
  { Icon: Dna,           t:'אווטאר לקוח',          d:'בריף → פרופיל לקוח מלא לפי Hormozi × Schwartz' },
  { Icon: PenLine,       t:'8 frameworks קופירייטינג', d:'PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN' },
  { Icon: Wand2,         t:'מחולל תמונות',          d:'Ideogram + DALL-E 3 — וגם עריכה בטקסט' },
  { Icon: FlaskConical,  t:'The Lab',              d:'שילוב ועיצוב מחדש של תוכן — חינם' },
  { Icon: CalendarClock, t:'סדרות הודעות',          d:'קמפיינים מולטי-ערוציים עד 180 ימים' },
  { Icon: RefreshCw,     t:'שיפור אוטומטי',         d:'פידבק לקוח → גרסה משופרת' },
  { Icon: BadgeCheck,    t:'אישורי לקוח',           d:'דף ממותג לאישור — לחיצה אחת' },
  { Icon: Rocket,        t:'קמפיין Meta',          d:'בנייה ב-5 שלבים → השקה' },
  { Icon: BarChart3,     t:'אנליטיקה + מתחרים',     d:'ביצועים בזמן אמת + מחקר מתחרים' },
];
const FEATURES_EN = [
  { Icon: Dna,           t:'Customer avatar',       d:'Brief → full profile (Hormozi × Schwartz)' },
  { Icon: PenLine,       t:'8 copy frameworks',     d:'PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN' },
  { Icon: Wand2,         t:'AI image generator',    d:'Ideogram + DALL-E 3 — text-based editing' },
  { Icon: FlaskConical,  t:'The Lab',               d:'Remix and reshape content — free' },
  { Icon: CalendarClock, t:'Message series',        d:'Multi-channel campaigns up to 180 days' },
  { Icon: RefreshCw,     t:'Auto-refinement',       d:'Client feedback → refined version' },
  { Icon: BadgeCheck,    t:'Client approvals',      d:'Branded page for one-click approval' },
  { Icon: Rocket,        t:'Meta campaigns',        d:'5-step builder → live' },
  { Icon: BarChart3,     t:'Analytics + competitors', d:'Real-time stats + competitor research' },
];
const FEATURES_AR = [
  { Icon: Dna,           t:'صورة العميل',           d:'موجز → ملف شامل (Hormozi × Schwartz)' },
  { Icon: PenLine,       t:'8 إطارات كتابة',         d:'PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN' },
  { Icon: Wand2,         t:'مولّد صور AI',           d:'Ideogram + DALL-E 3 — تحرير نصي' },
  { Icon: FlaskConical,  t:'The Lab',               d:'دمج وإعادة صياغة — مجاني' },
  { Icon: CalendarClock, t:'سلاسل رسائل',           d:'حملات متعددة القنوات حتى 180 يومًا' },
  { Icon: RefreshCw,     t:'تحسين تلقائي',           d:'تعليقات العميل → نسخة محسّنة' },
  { Icon: BadgeCheck,    t:'موافقات العميل',         d:'صفحة بعلامتك للموافقة بنقرة' },
  { Icon: Rocket,        t:'حملات Meta',             d:'5 خطوات → نشر' },
  { Icon: BarChart3,     t:'تحليلات ومنافسون',       d:'إحصائيات فورية + بحث منافسين' },
];

const TESTIMONIALS_HE = [
  { q: 'תוך שבוע עברתי מ-3 שעות על פוסט ל-15 דקות. מה שעבד אצלי בקמפיין האחרון — admaster עשה את זה אוטומטית מהבריף.', name: 'יעל א.', role: 'מנכ״לית סוכנות דיגיטל' },
  { q: 'לראשונה הלקוחות שלי מאשרים מודעות מהמובייל בלי שיחות וואטסאפ אינסופיות. הלינק עושה את הקסם.', name: 'דניאל מ.', role: 'מנהל קמפיינים Meta' },
];
const TESTIMONIALS_EN = [
  { q: 'In a week I went from 3 hours per post to 15 minutes. What worked for my last campaign — admaster did it automatically from the brief.', name: 'Yael A.', role: 'CEO, Digital Agency' },
  { q: 'For the first time my clients approve ads from their phones — no endless WhatsApp threads. The approval link is magic.', name: 'Daniel M.', role: 'Meta Campaign Manager' },
];
const TESTIMONIALS_AR = [
  { q: 'في أسبوع انتقلت من 3 ساعات للمنشور إلى 15 دقيقة. admaster فعل تلقائيًا ما نجح في حملتي الأخيرة.', name: 'يائيل أ.', role: 'الرئيسة التنفيذية، وكالة رقمية' },
  { q: 'لأول مرة يوافق عملائي على الإعلانات من هواتفهم — بدون محادثات واتساب طويلة.', name: 'دانييل م.', role: 'مدير حملات Meta' },
];

const LOGO_BRANDS = ['NORTH', 'KESHET', 'BANKIR', 'YALA', 'STUDIO 12', 'LEVANTI'];

export default function WelcomePage() {
  const { t, locale } = useI18n();
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const stats        = locale === 'en' ? PROOF_STATS_EN  : locale === 'ar' ? PROOF_STATS_AR  : PROOF_STATS_HE;
  const cards        = locale === 'en' ? FEATURES_EN     : locale === 'ar' ? FEATURES_AR     : FEATURES_HE;
  const testimonials = locale === 'en' ? TESTIMONIALS_EN : locale === 'ar' ? TESTIMONIALS_AR : TESTIMONIALS_HE;
  const Chevron = dir === 'rtl' ? ArrowLeft : ArrowRight;

  const kickerHe = 'AI שיווק • ישראל';
  const kickerEn = 'AI MARKETING • IL';
  const kickerAr = 'تسويق AI • IL';
  const kicker = locale === 'en' ? kickerEn : locale === 'ar' ? kickerAr : kickerHe;

  return (
    <div>
      {/* HERO — editorial × premium tech */}
      <section className="hero-mesh relative overflow-hidden px-6 pt-20 pb-28 max-w-6xl mx-auto">
        <div className="relative z-10 max-w-3xl">
          {/* Kicker label */}
          <div className="animate-fade-up reveal-1 mb-7 flex items-center gap-3 text-2xs font-bold tracking-kicker uppercase text-t2">
            <span className="inline-block w-8 h-px bg-goldl" aria-hidden />
            <span>{kicker}</span>
          </div>

          {/* Display headline */}
          <h1
            className="animate-fade-up reveal-2 font-serif text-white text-5xl md:text-7xl lg:text-8xl leading-[0.92] tracking-tight mb-7"
          >
            {t.public.hero_title_pre}{' '}
            <em className="text-goldl not-italic">{t.public.hero_title_em}</em>
            <br />
            {t.public.hero_title_post}
          </h1>

          {/* Editorial gold rule that breaks the grid */}
          <span className="rule-gold animate-fade-up reveal-2 block w-40 mb-8" aria-hidden />

          {/* Subhead */}
          <p className="animate-fade-up reveal-3 text-lg md:text-xl text-t2 leading-relaxed max-w-2xl mb-10">
            {t.public.hero_sub}
          </p>

          {/* Single primary CTA + ghost link */}
          <div className="animate-fade-up reveal-4 flex flex-col sm:flex-row sm:items-center gap-5">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-blue hover:bg-blue2 text-white text-sm font-bold rounded-lg shadow-[0_4px_24px_rgba(10,122,255,0.35)] transition-all active:scale-[0.98] cursor-pointer"
            >
              <span>{t.public.cta_start_free}</span>
              <Chevron size={16} strokeWidth={2.25} className="transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-t2 hover:text-blue2 transition-colors cursor-pointer"
            >
              <span>{t.public.cta_how}</span>
              <Chevron size={14} strokeWidth={2} />
            </Link>
          </div>
        </div>
      </section>

      {/* STATS STRIP — oversized DM Serif numerals, editorial labels */}
      <section className="px-6 py-14 max-w-6xl mx-auto border-t border-b border-b1">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-10 gap-x-6">
          {stats.map((s, idx) => (
            <div key={s.l} className="text-center md:text-start">
              <div className="font-serif text-4xl md:text-5xl text-white leading-none mb-2 tabular-nums">{s.v}</div>
              <div className="text-2xs font-bold tracking-label uppercase text-t2">{s.l}</div>
              {idx === stats.length - 1 ? null : (
                <span className="hidden md:inline-block absolute" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* SOCIAL PROOF — logo wall (placeholder wordmarks for now) */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <div className="text-2xs font-bold tracking-label uppercase text-t3 text-center mb-7">
          {locale === 'en' ? 'Trusted by teams at' : locale === 'ar' ? 'يثق بنا فرق في' : 'בשימוש בצוותים מובילים'}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-5 opacity-60 hover:opacity-90 transition-opacity">
          {LOGO_BRANDS.map(name => (
            <span
              key={name}
              className="font-serif text-xl md:text-2xl text-t2 tracking-wider select-none"
            >
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* FEATURES — lucide icons, editorial card treatment */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <div className="max-w-2xl mb-12">
          <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">{t.public.features}</div>
          <h2 className="font-serif text-3xl md:text-5xl text-white leading-tight">
            {locale === 'en' ? 'Everything in one place' : locale === 'ar' ? 'كل شيء في مكان واحد' : 'הכל במקום אחד'}
          </h2>
          <span className="rule-gold mt-5 block w-24" aria-hidden />
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(({ Icon, t: title, d }) => (
            <div
              key={title}
              className="group bg-s1 border border-b1 rounded-xl p-6 hover:border-b2 hover:-translate-y-0.5 transition-all"
            >
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-blue/10 text-blue2 mb-4 group-hover:bg-blue/15 transition-colors">
                <Icon size={22} strokeWidth={1.6} aria-hidden />
              </div>
              <div className="font-bold text-base text-t1 mb-1.5">{title}</div>
              <div className="text-sm text-t2 leading-relaxed">{d}</div>
            </div>
          ))}
        </div>
        <div className="mt-10">
          <Link href="/features" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue2 hover:text-blue transition-colors cursor-pointer">
            <span>{locale === 'en' ? 'All features' : locale === 'ar' ? 'كل الميزات' : 'כל היכולות'}</span>
            <Chevron size={14} strokeWidth={2} />
          </Link>
        </div>
      </section>

      {/* TESTIMONIALS — editorial pull-quotes, asymmetric */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">
          {locale === 'en' ? 'Words from users' : locale === 'ar' ? 'كلمات من المستخدمين' : 'מהמשתמשים שלנו'}
        </div>
        <span className="rule-gold mb-12 block w-24" aria-hidden />
        <div className="grid md:grid-cols-2 gap-6 md:gap-10">
          {testimonials.map((tst, idx) => (
            <figure
              key={tst.name}
              className={`bg-s1 border border-b1 rounded-2xl p-8 md:p-10 ${idx === 1 ? 'md:translate-y-12' : ''}`}
            >
              <div className="font-serif text-goldl text-5xl leading-none mb-4 select-none" aria-hidden>“</div>
              <blockquote className="font-serif italic text-xl md:text-2xl text-t1 leading-snug mb-7">
                {tst.q}
              </blockquote>
              <figcaption className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue/15 text-blue2 font-bold text-sm">
                  {tst.name.charAt(0)}
                </span>
                <div>
                  <div className="text-sm font-bold text-t1">{tst.name}</div>
                  <div className="text-2xs font-bold tracking-label uppercase text-t2">{tst.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* PRICING TEASER — tablet-aware grid */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">{t.public.pricing}</div>
        <h2 className="font-serif text-3xl md:text-4xl text-white mb-1">
          {locale === 'en' ? 'Simple pricing' : locale === 'ar' ? 'تسعير بسيط' : 'מחירים פשוטים'}
        </h2>
        <span className="rule-gold mb-10 block w-24" aria-hidden />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(['free','starter','pro','agency'] as const).map(id => {
            const p = PLAN_CONFIG[id];
            const isPro = id === 'pro';
            return (
              <div
                key={id}
                className="bg-s1 rounded-xl p-5 border hover:-translate-y-0.5 transition-all"
                style={{ borderColor: isPro ? p.color : '#1E2F42' }}
              >
                <div className="font-bold text-lg" style={{ color: p.color }}>{p.name}</div>
                <div className="font-mono text-3xl text-white mt-2 tabular-nums">
                  {p.price === 0 ? t.common.free : `₪${p.price}`}
                  {p.price > 0 && <span className="text-xs text-t2">/{locale==='en'?'mo':locale==='ar'?'شهر':'חודש'}</span>}
                </div>
                <div className="text-xs text-t2 mt-2">{p.credits.toLocaleString()} {t.common.credits}</div>
                <Link
                  href="/pricing"
                  className="block text-center mt-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}33` }}
                >
                  {t.public.pricing}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* FINAL CTA — confident, single action */}
      <section className="px-6 py-24 max-w-4xl mx-auto text-center">
        <div className="relative bg-gradient-to-br from-blue/12 to-goldl/06 border border-b1 rounded-3xl p-12 md:p-16 overflow-hidden">
          <span className="rule-gold mb-6 mx-auto block w-16" aria-hidden />
          <h2 className="font-serif text-3xl md:text-5xl text-white mb-7 leading-tight">
            {locale === 'en' ? 'Ready to start?' : locale === 'ar' ? 'هل أنت مستعد للبدء؟' : 'מוכן להתחיל?'}
          </h2>
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 px-8 py-3.5 bg-blue hover:bg-blue2 text-white text-sm font-bold rounded-lg shadow-[0_4px_24px_rgba(10,122,255,0.4)] transition-all active:scale-[0.98] cursor-pointer"
          >
            <span>{t.public.cta_start_free}</span>
            <Chevron size={16} strokeWidth={2.25} className="transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
