'use client';
import { useState } from 'react';
import Link from 'next/link';

const FAQS = [
  {
    q: 'מה זה AdMaster Pro?',
    a: 'פלטפורמה ישראלית שמשתמשת ב-Claude AI ליצירת תוכן שיווקי — פוסטים, מודעות, תמונות, אימיילים, סדרות קמפיינים — ופרסום ישיר ל-Meta (Facebook + Instagram). מבריף קצר, AI עושה את כל העבודה.',
  },
  {
    q: 'מה ההבדל מ-ChatGPT / Claude רגיל?',
    a: 'AdMaster פותח במיוחד לשיווק דיגיטלי בעברית: 8 frameworks קופירייטינג מוכנים (PAS, AIDA, BAB...), אווטאר לקוח לפי Hormozi × Schwartz, תמיכה ב-RTL ובחגים יהודיים, אינטגרציה ישירה עם Meta, מערכת אישורי לקוח ממותגת. הכל במקום אחד.',
  },
  {
    q: 'איך עובדת מערכת הקרדיטים?',
    a: 'כל פעולה (יצירת פוסט = 3, ניתוח = 5, קמפיין מלא = 15) צורכת קרדיטים. בתוכנית החינמית מקבלים 150 קרדיטים בחודש. The Lab תמיד חינם — שילוב ועיצוב מחדש של תוכן קיים.',
  },
  {
    q: 'אפשר לעבוד בעברית ובאנגלית?',
    a: 'כן. הפלטפורמה תומכת בעברית (RTL), אנגלית וערבית. ה-AI מייצר תוכן בכל אחת מהשפות לפי בחירה. כל המסכים תומכים ב-RTL מלא.',
  },
  {
    q: 'איך פרסום ישיר ל-Meta עובד?',
    a: 'מחברים את חשבון Meta שלך (Access Token דרך Facebook Login), בוחרים דף עסקי + חשבון מודעות. אחרי האישור — לחיצה אחת מפרסמת פוסטים לדף או יוצרת קמפיין ב-Ads Manager. הקמפיינים נשמרים ב-PAUSED כברירת מחדל לבטיחות.',
  },
  {
    q: 'מה ההבדל בין התוכניות?',
    a: 'Free (₪0) — בסיס. Starter (₪79) — Email/SMS/WhatsApp + אישורי לקוח. Pro (₪199) — סדרות הודעות עד 180 ימים + White-Label + פרסום Meta + מחקר מתחרים. Agency (₪499) — White-Label מלא + דומיין מותאם + לקוחות בלי הגבלה + תמיכת VIP.',
  },
  {
    q: 'איך עובד "The Lab"?',
    a: 'The Lab זה אזור חינמי שבו אפשר לשלב 2 פוסטים לפוסט אחד (Merge), לשנות זווית של פוסט קיים (Reframe), או להתאים פוסט לפלטפורמה / טון / קהל שונים (Translate) — בלי לבזבז קרדיטים.',
  },
  {
    q: 'אישורי לקוח — איך זה עובד?',
    a: 'יוצרים בקשה עם התוכן + תמונה, מקבלים קישור ייחודי שניתן לשלוח ללקוח. הלקוח רואה את התוכן בדף ממותג (לוגו + צבעים שלך אם אתה ב-White-Label) ולוחץ ✅ אשר / ✍️ בקש שינויים / ❌ דחה. אם ביקש שינויים — אתה רואה את הפידבק בדשבורד ויכול להזין ל-"שיפור אוטומטי" בלחיצה.',
  },
  {
    q: 'מהי "סדרת הודעות עד 180 ימים"?',
    a: 'בוחרים מטרה (Lead Nurture / Onboarding / Reengagement / השקה), משך (30/60/90/180 ימים) וערוצים (Email/WhatsApp/SMS). ה-AI בונה לוח זמנים מלא — איזה הודעה ביום כמה, באיזה ערוץ, עם איזה framework. אפשר לערוך, לשמור, ולפרסם בהמשך.',
  },
  {
    q: 'כמה זמן לוקח ליצור פוסט?',
    a: 'בריף → פוסט מלא עם הצעת תמונה, hashtags, ו-WhatsApp variant — 19.3 שניות בממוצע. תמונה מ-Ideogram — 10-20 שניות נוספות.',
  },
  {
    q: 'נתונים שלי שמורים בבטחה?',
    a: 'כן. הכל נשמר ב-Supabase (PostgreSQL) עם Row Level Security — אתה יכול לראות רק את הנתונים שלך. Access tokens של Meta מוצפנים. בסביבת production — אנו ממליצים על Supabase Vault להצפנה נוספת.',
  },
  {
    q: 'אפשר לבטל בכל רגע?',
    a: 'כן. בלי קנסות. בלי שאלות. ניהול דרך Stripe Customer Portal. הקרדיטים שלך נשמרים עד סוף תקופת החיוב הנוכחית.',
  },
];

export default function FaqPage() {
  const [open, setOpen] = useState<number|null>(0);
  return (
    <div className="px-4 py-16 max-w-3xl mx-auto">
      <div className="hero-mesh relative overflow-hidden -mx-4 px-4 py-12 mb-12">
        <div className="relative z-10 max-w-3xl">
          <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">FAQ</div>
          <h1 className="font-serif text-white text-4xl md:text-5xl leading-tight tracking-tight">
            שאלות נפוצות
          </h1>
          <span className="rule-gold mt-5 block w-32" aria-hidden />
          <p className="text-t2 mt-6 text-lg leading-relaxed">הכל מה שרציתם לדעת לפני שמתחילים</p>
        </div>
      </div>

      <div className="space-y-2">
        {FAQS.map((f, i) => (
          <div key={i} className="bg-[#111A24] border border-[#1E2F42] rounded-xl overflow-hidden">
            <button onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-right hover:bg-[#162030] transition-colors">
              <span className="font-semibold text-[#D9E8F5] text-[14.5px]">{f.q}</span>
              <span className={`text-[#3D9FFF] text-lg transition-transform ${open === i ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {open === i && (
              <div className="px-5 pb-4 text-[13.5px] text-[#6B8FA8] leading-relaxed border-t border-[#1E2F42] pt-3">
                {f.a}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="text-center mt-12">
        <p className="text-[#6B8FA8] text-sm mb-3">יש שאלה שלא נענתה?</p>
        <Link href="/contact" className="inline-block px-5 py-2.5 border border-[#0A7AFF] text-[#3D9FFF] hover:bg-[#0A7AFF]/10 text-sm font-bold rounded-lg transition-colors">
          צור קשר →
        </Link>
      </div>
    </div>
  );
}
