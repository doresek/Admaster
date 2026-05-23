'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const SECTIONS = [
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

export default function BriefFormPage() {
  const params = useSearchParams();
  const code   = params.get('code') ?? '';
  const [vals,  setVals]      = useState<Record<string, string>>({});
  const [step,  setStep]      = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done,  setDone]      = useState(false);
  const [error, setError]     = useState('');
  const [agencyName, setAgencyName] = useState('');

  useEffect(() => {
    if (!code) return;
    fetch(`/api/briefs/code-meta?code=${code}`)
      .then(r => r.json())
      .then(d => { if (d.agency_name) setAgencyName(d.agency_name); })
      .catch(() => {});
  }, [code]);

  const uv = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }));
  const cur = SECTIONS[step];
  const pct = Math.round((step / SECTIONS.length) * 100);

  async function submit() {
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/briefs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, values: vals }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!code) return (
    <div className="min-h-screen bg-[#070A0E] flex items-center justify-center p-4" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
      <div className="bg-[#0C1118] border border-[#2A4158] rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="text-4xl mb-4">🔗</div>
        <div className="text-white font-bold text-xl mb-2">הזן קוד בריף</div>
        <div className="text-[#6B8FA8] text-sm mb-6">הזן את הקוד שקיבלת מהסוכן שלך</div>
        <CodeEntry />
      </div>
    </div>
  );

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
          <div className="text-[#6B8FA8] text-sm leading-relaxed">מלא את השאלות כדי שנוכל לבנות עבורך אסטרטגיה שיווקית מדויקת</div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-1.5 rounded-full bg-[#1D2D3E] overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#0A7AFF] to-[#3D9FFF] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-[#6B8FA8] whitespace-nowrap">שלב {step+1}/{SECTIONS.length}</span>
        </div>

        {/* Section */}
        <div className="bg-[#0C1118] border border-[#1E2F42] rounded-xl p-6 mb-4">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-7 h-7 rounded-full bg-[#0A7AFF] text-white text-xs font-bold flex items-center justify-center">{step+1}</div>
            <div className="font-bold text-white">{cur.sec}</div>
          </div>

          {cur.qs.map(q => (
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
                  {'opts' in q && q.opts.map((o: string) => <option key={o} value={o} className="bg-[#162030]">{o}</option>)}
                </select>
              ) : (
                <input type="text" value={vals[q.id]||''} onChange={e=>uv(q.id,e.target.value)} placeholder={q.ph}
                  className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF] placeholder-[#2E4459]"
                  dir="rtl" />
              )}
            </div>
          ))}
        </div>

        {error && <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}

        <div className="flex gap-3">
          {step > 0 && (
            <button onClick={() => setStep(s=>s-1)}
              className="px-4 py-2.5 rounded-lg border border-[#1E2F42] bg-[#162030] text-[#6B8FA8] text-sm font-medium hover:border-[#2A4158] hover:text-white transition-colors">
              ← חזור
            </button>
          )}
          {step < SECTIONS.length-1 ? (
            <button onClick={() => setStep(s=>s+1)} style={{ flex: 1 }}
              className="py-2.5 rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold transition-colors">
              הבא — {SECTIONS[step+1]?.sec} →
            </button>
          ) : (
            <button onClick={submit} disabled={submitting} style={{ flex: 1 }}
              className="py-2.5 rounded-lg bg-[#059669] hover:brightness-110 text-white text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />שולח...</> : '📤 שלח בריף'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Code entry component
function CodeEntry() {
  const [code, setCode] = useState('');
  return (
    <div>
      <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())}
        placeholder="לדוגמה: AB3X7K"
        className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-center font-mono text-lg text-white outline-none focus:border-[#0A7AFF] mb-3"
        dir="ltr" maxLength={8} />
      <button
        onClick={() => { if (code.trim()) window.location.href = `/brief?code=${code.trim()}`; }}
        disabled={!code.trim()}
        className="w-full py-2.5 rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white font-semibold text-sm transition-colors disabled:opacity-50">
        פתח בריף →
      </button>
    </div>
  );
}
