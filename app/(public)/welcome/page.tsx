'use client';
import Link from 'next/link';
import { PLAN_CONFIG } from '@/types';
import { useI18n } from '@/lib/i18n-context';

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
  { i:'🧬', t:'אווטאר לקוח',          d:'בריף → פרופיל לקוח מלא לפי Hormozi × Schwartz' },
  { i:'✍️', t:'8 frameworks קופירייטינג', d:'PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN' },
  { i:'🎨', t:'מחולל תמונות',          d:'Ideogram + DALL-E 3 — וגם עריכה בטקסט' },
  { i:'🧪', t:'The Lab',              d:'שילוב ועיצוב מחדש של תוכן — חינם' },
  { i:'🗓', t:'סדרות הודעות',          d:'קמפיינים מולטי-ערוציים עד 180 ימים' },
  { i:'🔁', t:'שיפור אוטומטי',         d:'פידבק לקוח → גרסה משופרת' },
  { i:'✅', t:'אישורי לקוח',           d:'דף ממותג לאישור — לחיצה אחת' },
  { i:'🚀', t:'קמפיין Meta',          d:'בנייה ב-5 שלבים → השקה' },
  { i:'📊', t:'אנליטיקה + מתחרים',     d:'ביצועים בזמן אמת + מחקר מתחרים' },
];
const FEATURES_EN = [
  { i:'🧬', t:'Customer avatar',       d:'Brief → full profile (Hormozi × Schwartz)' },
  { i:'✍️', t:'8 copy frameworks',     d:'PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN' },
  { i:'🎨', t:'AI image generator',    d:'Ideogram + DALL-E 3 — text-based editing' },
  { i:'🧪', t:'The Lab',               d:'Remix and reshape content — free' },
  { i:'🗓', t:'Message series',        d:'Multi-channel campaigns up to 180 days' },
  { i:'🔁', t:'Auto-refinement',       d:'Client feedback → refined version' },
  { i:'✅', t:'Client approvals',      d:'Branded page for one-click approval' },
  { i:'🚀', t:'Meta campaigns',        d:'5-step builder → live' },
  { i:'📊', t:'Analytics + competitors', d:'Real-time stats + competitor research' },
];
const FEATURES_AR = [
  { i:'🧬', t:'صورة العميل',           d:'موجز → ملف شامل (Hormozi × Schwartz)' },
  { i:'✍️', t:'8 إطارات كتابة',         d:'PAS, AIDA, BAB, FAB, 4Ps, QUEST, Story, AICPBSAWN' },
  { i:'🎨', t:'مولّد صور AI',           d:'Ideogram + DALL-E 3 — تحرير نصي' },
  { i:'🧪', t:'The Lab',               d:'دمج وإعادة صياغة — مجاني' },
  { i:'🗓', t:'سلاسل رسائل',           d:'حملات متعددة القنوات حتى 180 يومًا' },
  { i:'🔁', t:'تحسين تلقائي',           d:'تعليقات العميل → نسخة محسّنة' },
  { i:'✅', t:'موافقات العميل',         d:'صفحة بعلامتك للموافقة بنقرة' },
  { i:'🚀', t:'حملات Meta',             d:'5 خطوات → نشر' },
  { i:'📊', t:'تحليلات ومنافسون',       d:'إحصائيات فورية + بحث منافسين' },
];

