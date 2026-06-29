// components/onboarding/FirstRunHero.tsx
// Post-signup first-run screen for a brand-new user (no clients yet).
// Anti-overwhelm: ONE primary call-to-action — "add your first client" —
// instead of the full feature dashboard. Secondary options stay collapsed.
// Server component: only Link navigation + native <details>, no client JS.
import Link from 'next/link';
import { MetaConnectGuide } from './MetaConnectGuide';

export function FirstRunHero({ name }: { name?: string | null }) {
  const greeting = name ? `שלום ${name} 👋` : 'ברוך הבא 👋';

  return (
    <div className="max-w-2xl mx-auto py-10" dir="rtl">
      <div className="text-center mb-8">
        <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">GETTING STARTED</div>
        <h1 className="text-3xl font-bold text-[#D9E8F5] mb-3">{greeting}</h1>
        <p className="text-[#8FA3B5] text-sm max-w-md mx-auto">
          כדי שה-AI יתחיל לעבוד בשבילך, צריך קודם להוסיף לקוח אחד.
          זה הצעד היחיד שצריך עכשיו — כל השאר ייפתח אחר כך.
        </p>
      </div>

      {/* PRIMARY call-to-action */}
      <div className="bg-[#111A24] border border-[#1E2F42] rounded-2xl p-7 text-center">
        <div className="text-4xl mb-4">🏢</div>
        <div className="font-semibold text-lg text-[#D9E8F5] mb-1">הלקוח הראשון שלך</div>
        <p className="text-[13px] text-[#6B8FA8] mb-6 max-w-sm mx-auto">
          מחברים עמוד פייסבוק וחשבון מודעות — חד-פעמי לכל לקוח. אחרי זה היצירה,
          ההשקה והניתוח עובדים אוטומטית.
        </p>
        <Link
          href="/clients"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all duration-200 px-5 py-3 text-[14px] bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white shadow-[0_4px_14px_rgba(10,122,255,0.3)]"
        >
          הוסף את הלקוח הראשון שלך
        </Link>
      </div>

      {/* SECONDARY — collapsed by default */}
      <div className="mt-6 space-y-3">
        <details className="group bg-[#0E151E] border border-[#1E2F42] rounded-xl">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] text-[#8FA3B5] hover:text-[#D9E8F5] flex items-center justify-between">
            <span>איך מחברים לקוח? (מדריך קצר)</span>
            <span className="text-[#2E4459] group-open:rotate-180 transition-transform">⌄</span>
          </summary>
          <div className="px-4 pb-4">
            <MetaConnectGuide />
          </div>
        </details>

        <div className="text-center">
          <Link href="/onboarding" className="text-[12px] text-[#6B8FA8] hover:text-[#3D9FFF] transition-colors">
            מעדיף הקמה מודרכת שלב-אחר-שלב? פתח את אשף ההתחלה →
          </Link>
        </div>
      </div>
    </div>
  );
}
