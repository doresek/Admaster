import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'מדיניות פרטיות',
  description: 'מדיניות הפרטיות של AdMaster Pro — אילו נתונים אנחנו אוספים, למה, איך הם נשמרים ומהן הזכויות שלכם.',
};

const LAST_UPDATED = '6 ביולי 2026';
const CONTACT_EMAIL = 'elirankahalani27@gmail.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#111A24] border border-[#1E2F42] rounded-xl px-6 py-5">
      <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
      <div className="text-[13.5px] text-[#6B8FA8] leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="px-4 py-16 max-w-3xl mx-auto" dir="rtl">
      <div className="text-center mb-12">
        <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">Privacy Policy</div>
        <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'DM Serif Display,serif' }}>
          מדיניות פרטיות
        </h1>
        <p className="text-[#6B8FA8]">עדכון אחרון: {LAST_UPDATED}</p>
      </div>

      <div className="space-y-4">
        <Section title="מי אנחנו">
          <p>
            AdMaster Pro היא פלטפורמת שיווק מבוססת AI המסייעת לבעלי עסקים ומשווקים ליצור תוכן שיווקי,
            לנהל ולתזמן פוסטים וקמפיינים, ולעקוב אחרי ביצועים — כולל אינטגרציה ישירה עם Facebook ו-Instagram
            (פלטפורמות Meta). מסמך זה מסביר אילו נתונים אנחנו אוספים, למה, איך הם נשמרים, ומהן הזכויות שלכם.
          </p>
        </Section>

        <Section title="אילו נתונים אנחנו אוספים">
          <p>אנחנו אוספים שלושה סוגי מידע:</p>
          <ul className="list-disc pr-5 space-y-2">
            <li>
              <span className="text-[#D9E8F5] font-semibold">פרטי חשבון</span> — כתובת אימייל ושם, לצורך
              יצירת החשבון, התחברות ותקשורת איתכם.
            </li>
            <li>
              <span className="text-[#D9E8F5] font-semibold">נתוני העסק שאתם מזינים</span> — בריפים, פרטי
              לקוחות, תוכן שיווקי שנוצר או נערך בפלטפורמה, והגדרות קמפיינים.
            </li>
            <li>
              <span className="text-[#D9E8F5] font-semibold">נתונים מ-Meta (Facebook / Instagram)</span> — כאשר
              אתם מחברים את חשבון Meta שלכם, אנחנו ניגשים דרך ה-Graph API לרשימת הדפים שלכם, למדדי מעורבות
              (engagement) של הדפים, למטא-דאטה של חשבונות המודעות ולנתוני ביצועי מודעות; ואם אישרתם זאת
              במפורש — להרשאה לפרסם פוסטים בשמכם.
            </li>
          </ul>
        </Section>

        <Section title="למה אנחנו משתמשים בנתונים">
          <p>
            הנתונים משמשים אך ורק להפעלת השירות: יצירת תוכן שיווקי באמצעות AI, ניהול ותזמון פוסטים
            וקמפיינים בדפים ובחשבונות המודעות שחיברתם, והצגת אנליטיקות וביצועים בדשבורד שלכם.
            אנחנו לא משתמשים בנתונים שלכם למטרות אחרות.
          </p>
        </Section>

        <Section title="שימוש בנתוני פלטפורמת Meta">
          <p>
            נתונים המתקבלים מ-Meta (רשימת דפים, מדדי מעורבות, נתוני חשבונות מודעות וביצועי מודעות)
            משמשים אך ורק כדי לספק את השירות למשתמש שחיבר את החשבון. אנחנו לעולם לא מוכרים אותם
            ולא משתפים אותם עם צדדים שלישיים.
          </p>
          <p>
            בעת ניתוק החיבור ל-Facebook או מחיקת החשבון — הנתונים שמקורם ב-Meta נמחקים, וה-tokens
            מבוטלים, בהתאם ל-Meta Platform Terms.
          </p>
        </Section>

        <Section title="איך הנתונים נשמרים">
          <p>
            כל הנתונים נשמרים ב-Supabase (PostgreSQL) עם בקרת גישה ברמת שורה (Row Level Security) —
            כל משתמש רואה רק את הנתונים שלו. Access tokens של Meta נשמרים מוצפנים. אנחנו לא מוכרים
            את הנתונים שלכם לאף גורם, לעולם.
          </p>
        </Section>

        <Section title="ספקי משנה (צדדים שלישיים)">
          <p>כדי להפעיל את השירות אנחנו נעזרים בספקים הבאים:</p>
          <ul className="list-disc pr-5 space-y-2">
            <li><span className="text-[#D9E8F5] font-semibold">Meta Graph API</span> — חיבור ל-Facebook / Instagram, פרסום ונתוני ביצועים.</li>
            <li><span className="text-[#D9E8F5] font-semibold">Anthropic</span> — יצירת תוכן באמצעות מודלי AI.</li>
            <li><span className="text-[#D9E8F5] font-semibold">Supabase</span> — אחסון ומסד נתונים.</li>
            <li><span className="text-[#D9E8F5] font-semibold">Vercel</span> — אירוח האפליקציה.</li>
          </ul>
        </Section>

        <Section title="שמירת נתונים ומחיקה">
          <p>
            הנתונים נשמרים כל עוד החשבון שלכם פעיל. עם מחיקת החשבון — כל הנתונים נמחקים, כולל פרטי
            החשבון, נתוני הלקוחות והתוכן, וכל הנתונים שמקורם ב-Meta. להוראות מחיקה מפורטות ראו את עמוד{' '}
            <Link href="/data-deletion" className="text-[#3D9FFF] hover:underline">מחיקת נתונים</Link>.
          </p>
        </Section>

        <Section title="הזכויות שלכם">
          <p>
            אתם זכאים לעיין בנתונים שלכם, לתקן אותם ולבקש את מחיקתם בכל עת. לכל בקשה בנושא פרטיות
            פנו אלינו באימייל:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#3D9FFF] hover:underline" dir="ltr">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <Section title="עוגיות (Cookies)">
          <p>
            אנחנו משתמשים בעוגיות למטרות תפעוליות בלבד: שמירת ההתחברות שלכם (session authentication)
            ושמירת העדפות כמו שפת הממשק. אנחנו לא משתמשים בעוגיות פרסום או מעקב של צדדים שלישיים.
          </p>
        </Section>

        <Section title="עדכונים למדיניות">
          <p>
            ייתכן שנעדכן מדיניות זו מעת לעת. הגרסה העדכנית תמיד תפורסם בעמוד זה, עם תאריך העדכון
            האחרון בראש העמוד. עדכון אחרון: {LAST_UPDATED}.
          </p>
        </Section>

        <section className="bg-[#111A24] border border-[#1E2F42] rounded-xl px-6 py-5" dir="ltr">
          <h2 className="text-lg font-bold text-white mb-3">English Summary</h2>
          <p className="text-[13.5px] text-[#6B8FA8] leading-relaxed">
            AdMaster Pro is an AI marketing platform. We collect your account email and name, the business
            data you enter (briefs, clients, content), and — via the Facebook/Instagram integration — your
            page list, page engagement metrics, ad-account metadata and ad performance, plus (when granted)
            permission to publish posts on your behalf. This data is used solely to operate the service
            (content generation, post/campaign management, analytics), stored in Supabase with encrypted
            tokens, and never sold or shared. Third-party processors: Meta Graph API, Anthropic, Supabase,
            Vercel. Data obtained from Meta is used only to provide the service to the connected user and is
            deleted upon disconnect or account deletion, per the Meta Platform Terms. Data is retained until
            account deletion. For access, correction, or deletion requests, contact{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#3D9FFF] hover:underline">{CONTACT_EMAIL}</a>.
            Last updated: July 6, 2026.
          </p>
        </section>
      </div>
    </div>
  );
}
