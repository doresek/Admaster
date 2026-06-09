'use client';
// components/cockpit/CockpitBoard.tsx
// The beginner cockpit: funnel stepper, next-best-action, the "do it for me"
// autopilot button (with live polling), and the approval gate.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardLabel, Btn, Alert, Spinner } from '@/components/ui';
import { RecommendationsWidget } from '@/components/RecommendationsWidget';
import { JourneyStepper } from './JourneyStepper';
import { AutopilotPanel } from './AutopilotPanel';
import { NEXT_ACTION_HE, type Journey, type JourneyState } from '@/lib/journey';

interface Props {
  initialJourney: Journey | null;
  clientId: string | null;
  clientName: string | null;
}

export function CockpitBoard({ initialJourney, clientId, clientName }: Props) {
  const [journey, setJourney] = useState<Journey | null>(initialJourney);
  const [run, setRun] = useState<any>(null);
  const [canResume, setCanResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [approveToken, setApproveToken] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const state: JourneyState = journey?.state ?? (clientId ? 'needs_brief' : 'needs_client');
  const next = NEXT_ACTION_HE[state];

  const refresh = useCallback(async () => {
    const qs = new URLSearchParams();
    if (clientId) qs.set('clientId', clientId);
    const res = await fetch(`/api/autopilot/status?${qs.toString()}`);
    if (!res.ok) return;
    const j = await res.json();
    if (j.journey) setJourney(j.journey);
    setRun(j.run);
    setCanResume(!!j.canResume);
    // stop polling when the run reaches a terminal/gate state
    if (j.run && ['done', 'failed', 'awaiting_approval'].includes(j.run.status) && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [clientId]);

  useEffect(() => {
    refresh();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(refresh, 2500);
  };

  const runAutopilot = async () => {
    setBusy(true); setErr(null); setApproveToken(null);
    try {
      const res = await fetch('/api/autopilot/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'שגיאה'); return; }
      setRun({ id: j.runId, status: j.status, steps: j.steps });
      if (j.acc?.token) setApproveToken(j.acc.token);
      await refresh();
      if (j.status === 'running') startPolling();
    } catch (e: any) {
      setErr(e?.message ?? 'שגיאה');
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!run?.id) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/autopilot/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: run.id }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'לא ניתן להמשיך'); return; }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const approveUrl = approveToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/approve/${approveToken}` : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" dir="rtl">
      {/* main column */}
      <div className="lg:col-span-2 flex flex-col gap-5">
        <Card>
          <div className="flex items-center justify-between mb-4">
            <CardLabel>{clientName ? `מסע: ${clientName}` : 'המסע שלך'}</CardLabel>
            <span className="text-xs text-[#5A6B7C]">{next.hint}</span>
          </div>
          <JourneyStepper state={state} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardLabel>הפעולה הבאה</CardLabel>
              <p className="text-lg text-[#D9E8F5] mt-1">{next.label}</p>
              <p className="text-sm text-[#8FA3B5]">{next.hint}</p>
            </div>
            <Btn onClick={runAutopilot} loading={busy} disabled={!clientId}>
              ✨ עשה זאת בשבילי
            </Btn>
          </div>
          {!clientId && (
            <Alert type="amber" className="mt-3">בחר/חבר לקוח בסרגל העליון כדי להפעיל אוטופיילוט.</Alert>
          )}
          {err && <Alert type="red" className="mt-3">{err}</Alert>}
        </Card>

        {run && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardLabel>אוטופיילוט</CardLabel>
              <span className="text-xs text-[#5A6B7C] flex items-center gap-1">
                {run.status === 'running' && <Spinner size={12} />}
                {run.status}
              </span>
            </div>
            <AutopilotPanel steps={run.steps ?? []} />

            {run.status === 'awaiting_approval' && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm text-amber-300 mb-2">⏸ ממתין לאישור הלקוח לפני השקה.</p>
                {approveUrl && (
                  <div className="flex items-center gap-2 mb-2">
                    <input readOnly value={approveUrl}
                      className="flex-1 bg-[#0A0F16] border border-[#1E2F42] rounded px-2 py-1 text-xs text-[#8FA3B5]" />
                    <Btn size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(approveUrl)}>העתק</Btn>
                  </div>
                )}
                <Btn size="sm" onClick={resume} loading={busy} disabled={!canResume}>
                  {canResume ? 'המשך להשקה' : 'ממתין לאישור…'}
                </Btn>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* side column */}
      <div className="flex flex-col gap-5">
        <RecommendationsWidget />
      </div>
    </div>
  );
}
