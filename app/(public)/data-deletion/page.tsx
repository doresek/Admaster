import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'מחיקת נתונים',
  description: 'הוראות מחיקת נתונים ב-AdMaster Pro — ניתוק חיבור Facebook, מחיקת חשבון מלאה והסרת ההרשאות דרך Meta.',
};

const CONTACT_EMAIL = 'elirankahalani27@gmail.com';

function Step({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#111A24] border border-[#1E2F42] rounded-xl px-6 py-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#0A7AFF]/12 text-[#3D9FFF] font-bold text-sm shrink-0">
          {num}
        </span>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      <div className="text-[13.5px] text-[#6B8FA8] leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function DataDeletionPage() {
  return (
    <div className="px-4 py-16 max-w-3xl mx-auto" dir="rtl">
      <div className="text-center mb-12">
        <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">Data Deletion</div>
        <h1 className="text-4xl font-bold text-white mb-3" style={{ fontFamily: 'DM Serif Display,serif' }}>
          מחיקת נתונים
        </h1>
        <p className="text-[#6B8FA8]">
          איך למחוק את הנתונים שלכם מ-AdMaster Pro — כולל נתונים שמקורם ב-Facebook / Instagram
        </p>
      </div>

      <div className="space-y-4">
        <Step num="1" title="ניתוק חיבור Facebook מתוך האפליקציה">
          <p>
            היכנסו לאפליקציה, גשו אל <span className="text-[#D9E8F5] font-semibold">הגדרות / לקוחות</span>{' '}
            ולחצו על <span className="text-[#D9E8F5] font-semibold">ניתוק חיבור (Disconnect)</span> ליד חיבור
            ה-Facebook.
          </p>
          <p>
            הניתוק מבטל מיידית את ה-Access Tokens שלכם ומוחק את כל הנתונים שמקורם ב-Meta — רשימת דפים,
            מדדי מעורבות, נתוני חשבונות מודעות וביצועי מודעות. פרטי החשבון והתוכן שיצרתם בפלטפורמה
            נשארים זמינים.
          </p>
        </Step>

        <Step num="2" title="מחיקת חשבון מלאה">
          <p>
            כדי למחוק את החשבון כולו — שלחו אימייל לכתובת{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#3D9FFF] hover:underline" dir="ltr">{CONTACT_EMAIL}</a>{' '}
            עם הנושא <span className="text-[#D9E8F5] font-semibold">&quot;מחיקת חשבון&quot;</span>, מכתובת
            האימייל שאיתה נרשמתם.
          </p>
          <p>
            הבקשה תטופל בתוך <span className="text-[#D9E8F5] font-semibold">30 ימים</span> ותכלול מחיקה
            מלאה של כל נתוני החשבון: פרטי החשבון, נתוני הלקוחות והבריפים, כל התוכן שנוצר, וכל הנתונים
            שמקורם ב-Meta.
          </p>
        </Step>

        <Step num="3" title="הסרת האפליקציה דרך הגדרות Facebook">
          <p>
            לחלופין, תוכלו להסיר את ההרשאות שלנו ישירות מצד Facebook: היכנסו ל-
            <span className="text-[#D9E8F5] font-semibold" dir="ltr">Facebook Settings → Business Integrations</span>,
            אתרו את AdMaster Pro ולחצו על הסרה (Remove).
          </p>
          <p>
            פעולה זו מבטלת את הגישה שלנו לחשבון Meta שלכם. מומלץ בנוסף לבצע גם את שלב 1 או 2 כדי
            שנמחק את הנתונים שכבר נשמרו אצלנו.
          </p>
        </Step>

        <section className="bg-[#111A24] border border-[#1E2F42] rounded-xl px-6 py-5">
          <h2 className="text-lg font-bold text-white mb-3">שאלות?</h2>
          <p className="text-[13.5px] text-[#6B8FA8] leading-relaxed">
            לכל שאלה על פרטיות ומחיקת נתונים — כתבו לנו ל-
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#3D9FFF] hover:underline" dir="ltr">{CONTACT_EMAIL}</a>,
            או עיינו ב<Link href="/privacy" className="text-[#3D9FFF] hover:underline">מדיניות הפרטיות</Link> שלנו.
          </p>
        </section>

        <section className="bg-[#111A24] border border-[#1E2F42] rounded-xl px-6 py-5" dir="ltr">
          <h2 className="text-lg font-bold text-white mb-3">English Summary</h2>
          <p className="text-[13.5px] text-[#6B8FA8] leading-relaxed">
            To delete your data from AdMaster Pro: (1) Disconnect Facebook inside the app (Settings/Clients
            → Disconnect) — this revokes our tokens and deletes all Meta-derived data; (2) For full account
            deletion, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#3D9FFF] hover:underline">{CONTACT_EMAIL}</a>{' '}
            with the subject &quot;מחיקת חשבון&quot; (Account Deletion) — requests are processed within 30
            days and remove all account, client, and Meta-derived data; (3) Alternatively, remove the app in
            Facebook Settings → Business Integrations, which revokes our access to your Meta account.
          </p>
        </section>
      </div>
    </div>
  );
}
