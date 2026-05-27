import Link from 'next/link';

export const metadata = { title: 'איך זה עובד' };

const STEPS = [
  {
    n: 1,
    t: 'בריף',
    d: 'מלא בריף קצר על העסק / הקמפיין / הקהל. או שלח קוד ללקוח שלך והוא ימלא בעצמו בדף עצמאי.',
    i: '📋',
    items: ['בריף בפורמט Schwartz/Hormozi', 'קוד ייחודי ללקוח', 'תמיכה בעברית, אנגלית וערבית'],
  },
  {
    n: 2,
    t: 'AI מייצר',
    d: 'בלחיצה אחת — Claude יוצר אווטאר לקוח מלא, מודעות לכל שלב במשפך, תמונות מותאמות, וסדרת הודעות.',
    i: '🪄',
    items: ['אווטאר Hormozi × Schwartz', '4 מודעות (TOFU/MOFU/BOFU/RM)', 'תמונות 1:1/9:16/16:9', 'משפך שיווקי מלא'],
  },
  {
    n: 3,
    t: 'אישור ופרסום',
    d: 'שלח את התוצאות ללקוח בדף ממותג. אחרי האישור — פרסם ישיר ל-Meta בלי לצאת מהמסך.',
    i: '🚀',
    items: ['דף אישור ציבורי ממותג', 'פידבק → שיפור אוטומטי', 'פרסום ישיר ל-Facebook + Instagram', 'Campaign Manager מובנה'],
  },
];

export default function HowItWorksPage() {
  return (
    <div className="px-4 py-16 max-w-5xl mx-auto">
      <div className="hero-mesh relative overflow-hidden -mx-4 px-4 py-12 mb-16">
        <div className="relative z-10 max-w-3xl">
          <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">תהליך</div>
          <h1 className="font-serif text-white text-4xl md:text-6xl leading-tight tracking-tight">
            איך זה עובד
          </h1>
          <span className="rule-gold mt-5 block w-32" aria-hidden />
          <p className="text-t2 max-w-2xl mt-6 text-lg leading-relaxed">3 שלבים מבריף לפרסום. כל התהליך — 19.3 שניות לבריף קצר.</p>
        </div>
      </div>

      <div className="space-y-12">
        {STEPS.map((s, i) => (
          <div key={s.n} className="grid md:grid-cols-[120px_1fr] gap-6 items-start">
            <div className="text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#0A7AFF] to-[#6D28D9] text-white flex items-center justify-center text-3xl font-bold mx-auto mb-2">
                {s.n}
              </div>
              <div className="text-3xl">{s.i}</div>
            </div>
            <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-6">
              <h2 className="text-2xl font-bold text-white mb-2">{s.t}</h2>
              <p className="text-[#6B8FA8] mb-4 leading-relaxed">{s.d}</p>
              <ul className="grid sm:grid-cols-2 gap-2">
                {s.items.map(item => (
                  <li key={item} className="flex items-center gap-2 text-[12.5px] text-[#D9E8F5]">
                    <span className="text-[#34D399]">✓</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center mt-16 bg-gradient-to-br from-[#0A7AFF]/12 to-[#6D28D9]/8 border border-[#0A7AFF]/30 rounded-2xl p-10">
        <h2 className="text-2xl font-bold text-white mb-3">מוכן לראות בעצמך?</h2>
        <p className="text-[#6B8FA8] mb-5">150 קרדיטים מתנה — מספיק ל-50 פוסטים או 30 תמונות.</p>
        <Link href="/register"
          className="inline-block px-6 py-3 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-bold rounded-lg transition-all">
          התחל חינם →
        </Link>
      </div>
    </div>
  );
}