export default function WelcomePage() {
  const { t, locale } = useI18n();
  const stats   = locale === 'en' ? PROOF_STATS_EN : locale === 'ar' ? PROOF_STATS_AR : PROOF_STATS_HE;
  const cards   = locale === 'en' ? FEATURES_EN    : locale === 'ar' ? FEATURES_AR    : FEATURES_HE;

  return (
    <div>
      {/* HERO */}
      <section className="px-4 pt-16 pb-24 text-center max-w-4xl mx-auto">
        <div className="inline-block bg-[#0A7AFF]/10 border border-[#0A7AFF]/25 text-[#3D9FFF] text-xs font-bold px-3 py-1.5 rounded-full mb-6">
          {t.public.hero_badge}
        </div>
        <h1 className="text-4xl md:text-6xl font-bold text-white leading-tight mb-5"
            style={{ fontFamily: 'DM Serif Display,serif' }}>
          {t.public.hero_title_pre} <em className="text-[#D4AF55] not-italic">{t.public.hero_title_em}</em><br/>
          {t.public.hero_title_post}
        </h1>
        <p className="text-lg text-[#6B8FA8] max-w-2xl mx-auto mb-8 leading-relaxed">
          {t.public.hero_sub}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
          <Link href="/register"
            className="px-6 py-3 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-bold rounded-lg shadow-[0_4px_24px_rgba(10,122,255,0.35)] transition-all">
            {t.public.cta_start_free}
          </Link>
          <Link href="/how-it-works"
            className="px-6 py-3 border border-[#2A4158] hover:border-[#0A7AFF] text-[#6B8FA8] hover:text-[#3D9FFF] text-sm font-bold rounded-lg transition-all">
            {t.public.cta_how}
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
          {stats.map(s => (
            <div key={s.l} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-4">
              <div className="font-mono text-2xl font-medium text-[#D9E8F5]">{s.v}</div>
              <div className="text-[11px] text-[#6B8FA8] mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section className="px-4 py-16 max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">{t.public.features}</div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" style={{ fontFamily: 'DM Serif Display,serif' }}>
            {locale === 'en' ? 'Everything in one place' : locale === 'ar' ? 'كل شيء في مكان واحد' : 'הכל במקום אחד'}
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {cards.map(f => (
            <div key={f.t} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-5 hover:border-[#2A4158] transition-all">
              <div className="text-3xl mb-3">{f.i}</div>
              <div className="font-bold text-base text-[#D9E8F5] mb-1.5">{f.t}</div>
              <div className="text-[12.5px] text-[#6B8FA8] leading-relaxed">{f.d}</div>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <Link href="/features" className="text-[#3D9FFF] text-sm font-semibold hover:underline">{t.public.features} →</Link>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="px-4 py-16 max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">{t.public.pricing}</div>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          {(['free','starter','pro','agency'] as const).map(id => {
            const p = PLAN_CONFIG[id];
            const isPro = id === 'pro';
            return (
              <div key={id} className="bg-[#111A24] rounded-xl p-5 border" style={{ borderColor: isPro ? p.color : '#1E2F42' }}>
                <div className="font-bold text-lg" style={{ color: p.color }}>{p.name}</div>
                <div className="font-mono text-3xl text-white mt-2">{p.price === 0 ? t.common.free : `₪${p.price}`}{p.price > 0 && <span className="text-xs text-[#6B8FA8]">/{locale==='en'?'mo':locale==='ar'?'شهر':'חודש'}</span>}</div>
                <div className="text-xs text-[#6B8FA8] mt-2">{p.credits.toLocaleString()} {t.common.credits}</div>
                <Link href="/pricing" className="block text-center mt-4 py-2 rounded-lg text-xs font-bold transition-colors"
                      style={{ background: `${p.color}15`, color: p.color, border: `1px solid ${p.color}33` }}>
                  {t.public.pricing}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-20 max-w-3xl mx-auto text-center">
        <div className="bg-gradient-to-br from-[#0A7AFF]/15 to-[#6D28D9]/10 border border-[#0A7AFF]/30 rounded-2xl p-10">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3" style={{ fontFamily: 'DM Serif Display,serif' }}>
            {locale === 'en' ? 'Ready to start?' : locale === 'ar' ? 'هل أنت مستعد للبدء؟' : 'מוכן להתחיל?'}
          </h2>
          <Link href="/register"
            className="inline-block px-8 py-3 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-bold rounded-lg shadow-[0_4px_24px_rgba(10,122,255,0.4)] transition-all">
            {t.public.cta_start_free} →
          </Link>
        </div>
      </section>
    </div>
  );
}
