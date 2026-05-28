'use client';
import { clsx } from 'clsx';
import type { ScoreResult } from '@/lib/scoring';

interface Props {
  result: ScoreResult;
  onClose?: () => void;
}

const AGE_BUCKETS = ['18-24','25-34','35-44','45-54','55+'] as const;

const EMOTION_LABELS_HE: Record<string, string> = {
  urgency:      'דחיפות',
  social_proof: 'הוכחה חברתית',
  authority:    'סמכות',
  curiosity:    'סקרנות',
  fear:         'פחד',
  trust:        'אמון',
  greed:        'הזדמנות',
  pride:        'גאווה',
  belonging:    'שייכות',
};
const HOOK_LABELS_HE: Record<string, string> = {
  question: 'שאלה', callout: 'פנייה ישירה', contrarian: 'נגד הזרם',
  stat: 'סטטיסטיקה', story: 'סיפור', curiosity: 'סקרנות',
  urgency: 'דחיפות', social_proof: 'הוכחה חברתית', other: 'אחר',
};

function HistogramBar({ label, fraction }: { label: string; fraction: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 text-right text-[#6B8FA8]">{label}</span>
      <div className="flex-1 h-2 bg-[#162030] rounded overflow-hidden">
        <div className="h-full bg-[#0A7AFF]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-[#6B8FA8] tabular-nums">{pct}%</span>
    </div>
  );
}

export function ScorePanel({ result, onClose }: Props) {
  const bandColor = result.band === 'high' ? 'text-emerald-300'
                  : result.band === 'mid'  ? 'text-amber-300'
                  : 'text-red-300';
  return (
    <div className="bg-[#0E1620] border border-[#1E2F42] rounded-xl p-4 shadow-2xl max-w-md w-full" dir="rtl">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className={clsx('text-4xl font-black leading-none', bandColor)}>{result.score}<span className="text-base opacity-50">/100</span></div>
          <div className="text-[10px] uppercase tracking-widest text-[#6B8FA8] mt-1">חיזוי ביצועים</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-[#6B8FA8] hover:text-white text-lg leading-none">×</button>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-3 mb-2">קהל פוטנציאלי — גיל</div>
      <div className="space-y-1.5">
        {AGE_BUCKETS.map(b => (
          <HistogramBar key={b} label={b} fraction={Number(result.demographics.age?.[b] ?? 0)} />
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">מין</div>
      <div className="space-y-1.5">
        <HistogramBar label="גברים"  fraction={result.demographics.gender?.m ?? 0.5} />
        <HistogramBar label="נשים"   fraction={result.demographics.gender?.f ?? 0.5} />
      </div>

      {result.emotions.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">רגשות מובילים</div>
          <div className="flex flex-wrap gap-1.5">
            {result.emotions.map(e => (
              <span key={e} className="px-2 py-0.5 rounded-full bg-[#162030] border border-[#1E2F42] text-[11px] text-[#D9E8F5]">
                {EMOTION_LABELS_HE[e] ?? e}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">קונספט הפתיחה</div>
      <div className="text-xs text-[#D9E8F5]">{HOOK_LABELS_HE[result.predicted_hook] ?? result.predicted_hook}</div>

      {(result.extracts.benefits.length + result.extracts.ctas.length) > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">תוכן שזוהה</div>
          <ul className="text-[11px] text-[#D9E8F5] space-y-0.5">
            {result.extracts.benefits.map((b, i) => <li key={`b${i}`}>✓ <span className="text-[#6B8FA8]">תועלת:</span> {b}</li>)}
            {result.extracts.ctas.map((c, i)     => <li key={`c${i}`}>→ <span className="text-[#6B8FA8]">CTA:</span> {c}</li>)}
            {result.extracts.pains.map((p, i)    => <li key={`p${i}`}>! <span className="text-[#6B8FA8]">כאב:</span> {p}</li>)}
          </ul>
        </>
      )}

      {result.policy_flags.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">בדיקת מדיניות</div>
          <ul className="text-[11px] space-y-1">
            {result.policy_flags.map((f, i) => (
              <li key={i} className={clsx(
                f.severity === 'block' ? 'text-red-300'
              : f.severity === 'warn'  ? 'text-amber-300'
              :                          'text-[#6B8FA8]'
              )}>
                {f.severity === 'block' ? '⛔' : f.severity === 'warn' ? '⚠️' : 'ℹ️'} {f.issue}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
