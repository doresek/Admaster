'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Build-in-progress reveal: shown while the brain hasn't produced any atoms yet.
// A 3-step ticker animates the pipeline (read brief → extract insights →
// synthesize strategy) and the component polls the read endpoint every ~5s.
// Once insights appear it refreshes the route so the server re-renders the wall.
const STEPS = [
  'קוראת את הבריף',
  'מחלצת תובנות',
  'מסנתזת אסטרטגיה',
];

const POLL_MS = 5000;

export function BuildingBrain({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Animate the ticker.
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1600);
    return () => clearInterval(t);
  }, []);

  // Poll for the first atoms, then reveal the wall via a route refresh.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/intelligence/insights?clientId=${clientId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const ready = (Array.isArray(json?.insights) && json.insights.length > 0) || !!json?.coreGeneratedAt;
        if (ready && !stopped) router.refresh();
      } catch { /* transient — keep polling */ }
    };
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [clientId, router]);

  return (
    <div dir="rtl" className="rounded-2xl bg-[#111A24] border border-[#1E2F42] p-8 text-center">
      <div className="text-4xl mb-3 animate-pulse">🧠</div>
      <div className="text-lg font-bold text-[#D9E8F5] mb-1">המערכת לומדת את הלקוח…</div>
      <div className="text-xs text-[#6B8FA8] mb-6">זה ייקח רגע. הדף יתעדכן אוטומטית כשהתובנות הראשונות יהיו מוכנות.</div>

      <div className="flex flex-col items-stretch gap-2 max-w-sm mx-auto">
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <div
              key={label}
              className={[
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px] transition-all duration-300',
                active
                  ? 'border-[#0A7AFF] bg-[#0A7AFF]/10 text-[#7AC0FF]'
                  : done
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300/80'
                  : 'border-[#1E2F42] text-[#6B8FA8]',
              ].join(' ')}
            >
              <span>{done ? '✓' : active ? '◐' : '○'}</span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>

      <Link href={`/send-brief?client=${clientId}`} className="inline-block mt-6 text-[#7AC0FF] text-xs hover:underline">
        עדכון או שליחת בריף נוסף
      </Link>
    </div>
  );
}
