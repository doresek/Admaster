// components/cockpit/JourneyStepper.tsx
// Presentational funnel stepper. Maps the detailed journey state to 5 visible
// milestones. No hooks / no server-only APIs — safe to render anywhere.
import type { JourneyState } from '@/lib/journey';

const MILESTONES: { key: JourneyState; label: string; icon: string; states: JourneyState[] }[] = [
  { key: 'needs_brief',       label: 'בריף',   icon: '📝', states: ['needs_client', 'needs_brief', 'brief_in'] },
  { key: 'generating',        label: 'יצירה',  icon: '✨', states: ['generating', 'scoring'] },
  { key: 'awaiting_approval', label: 'אישור',  icon: '✅', states: ['awaiting_approval', 'ready_to_launch'] },
  { key: 'live',              label: 'באוויר', icon: '🚀', states: ['live'] },
  { key: 'optimizing',        label: 'שיפור',  icon: '📈', states: ['analyzing', 'optimizing'] },
];

function currentMilestone(state: JourneyState): number {
  const i = MILESTONES.findIndex((m) => m.states.includes(state));
  return i < 0 ? 0 : i;
}

export function JourneyStepper({ state }: { state: JourneyState }) {
  const cur = currentMilestone(state);
  const attention = state === 'needs_attention';

  return (
    <div className="flex items-center gap-1 w-full" dir="rtl">
      {MILESTONES.map((m, i) => {
        const done = i < cur;
        const active = i === cur && !attention;
        return (
          <div key={m.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  'w-10 h-10 rounded-full flex items-center justify-center text-lg border transition',
                  active ? 'bg-[#0A7AFF] border-[#0A7AFF] text-white shadow-[0_0_16px_rgba(10,122,255,0.5)]'
                  : done ? 'bg-[#0A7AFF]/15 border-[#0A7AFF]/40 text-[#3D9FFF]'
                  : 'bg-[#111A24] border-[#1E2F42] text-[#5A6B7C]',
                ].join(' ')}
              >
                {done ? '✓' : m.icon}
              </div>
              <span className={`text-[11px] ${active ? 'text-[#D9E8F5]' : 'text-[#5A6B7C]'}`}>{m.label}</span>
            </div>
            {i < MILESTONES.length - 1 && (
              <div className={`h-[2px] flex-1 mx-1 rounded ${i < cur ? 'bg-[#0A7AFF]/40' : 'bg-[#1E2F42]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
