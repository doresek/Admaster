'use client';
import { useState } from 'react';
import {
  GROUP_A_QUESTIONS,
  REQUIRED_OWNER_KEYS,
  UNSURE_SENTINEL,
  isUnsure,
  countSatisfiedRequired,
  allRequiredSatisfied,
} from '@/lib/brief-v2';

// Shared client-facing brief questionnaire. Used by BOTH:
//   * app/brief/page.tsx           — legacy ?code= flow (manual entry)
//   * app/brief/[token]/page.tsx   — magic-link /brief/<token> flow
// Keeping a single source for the form UI means the two entry points never
// drift. The only difference between them is `onSubmit` (code vs token), which
// the caller supplies.
//
// Brief v2 layout:
//   • Group A — "שאלות לבעל העסק" (owner language). 5 REQUIRED + 1 optional.
//     Each required question has a deliberately-clicked "לא בטוח / לא יודע"
//     escape that satisfies the requirement and stores the UNSURE_SENTINEL.
//   • Group B — the existing Hormozi×Schwartz "pro" questions, now OPTIONAL and
//     tucked inside a collapsible <details>. Every original question is kept.

// Group B — preserved verbatim from v1. Still optional; rendered collapsed.
export const SECTIONS = [
  { sec:'🏢 העסק', qs:[
    {id:'biz_name',   l:'שם העסק',                    t:'text', ph:'לדוגמה: אלירן קהלני תפילין'},
    {id:'biz_what',   l:'מה העסק עושה?',               t:'ta',   ph:'תאר את המוצר / שירות בפירוט...'},
    {id:'biz_result', l:'מה התוצאה שהלקוח מקבל?',    t:'ta',   ph:'מה הם ירגישו / יחוו / יקבלו?'},
    {id:'biz_time',   l:'תוך כמה זמן הלקוח רואה תוצאה?', t:'text', ph:'שבוע, חודש...'},
    {id:'biz_price',  l:'מחיר המוצר / שירות (₪)',     t:'text', ph:'997, 3500...'},
    {id:'biz_usp',    l:'מה מייחד אותך מהמתחרים?',   t:'ta',   ph:''},
  ]},
  { sec:'👤 הלקוח האידיאלי', qs:[
    {id:'cust_who',     l:'מי הלקוח האידיאלי?',         t:'ta',   ph:'גיל, מגדר, מצב משפחתי, מקצוע...'},
    {id:'cust_income',  l:'הכנסה חודשית משוערת',        t:'text', ph:'15,000 ₪/חודש'},
    {id:'pain_main',    l:'הכאב הגדול ביותר שחי איתו', t:'ta',   ph:'מה מציק לו ב-3 בלילה?'},
    {id:'pain_internal',l:'כאב פנימי (מה הוא מרגיש)',  t:'ta',   ph:"'אני לא מספיק טוב'..."},
    {id:'desire_dream', l:'חלום הלקוח',                 t:'ta',   ph:'לאן הוא רוצה להגיע?'},
  ]},
  { sec:'🚧 התנגדויות', qs:[
    {id:'obj_main',       l:'למה לא יקנה? (התנגדות ראשית)', t:'ta',  ph:'יקר, אין זמן, ניסיתי ולא עבד...'},
    {id:'obj_tried',      l:'מה כבר ניסה ולא עבד?',         t:'ta',  ph:''},
    {id:'obj_fear',       l:'ממה הוא הכי מפחד?',             t:'ta',  ph:'לבזבז כסף, להיכשל שוב...'},
    {id:'mkt_awareness',  l:'כמה הוא מודע לפתרון?',          t:'sel', opts:['לא מודע לבעיה','מודע לבעיה, לא מכיר פתרון','מכיר פתרונות, לא שמע עליי','שמע עליי, לא קנה','מוכן לקנות']},
  ]},
  { sec:'💎 ההצעה השיווקית', qs:[
    {id:'offer_anchor',   l:'מחיר עיגון (ערך אמיתי / מתחרה)', t:'text', ph:'10,000 ₪ / שווה הרבה יותר'},
    {id:'offer_price',    l:'המחיר שלך',                        t:'text', ph:'1,997 ₪'},
    {id:'offer_bonuses',  l:'בונוסים / תוספות',                 t:'ta',   ph:'מדריך PDF, שיחה אישית...'},
    {id:'offer_guarantee',l:'גרנטי / אחריות',                   t:'ta',   ph:'30 יום כסף בחזרה...'},
    {id:'offer_urgency',  l:'דחיפות / מחסור',                   t:'ta',   ph:'מקומות מוגבלים, מחיר עולה...'},
    {id:'offer_cta',      l:'קריאה לפעולה — מה הצעד הבא?',     t:'text', ph:'שלח WhatsApp, קבע שיחה...'},
  ]},
];

export interface BriefSubmitResult { ok: boolean; error?: string }

const REQUIRED_COUNT = REQUIRED_OWNER_KEYS.length;

