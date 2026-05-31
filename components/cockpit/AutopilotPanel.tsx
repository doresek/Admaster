// components/cockpit/AutopilotPanel.tsx
// Shows the live autopilot run: per-step status + the judge verdict.
import { DIMENSION_LABEL_HE, type JudgeDimension, type JudgeVerdict } from '@/lib/judge/types';

const STEP_LABEL_HE: Record<string, string> = {
  generate: 'יצירת מודעות',
  score: 'ניקוד',
  judge: 'בקרת איכות (Judge)',
  approval: 'שליחה לאישור',
  targeting: 'טרגוט',
  launch: 'השקה',
  insights: 'ניתוח',
  recommend: 'המלצות',
};

const STATUS_ICON: Record<string, string> = {
  pending: '○', running: '⏳', ok: '✓', gate: '⏸', error: '✕', skipped: '–',
};

interface RunStep { name: string; status: string; error?: string; data?: any }

export function AutopilotPanel({ steps }: { steps: RunStep[] }) {
  // surface a judge verdict if any step carries one
  const verdict: JudgeVerdict | null =
    steps.map((s) => s.data?.judge).find((j) => j && j.scores) ?? null;

  return (
    <div className="flex flex-col gap-3" dir="rtl">
      <div className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-sm">
            <span className={[
              'w-5 text-center',
              s.status === 'ok' ? 'text-emerald-400'
              : s.status === 'error' ? 'text-red-400'
              : s.status === 'running' ? 'text-[#3D9FFF]'
              : s.status === 'gate' ? 'text-amber-400'
              : 'text-[#5A6B7C]',
            ].join(' ')}>{STATUS_ICON[s.status] ?? '○'}</span>
            <span className={s.status === 'pending' ? 'text-[#5A6B7C]' : 'text-[#D9E8F5]'}>
              {STEP_LABEL_HE[s.name] ?? s.name}
            </span>
            {s.error && <span className="text-red-400/80 text-xs">— {s.error}</span>}
          </div>
        ))}
      </div>

      {verdict && (
        <div className="rounded-lg border border-[#1E2F42] bg-[#0C1A28] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#5A6B7C]">בקרת איכות AI</span>
            <span className={[
              'text-xs px-2 py-0.5 rounded-full',
              verdict.verdict === 'approve' ? 'bg-emerald-500/15 text-emerald-400'
              : verdict.verdict === 'reject' ? 'bg-red-500/15 text-red-400'
              : 'bg-amber-500/15 text-amber-400',
            ].join(' ')}>
              {verdict.verdict === 'approve' ? 'אושר' : verdict.verdict === 'reject' ? 'נדחה' : 'לשיפור'} · {verdict.overall}/100
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            {(Object.keys(verdict.scores) as JudgeDimension[]).map((d) => (
              <div key={d} className="flex items-center justify-between text-xs">
                <span className="text-[#8FA3B5]">{DIMENSION_LABEL_HE[d]}</span>
                <span className="text-[#D9E8F5]">{verdict.scores[d]}</span>
              </div>
            ))}
          </div>
          {verdict.rationale && <p className="text-xs text-[#8FA3B5] leading-relaxed">{verdict.rationale}</p>}
          {verdict.flags?.length > 0 && (
            <ul className="mt-2 list-disc pr-4 text-xs text-amber-400/90 space-y-0.5">
              {verdict.flags.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
