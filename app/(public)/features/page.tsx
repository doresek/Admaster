import Link from 'next/link';

export const metadata = { title: 'יכולות מלאות' };

const CATEGORIES = [
  {
    title: '✨ יצירת תוכן',
    desc: 'מבריף לפוסט מוכן לפרסום',
    items: [
      { i:'✍️', t:'יצירת פוסט', d:'4 פלטפורמות (Facebook, Instagram, WhatsApp, TikTok), 8 frameworks קופירייטינג, 5 סוגי hook, 5 טונים' },
      { i:'🎨', t:'מחולל תמונות AI', d:'Ideogram V2 + DALL-E 3. 4 סגנונות (Realistic, Design, Illustration, 3D), 4 יחסי תמונה' },
      { i:'🪄', t:'עריכת תמונות בטקסט', d:'"שנה רקע לים", "הוסף לוגו פינה שמאלית", "החלף צבע ל-teal" — בלי Photoshop' },
      { i:'🔀', t:'5 וריאציות', d:'מפוסט אחד → 5 גרסאות שונות עם hooks שונים, מוכנות ל-A/B testing' },
      { i:'📅', t:'לוח חגים יהודי', d:'יצירת פוסטים מותאמים לראש השנה, חנוכה, פסח, שבועות וכל החגים' },
    ],
  },
  {
    title: '🧪 The Lab — חינם',
    desc: 'ערבוב, עיצוב מחדש ותרגום של תוכן קיים — ללא קרדיטים',
    items: [
      { i:'🧬', t:'Merge', d:'שילוב של שני פוסטים לפוסט אחד שמשלב את החוזקות' },
      { i:'🔄', t:'Reframe', d:'אותו מסר — מזווית שונה לגמרי' },
      { i:'🎭', t:'Translate', d:'התאמה לפלטפורמה / טון / קהל אחרים' },
    ],
  },
  {
    title: '🧬 בריפי לקוחות + Avatar',
    desc: 'קישור שיווקי → בריף מלא → אווטאר Hormozi × Schwartz → מודעות → משפך',
    items: [
      { i:'📋', t:'מערכת בריפים', d:'שלח קוד ללקוח, הוא ממלא בריף מבוסס Schwartz/Hormozi בדף עצמאי' },
      { i:'👤', t:'אווטאר לקוח', d:'דמוגרפיה, פסיכוגרפיה, מונולוג פנימי, כאבים פנימיים/חיצוניים, התנגדויות, טריגרים' },
      { i:'✍️', t:'4 מודעות מאווטאר', d:'TOFU (קר), MOFU (שיקול), BOFU (המרה), Remarketing — כל אחת לפי השלב' },
      { i:'🔮', t:'משפך שיווקי', d:'5 שלבים: תנועה → דף נחיתה → חינוך → מכירה → Upsell. עם KPIs מומלצים' },
    ],
  },
  {
    title: '📧 הודעות רב-ערוציות',
    desc: 'Email · WhatsApp · SMS — לכל אחד הפורמט והאורך שלו',
    items: [
      { i:'📧', t:'Email', d:'נושא + גוף 200-600 מילים, framework מובנה' },
      { i:'💬', t:'WhatsApp', d:'טקסט טבעי לצ\'אט, עד 1000 תווים' },
      { i:'📱', t:'SMS', d:'160 תווים מקסימום, ישיר ומהיר' },
      { i:'🗓', t:'סדרות עד 180 ימים', d:'AI מתכנן קמפיין מולטי-ערוצי לאורך זמן, עם לוח זמנים מסונכרן' },
    ],
  },
  {
    title: '🔁 שיפור אוטומטי + אישורי לקוח',
    desc: 'לולאת פידבק עם הלקוח — בלי לחזור הלוך ושוב באימייל',
    items: [
      { i:'🔁', t:'Refine Loop', d:'הזן פידבק → גרסה משופרת. 5 איטרציות חופשיות לכל פוסט' },
      { i:'✅', t:'אישורי לקוח', d:'קישור ציבורי ממותג. הלקוח רואה, מאשר / מבקש שינויים / דוחה — בטלפון' },
      { i:'💬', t:'Quick Feedback', d:'תיקונים מהירים בקליק: "קצר יותר", "יותר אישי", "CTA חד יותר"' },
    ],
  },
  {
    title: '🚀 Meta — פרסום ישיר',
    desc: 'מהאתר ישר ל-Facebook Ads Manager',
    items: [
      { i:'👥', t:'ניהול לקוחות Meta', d:'חיבור access token, בחירת דפים וחשבונות מודעות' },
      { i:'📤', t:'פרסום פוסטים', d:'פרסום ישיר לדף Facebook עם תצוגה מקדימה' },
      { i:'🚀', t:'בניית קמפיין מלא', d:'5 שלבים: מטרה → תקציב → קהל → קריאייטיב → פרסום. נשמר ב-PAUSED לבטיחות' },
      { i:'📊', t:'Pixel Builder', d:'יצירת קוד Pixel + tracking של events' },
    ],
  },
  {
    title: '📈 אנליטיקה ומחקר',
    desc: 'נתוני אמת מ-Meta + מחקר מתחרים',
    items: [
      { i:'📈', t:'Analytics Meta', d:'Impressions, Clicks, CTR, CPM, CPC, ROAS — בזמן אמת' },
      { i:'🔍', t:'מחקר מתחרים', d:'נתח מודעות של מתחרים, מצא pattern, צור וריאציות מותאמות' },
      { i:'📋', t:'דוחות', d:'דוחות PDF ללקוחות, עם White-Label' },
    ],
  },
  {
    title: '🏢 ניהול ושיתוף פעולה',
    desc: 'צוות + White-Label לסוכנויות',
    items: [
      { i:'👤', t:'ניהול צוות', d:'הוספת חברי צוות עם הרשאות (Admin / Agent / Viewer)' },
      { i:'🏢', t:'White-Label', d:'לוגו מותאם, צבעים מותאמים, דומיין מותאם (Agency)' },
      { i:'💎', t:'מערכת קרדיטים', d:'מעקב אחרי שימוש, היסטוריה, התראות על קרדיטים נמוכים' },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="px-4 py-16 max-w-6xl mx-auto">
      <div className="hero-mesh relative overflow-hidden -mx-4 px-4 py-12 mb-12 max-w-6xl">
        <div className="relative z-10 max-w-3xl">
          <div className="text-2xs font-bold tracking-kicker uppercase text-t3 mb-3">יכולות</div>
          <h1 className="font-serif text-white text-4xl md:text-6xl leading-tight tracking-tight">
            כל מה שמשווק מקצועי צריך
          </h1>
          <span className="rule-gold mt-5 block w-32" aria-hidden />
          <p className="text-t2 max-w-2xl mt-6 text-lg leading-relaxed">פלטפורמה אחת. עשרות יכולות. אינטגרציה ישירה עם Meta.</p>
        </div>
      </div>

      <div className="space-y-12">
        {CATEGORIES.map(c => (
          <section key={c.title}>
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white mb-1">{c.title}</h2>
              <p className="text-sm text-[#6B8FA8]">{c.desc}</p>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {c.items.map(it => (
                <div key={it.t} className="bg-[#152138] border border-[#243752] rounded-xl p-4 hover:border-[#324C6B] transition-all">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{it.i}</span>
                    <div>
                      <div className="font-bold text-sm text-[#D9E8F5] mb-1">{it.t}</div>
                      <div className="text-[12.5px] text-[#6B8FA8] leading-relaxed">{it.d}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="text-center mt-16">
        <Link href="/register"
          className="inline-block px-6 py-3 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-bold rounded-lg shadow-[0_4px_24px_rgba(10,122,255,0.35)] transition-all">
          התחל חינם — 150 קרדיטים מתנה
        </Link>
      </div>
    </div>
  );
}