export function BriefQuestionnaire({
  agencyName,
  onSubmit,
}: {
  agencyName?: string;
  onSubmit: (values: Record<string, string>) => Promise<BriefSubmitResult>;
}) {
  const [vals,  setVals]      = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done,  setDone]      = useState(false);
  const [error, setError]     = useState('');

  const uv = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }));

  // Deliberate "unsure" toggle: clicking it stores the sentinel (satisfies the
  // requirement); clicking again clears the answer back to empty.
  const toggleUnsure = (k: string) =>
    setVals(p => ({ ...p, [k]: isUnsure(p[k]) ? '' : UNSURE_SENTINEL }));

  const satisfied = countSatisfiedRequired(vals);
  const canSubmit = allRequiredSatisfied(vals);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true); setError('');
    try {
      const res = await onSubmit(vals);
      if (!res.ok) throw new Error(res.error || 'שגיאה');
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return (
    <div className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
      <div className="text-center text-white p-8">
        <div className="text-6xl mb-5">✅</div>
        <div className="text-2xl font-bold mb-2">הבריף נשלח בהצלחה!</div>
        <div className="text-[#6B8FA8] text-sm">תודה — הצוות יצור איתך קשר בקרוב</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#070A0E] py-8 px-4" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
      <div className="max-w-xl mx-auto">
        {/* Hero */}
        <div className="bg-gradient-to-br from-[#0C1118] to-[#1D2D3E] rounded-2xl p-8 text-center mb-6 border border-[#2A4158]">
          <div className="text-[#D4AF55] text-sm mb-3" style={{ fontStyle: 'italic' }}>{agencyName || 'AdMaster Pro'}</div>
          <div className="text-white font-bold text-2xl mb-2">שאלון בריף לקוח</div>
          <div className="text-[#6B8FA8] text-sm leading-relaxed">ענה על {REQUIRED_COUNT} שאלות קצרות בשפה שלך — וזה כל מה שאנחנו צריכים כדי להתחיל</div>
        </div>

        {/* ── Group A — שאלות לבעל העסק (REQUIRED) ── */}
        <div className="bg-[#0C1118] border border-[#1E2F42] rounded-xl p-6 mb-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="font-bold text-white text-lg">שאלות לבעל העסק</div>
            <span className="text-xs text-[#6B8FA8] whitespace-nowrap">ענית על {satisfied}/{REQUIRED_COUNT} שאלות חובה</span>
          </div>
          <div className="text-xs text-[#6B8FA8] mb-5 leading-relaxed">דבר בשפה שלך, כאילו אתה מספר לחבר. אין תשובות נכונות או שגויות.</div>

          {GROUP_A_QUESTIONS.map(q => {
            const unsure = isUnsure(vals[q.id]);
            return (
              <div key={q.id} className="mb-6">
                <label className="block text-sm font-semibold text-white mb-1">
                  {q.label}
                  {q.required
                    ? <span className="text-[#0A7AFF] mr-1">*</span>
                    : <span className="text-[#6B8FA8] text-xs font-normal mr-1">(אופציונלי)</span>}
                </label>
                <div className="text-xs text-[#6B8FA8] mb-2 leading-relaxed">{q.help}</div>
                <textarea
                  value={unsure ? '' : (vals[q.id] || '')}
                  onChange={e => uv(q.id, e.target.value)}
                  placeholder={unsure ? 'סימנת "לא בטוח" — נשלים את זה בשבילך' : 'כתוב כאן בחופשיות...'}
                  rows={4}
                  disabled={unsure}
                  className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] placeholder-[#2E4459] resize-y disabled:opacity-50"
                  dir="rtl" />
                {q.required && (
                  <button type="button" onClick={() => toggleUnsure(q.id)}
                    className={`mt-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      unsure
                        ? 'border-[#D4AF55]/50 bg-[#D4AF55]/10 text-[#D4AF55]'
                        : 'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158] hover:text-white'
                    }`}>
                    {unsure ? '✓ סימנת: לא בטוח / לא יודע' : 'לא בטוח / לא יודע'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Group B — שאלות מקצועיות (אופציונלי), collapsible ── */}
        <details className="bg-[#0C1118] border border-[#1E2F42] rounded-xl mb-4 group">
          <summary className="cursor-pointer select-none px-6 py-4 flex items-center justify-between text-white font-semibold list-none">
            <span>פתח שאלות מתקדמות <span className="text-[#6B8FA8] text-xs font-normal">(אופציונלי — למי שרוצה לדייק)</span></span>
            <span className="text-[#6B8FA8] text-sm transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="px-6 pb-6 pt-1 border-t border-[#1E2F42]">
            {SECTIONS.map(section => (
              <div key={section.sec} className="mb-5">
                <div className="font-bold text-white text-sm mb-3 mt-4">{section.sec}</div>
                {section.qs.map(q => (
                  <div key={q.id} className="mb-4">
                    <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">{q.l}</label>
                    {q.t === 'ta' ? (
                      <textarea value={vals[q.id]||''} onChange={e=>uv(q.id,e.target.value)} placeholder={q.ph} rows={3}
                        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] placeholder-[#2E4459] resize-y"
                        dir="rtl" />
                    ) : q.t === 'sel' ? (
                      <select value={vals[q.id]||''} onChange={e=>uv(q.id,e.target.value)}
                        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]"
                        dir="rtl">
                        <option value="">בחר...</option>
                        {'opts' in q && q.opts?.map((o: string) => <option key={o} value={o} className="bg-[#162030]">{o}</option>)}
                      </select>
                    ) : (
                      <input type="text" value={vals[q.id]||''} onChange={e=>uv(q.id,e.target.value)} placeholder={q.ph}
                        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] placeholder-[#2E4459]"
                        dir="rtl" />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>

        {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}

        <button onClick={submit} disabled={submitting || !canSubmit}
          className="w-full py-3 rounded-lg bg-[#059669] hover:brightness-110 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {submitting
            ? <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />שולח...</>
            : canSubmit ? '📤 שלח בריף' : `ענה על עוד ${REQUIRED_COUNT - satisfied} שאלות חובה`}
        </button>
      </div>
    </div>
  );
}
