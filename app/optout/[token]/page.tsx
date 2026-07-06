'use client';
// app/optout/[token]/page.tsx — PUBLIC one-click opt-out page (CP-6b T6).
//
// End-customer facing: no auth, no dashboard shell (mirrors /approve/[token]).
// On load it calls POST /api/retention/optout with the token — the RPC is
// idempotent (tombstone is first-write-wins), so a refresh/re-visit is safe
// and still shows success. Calm, minimal, Hebrew RTL.

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';

type State = 'working' | 'done' | 'invalid' | 'error';

export default function OptOutPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>('working');
  const fired = useRef(false);

  useEffect(() => {
    if (!token || fired.current) return;
    fired.current = true;                       // one call per mount (RPC is idempotent anyway)
    (async () => {
      try {
        const res = await fetch('/api/retention/optout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (res.ok) setState('done');
        else if (res.status === 404) setState('invalid');
        else setState('error');
      } catch {
        setState('error');
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <h1 className="text-lg font-bold text-slate-800 mb-6">הסרה מרשימת התפוצה</h1>

          {state === 'working' && (
            <div className="py-6 flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mb-4" />
              <div className="text-sm text-slate-500">מסירים אותך מהרשימה…</div>
            </div>
          )}

          {state === 'done' && (
            <div className="py-4">
              <div className="text-5xl mb-4">✅</div>
              <div className="text-slate-800 font-semibold mb-2">
                הוסרת מהרשימה — לא תקבל מאיתנו עוד הודעות
              </div>
              <div className="text-sm text-slate-500">
                ההסרה נכנסת לתוקף מיידית וחלה על כל הערוצים (וואטסאפ, אימייל ו-SMS).
              </div>
            </div>
          )}

          {state === 'invalid' && (
            <div className="py-4">
              <div className="text-5xl mb-4">😕</div>
              <div className="text-slate-800 font-semibold mb-2">הקישור לא נמצא</div>
              <div className="text-sm text-slate-500">
                ייתכן שהקישור שגוי או חלקי. אפשר גם להשיב "הסר" להודעה שקיבלת.
              </div>
            </div>
          )}

          {state === 'error' && (
            <div className="py-4">
              <div className="text-5xl mb-4">⚠️</div>
              <div className="text-slate-800 font-semibold mb-2">משהו השתבש</div>
              <div className="text-sm text-slate-500">
                לא הצלחנו להשלים את ההסרה כרגע. נסה לרענן את העמוד בעוד רגע.
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-xs text-slate-400 mt-6">
          הקישור אישי ומאובטח · ההסרה אינה דורשת התחברות
        </div>
      </div>
    </div>
  );
}
