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

  // Drive the build, then poll for the first atoms and reveal the wall.
  //
  // The brief-submit handler fires the orchestrator via `waitUntil` (fire-and-forget),
  // which a serverless freeze/recycle can cut short — leaving the brain stuck here
  // forever with no retry. So we actively TRIGGER the deterministic, blocking,
  // idempotent build endpoint (`/api/client-core/run`, which resolves the client's
  // latest brief) on mount, and re-trigger if it stays stuck. The orchestrator's
  // per-client build-claim + idempotency guard make repeated/concurrent triggers safe;
  // a capped trigger count bounds credit use.
  useEffect(() => {
    let stopped = false;
    let triggers = 0;
    let polls = 0;

    const trigger = () => {
      if (stopped || triggers >= 3) return;
      triggers += 1;
      fetch('/api/client-core/run', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ clientId }),
      }).catch(() => { /* the poll loop is the source of truth */ });
    };

    trigger(); // kick a deterministic build immediately (covers a frozen waitUntil)

    const tick = async () => {
      polls += 1;
      try {
        const res = await fetch(`/api/intelligence/insights?clientId=${clientId}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          const ready = (Array.isArray(json?.insights) && json.insights.length > 0) || !!json?.coreGeneratedAt;
          if (ready && !stopped) { router.refresh(); return; }
        }
      } catch { /* transient — keep polling */ }
      if (polls % 8 === 0) trigger(); // still stuck after ~40s → retry the build
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
