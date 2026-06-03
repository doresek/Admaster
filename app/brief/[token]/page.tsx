'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { BRIEFING_TEMPLATE, briefCompletion, isStepComplete } from '@/lib/briefing-template';

export default function PublicBriefPage({ params }: { params: { token: string } }) {
  const { token } = params;

  const [values, setValues] = useState<Record<string, string>>({});
  const [step,   setStep]   = useState(0);
  const [saved,  setSaved]  = useState(false);   // "נשמר אוטומטית ✓"
  const [done,   setDone]   = useState(false);   // success state after סיום
  const [error,  setError]  = useState('');
  const [submitting, setSubmitting] = useState(false);

  const total      = BRIEFING_TEMPLATE.length;
  const cur         = BRIEFING_TEMPLATE[step];
  const completion = briefCompletion(values);
  const canAdvance = isStepComplete(cur, values);

  // ── Autosave (POST { token, values }) ─────────────────────────
  const save = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/briefs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, values }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'שגיאה בשמירה'); return false; }
      setError('');
      setSaved(true);
      return true;
    } catch {
      setError('שגיאה בשמירה — בדוק את החיבור לאינטרנט');
      return false;
    }
  }, [token, values]);

  // Debounced autosave on edit (~800ms).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef    = useRef(false);
  useEffect(() => {
    if (!dirtyRef.current) return; // skip the initial mount
    setSaved(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void save(); }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const setField = (key: string, v: string) => {
    dirtyRef.current = true;
    setValues(p => ({ ...p, [key]: v }));
  };

  async function next() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dirtyRef.current) await save();   // flush on step change
    setStep(s => Math.min(s + 1, total - 1));
  }
  function back() { setStep(s => Math.max(s - 1, 0)); }

  async function finish() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSubmitting(true);
    const ok = await save();
    setSubmitting(false);
    if (ok) setDone(true);
  }

  // ── Success state ─────────────────────────────────────────────
  if (done) return (
    <Shell>
      <div className="text-center py-10">
        <div className="text-6xl mb-5">✅</div>
        <div className="text-2xl font-bold text-[#D9E8F5] mb-2">תודה! הפרטים נשמרו</div>
        <div className="text-[#6B8FA8] text-sm">קיבלנו את הבריף שלך — נחזור אליך בהקדם.</div>
      </div>
    </Shell>
  );

  return (
    <Shell>
      {/* Progress */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-1.5 rounded-full bg-[#152138] overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#0A7AFF] to-[#3D9FFF] rounded-full transition-all duration-500"
            style={{ width: `${completion}%` }}
          />
        </div>
        <span className="text-xs text-[#6B8FA8] whitespace-nowrap">{completion}% הושלם</span>
      </div>
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs text-[#6B8FA8]">שלב {step + 1} מתוך {total}</span>
        {saved && <span className="text-xs text-[#34D399]">נשמר אוטומטית ✓</span>}
      </div>

      {/* Step card */}
      <div className="bg-[#152138] border border-[#1E2F42] rounded-xl p-6 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-[#0A7AFF] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            {step + 1}
          </div>
          <div className="font-bold text-[#D9E8F5]">{cur.title}</div>
        </div>
        {cur.intro && <p className="text-[#6B8FA8] text-xs mb-4 leading-relaxed">{cur.intro}</p>}
        <div className="mt-4">
          {cur.fields.map(f => (
            <div key={f.key} className="mb-4">
              <label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">
                {f.label}{f.required && <span className="text-[#0A7AFF]"> *</span>}
              </label>
              {f.type === 'textarea' ? (
                <textarea
                  value={values[f.key] || ''} onChange={e => setField(f.key, e.target.value)}
                  placeholder={f.placeholder} rows={3} dir="rtl"
                  className="w-full bg-[#0B1424] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] placeholder-[#2E4459] resize-y transition-colors"
                />
              ) : f.type === 'select' ? (
                <select
                  value={values[f.key] || ''} onChange={e => setField(f.key, e.target.value)} dir="rtl"
                  className="w-full bg-[#0B1424] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] transition-colors"
                >
                  <option value="">בחר...</option>
                  {f.options?.map(o => <option key={o} value={o} className="bg-[#0B1424]">{o}</option>)}
                </select>
              ) : (
                <input
                  type="text" value={values[f.key] || ''} onChange={e => setField(f.key, e.target.value)}
                  placeholder={f.placeholder} dir="rtl"
                  className="w-full bg-[#0B1424] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#0A7AFF] placeholder-[#2E4459] transition-colors"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-3">
        {step > 0 && (
          <button
            onClick={back}
            className="px-4 py-2.5 rounded-lg border border-[#1E2F42] bg-[#152138] text-[#6B8FA8] text-sm font-medium hover:border-[#2A4158] hover:text-[#D9E8F5] transition-colors"
          >
            → חזור
          </button>
        )}
        {step < total - 1 ? (
          <button
            onClick={next} disabled={!canAdvance} style={{ flex: 1 }}
            className="py-2.5 rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            הבא →
          </button>
        ) : (
          <button
            onClick={finish} disabled={!canAdvance || submitting} style={{ flex: 1 }}
            className="py-2.5 rounded-lg bg-[#059669] hover:brightness-110 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting
              ? <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />שומר...</>
              : '✓ סיום'}
          </button>
        )}
      </div>
    </Shell>
  );
}

// Clean, centered public shell (no dashboard chrome).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#0B1424] py-8 px-4" dir="rtl"
      style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}
    >
      <div className="max-w-xl mx-auto">
        <div className="bg-gradient-to-br from-[#0B1424] to-[#152138] rounded-2xl p-8 text-center mb-6 border border-[#1E2F42]">
          <div className="text-white font-bold text-2xl mb-2">טופס בריפינג</div>
          <div className="text-[#6B8FA8] text-sm leading-relaxed">
            מלא את הפרטים כדי שנוכל לבנות עבורך אסטרטגיה שיווקית מדויקת
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
