import Link from 'next/link';
import { PLAN_CONFIG, CREDIT_COSTS } from '@/types';

export const metadata = { title: 'מחירים' };

const FEATURES_PER_PLAN: Record<keyof typeof PLAN_CONFIG, string[]> = {
  free: [
    '150 קרדיטים בחודש',
    '8 frameworks קופירייטינג',
    'מחולל תמונות בסיסי',
    'בריפי לקוחות',
    'לוח חגים יהודי',
    'The Lab (חינם)',
  ],
  starter: [
    '400 קרדיטים בחודש',
    'הכל מה-Free, ועוד:',
    'Email / SMS / WhatsApp',
    'אישורי לקוח עם דף ממותג',
    'שיפור אוטומטי (5 איטרציות חופשיות)',
    'תמיכה במייל',
  ],
  pro: [
    '1,200 קרדיטים בחודש',
    'הכל מה-Starter, ועוד:',
    'סדרות הודעות עד 180 ימים',
    'White-Label בסיסי (לוגו + צבעים)',
    'פרסום ישיר ל-Meta',
    'מחקר מתחרים + אנליטיקה',
    'עד 5 חברי צוות',
  ],
  agency: [
    '5,000 קרדיטים בחודש',
    'הכל מה-Pro, ועוד:',
    'White-Label מלא + דומיין מותאם',
    'לקוחות Meta ללא הגבלה',
    'עד 20 חברי צוות',
    'דוחות White-Label',
    'תמיכת VIP + הדרכה אישית',
  ],
};

export default function PricingPage() {
  return (
    <div className="px-4 py-16 max-w-6xl mx-auto">
      <div className="hero-mesh relative overflow-hidden -mx-4 px-4 py-12 mb-12">
        <div className="relative z-10 max-w-3xl">
          <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">תמחור</div>
          <h1 className="font-serif text-white text-4xl md:text-6xl leading-tight tracking-tight">
            תמחור פשוט וברור
          </h1>
          <span className="rule-gold mt-5 block w-32" aria-hidden />
          <p className="text-t2 max-w-2xl mt-6 text-lg leading-relaxed">בלי הפתעות. בלי עלויות נסתרות. תוכל לבטל בכל רגע.</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-16">
        {(['free','starter','pro','agency'] as const).map(id => {
          const p = PLAN_CONFIG[id];
          const isPro = id === 'pro';
          return (
            <div key={id} className="bg-[#152138] rounded-2xl p-6 border relative"
              style={{ borderColor: isPro ? p.color : '#243752' }}>
              {isPro && (
                <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-goldl text-bg text-2xs font-bold tracking-label px-3 py-1 rounded-full uppercase shadow-[0_4px_14px_rgba(212,175,85,0.35)]">
                  הכי פופולרי
                </div>
              )}
              <div className="font-bold text-lg mb-1" style={{ color: p.color }}>{p.name}</div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="font-mono text-4xl text-white">{p.price === 0 ? 'חינם' : `₪${p.price}`}</span>
                {p.price > 0 && <span className="text-sm text-[#6B8FA8]">/חודש</span>}
              </div>
              <div className="text-xs text-[#6B8FA8] mb-4">{p.credits.toLocaleString()} קרדיטים/חודש</div>
              <ul className="space-y-2 mb-6 text-[12.5px] text-[#D9E8F5]">
                {FEATURES_PER_PLAN[id].map(f => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-[#34D399] flex-shrink-0 mt-0.5">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register"
                className="block text-center py-2.5 rounded-lg text-sm font-bold transition-colors"
                style={{ background: isPro ? p.color : `${p.color}20`, color: isPro ? 'white' : p.color, border: isPro ? 'none' : `1px solid ${p.color}40` }}>
                {p.price === 0 ? 'התחל בחינם' : 'בחר תוכנית'}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Credit costs table */}
      <div className="bg-[#152138] border border-[#243752] rounded-2xl p-6 mb-16">
        <h2 className="font-bold text-xl text-white mb-4">עלות פעולות (בקרדיטים)</h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
          {Object.entries(CREDIT_COSTS).map(([action, cost]) => {
            const labelMap: Record<string, string> = {
              post:'✨ יצירת פוסט', analyze:'🔬 ניתוח מודעה', variations:'🔀 וריאציות',
              holiday:'📅 פוסט לחג', publish:'📤 פרסום פוסט', campaign:'🚀 קמפיין Meta',
              avatar:'🧬 בניית אווטאר', ads_avatar:'✍️ מודעות מאווטאר', funnel:'🔮 משפך שיווקי',
              lab:'🧪 The Lab', email:'📧 כתיבת אימייל', sms:'📱 כתיבת SMS',
              series:'🗓 סדרת הודעות', refine:'🔁 שיפור (אחרי 5 חופשיות)',
              approval:'✅ אישור לקוח', img_edit:'🪄 עריכת תמונה',
            };
            return (
              <div key={action} className="flex items-center justify-between py-1.5 border-b border-[#243752] last:border-0">
                <span className="text-[#D9E8F5]">{labelMap[action] ?? action}</span>
                <span className={cost === 0 ? 'text-[#34D399] font-bold' : 'font-mono text-[#D4AF55]'}>
                  {cost === 0 ? 'חינם' : `${cost}⚡`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center">
        <Link href="/faq" className="text-[#3D9FFF] text-sm font-semibold hover:underline">שאלות נפוצות לגבי תוכניות →</Link>
      </div>
    </div>
  );
}
