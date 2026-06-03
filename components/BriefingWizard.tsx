'use client';
// Shared 5-step briefing wizard rendered from BRIEFING_TEMPLATE.
// Used by the marketer page (/clients/[id]/briefing). The public fill page
// (/brief/[token]) keeps its own standalone copy with the centered shell, so
// this component focuses on the in-dashboard variant: it renders the steps,
// gates "next" via isStepComplete, and reports edits + step changes upward.
// Autosave is owned by the parent (debounced PUT), keeping this presentational.
import { useState } from 'react';
import { BRIEFING_TEMPLATE, briefCompletion, isStepComplete } from '@/lib/briefing-template';

export function BriefingWizard({
  values,
  onChange,
  onStepFlush,
}: {
  values: Record<string, string>;
  /** Called on every field edit with the next full values map. */
  onChange: (next: Record<string, string>) => void;
  /** Optional: called when the user moves between steps (flush autosave). */
  onStepFlush?: () => void;
}) {
  const [step, setStep] = useState(0);

  const total      = BRIEFING_TEMPLATE.length;
  const cur        = BRIEFING_TEMPLATE[step];
  const completion = briefCompletion(values);
  const canAdvance = isStepComplete(cur, values);

  const setField = (key: string, v: string) => onChange({ ...values, [key]: v });

  function next() {
    onStepFlush?.();
    setStep(s => Math.min(s + 1, total - 1));
  }
  function back() {
    onStepFlush?.();
    setStep(s => Math.max(s - 1, 0));
  }

  return (
    <div>
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
        {step < total - 1 && (
          <button
            onClick={next} disabled={!canAdvance} style={{ flex: 1 }}
            className="py-2.5 rounded-lg bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            הבא →
          </button>
        )}
        {step === total - 1 && (
          <div style={{ flex: 1 }} className="flex items-center justify-center text-xs text-[#34D399]">
            {completion >= 100 ? '✓ כל השדות החובה מולאו' : 'מלא את שדות החובה כדי להשלים'}
          </div>
        )}
      </div>
    </div>
  );
}
