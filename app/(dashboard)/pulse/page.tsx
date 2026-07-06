'use client';
// app/(dashboard)/pulse — THE SINGLE-CLIENT "PULSE" DASHBOARD (D-1, §1).
//
// One screen, one story: the narration block first (leap 1), ≤4 owner tiles
// with delta + comparison + honesty label (leap 4), tap-anything → "למה?"
// (leap 3), the pending strip LINKING to the approvals surface (leap 6).
// Marketer mode (toggle, persisted in localStorage) opens the full 12-metric
// grid with null-reasons, the reconciliation honesty panel and links to the
// deeper surfaces. READ-ONLY — this dashboard writes nothing.

import { useCallback, useEffect, useState } from 'react';
import { Chip, PageHeader } from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';
import type { MetricKey } from '@/lib/metrics-layer';
import type { PulseMode, PulsePayload } from '@/app/api/pulse/shared';
import {
  isPulsePayload,
  PULSE_MODE_STORAGE_KEY,
  readStoredMode,
  selectOwnerTiles,
  whyFor,
} from './helpers';
import {
  MarketerLinks,
  MetricTile,
  PendingStrip,
  ReconciliationPanel,
  StoryBlock,
  WhyPopover,
} from './components';

const PERIOD_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '7d',  label: '7 ימים' },
  { id: '30d', label: '30 יום' },
  { id: '90d', label: '90 יום' },
];

function usePulse(clientId: string | null, period: string, mode: PulseMode) {
  const [data, setData] = useState<PulsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (clientId === null) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(
        `/api/pulse?clientId=${clientId}&period=${period}&mode=${mode}`,
        { cache: 'no-store' },
      );
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body !== null && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : 'שגיאה בטעינת הדשבורד';
        throw new Error(msg);
      }
      if (!isPulsePayload(body)) {
        throw new Error('תשובת השרת לא בפורמט צפוי — נסה לרענן');
      }
      setData(body);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'שגיאה בטעינת הדשבורד');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, period, mode]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, err, reload: load };
}

export default function PulsePage() {
  const { activeClient, activeClientId } = useActiveClient();
  const [mode, setMode] = useState<PulseMode>('owner');
  const [period, setPeriod] = useState('30d');
  const [openWhy, setOpenWhy] = useState<MetricKey | null>(null);

  // Hydrate the persisted mode once, client-side only.
  useEffect(() => {
    setMode(readStoredMode(typeof window !== 'undefined' ? window.localStorage : null));
  }, []);

  const switchMode = (next: PulseMode) => {
    setMode(next);
    setOpenWhy(null);
    try {
      window.localStorage.setItem(PULSE_MODE_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (privacy mode) — the toggle still works this visit.
    }
  };

  const { data, loading, err, reload } = usePulse(activeClientId, period, mode);

  const metrics = data?.metrics ?? [];
  const tiles = mode === 'owner' ? selectOwnerTiles(metrics) : metrics;
  const openMetric = openWhy !== null ? metrics.find((m) => m.key === openWhy) ?? null : null;
  const reconciliation = metrics.find((m) => m.key === 'reconciliation_ratio') ?? null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="דופק"
        title="הדופק של העסק"
        sub={activeClient !== null
          ? `מה קורה אצל ${activeClient.emoji} ${activeClient.name} — במשפט אחד, עם ה"למה" מאחורי כל מספר`
          : 'בחר לקוח כדי לראות את הדופק שלו'}
        right={
          <div className="flex items-center gap-1.5">
            <Chip label="בעל העסק" active={mode === 'owner'} onClick={() => switchMode('owner')} />
            <Chip label="משווק" active={mode === 'marketer'} onClick={() => switchMode('marketer')} />
          </div>
        }
      />

      <div className="flex items-center gap-1.5 mb-4">
        {PERIOD_OPTIONS.map((p) => (
          <Chip key={p.id} label={p.label} active={period === p.id} onClick={() => setPeriod(p.id)} />
        ))}
      </div>

      {activeClientId === null && (
        <div className="text-center py-16">
          <div className="text-3xl mb-3">🫀</div>
          <div className="text-[#D9E8F5] font-bold mb-1">אין לקוח פעיל</div>
          <div className="text-[#6B8FA8] text-sm">בחר לקוח בסרגל העליון כדי לראות את הדופק שלו.</div>
        </div>
      )}

      {activeClientId !== null && loading && (
        <div className="text-center py-14 text-[#6B8FA8] text-sm">טוען את הדופק…</div>
      )}

      {activeClientId !== null && !loading && err !== '' && (
        <div className="text-center py-14">
          <div className="text-red-400 text-sm mb-3">{err}</div>
          <button
            type="button"
            onClick={() => void reload()}
            className="text-[12px] text-[#3D9FFF] border border-[#2A4158] rounded-lg px-3 py-1.5 hover:border-[#0A7AFF] transition-colors"
          >
            נסה שוב
          </button>
        </div>
      )}

      {activeClientId !== null && !loading && err === '' && data !== null && (
        <>
          <StoryBlock story={data.story} shockNote={data.shock_note} />
          <PendingStrip pending={data.pending} note={data.pending_note} />

          {/* North-star (leads) first — top-RIGHT in the RTL grid flow, dominant. */}
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3 mb-4">
            {tiles.map((m, i) => (
              <MetricTile
                key={m.key}
                metric={m}
                why={whyFor(m.key, data.whys)}
                dominant={mode === 'owner' && i === 0}
                showReason={mode === 'marketer'}
                onWhy={() => setOpenWhy(m.key)}
              />
            ))}
          </div>

          {tiles.length === 0 && (
            <div className="text-center py-10 text-[#6B8FA8] text-sm">
              עוד אין נתונים לתקופה הזו — נעדכן ברגע שייכנסו.
            </div>
          )}

          {mode === 'marketer' && (
            <>
              <ReconciliationPanel metric={reconciliation} />
              <MarketerLinks />
              {data.narration_he !== '' && (
                <details className="mb-6">
                  <summary className="text-[12px] text-[#6B8FA8] cursor-pointer hover:text-[#D9E8F5] transition-colors">
                    הטקסט המלא של התקופה
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#D9E8F5] bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 font-sans">
                    {data.narration_he}
                  </pre>
                </details>
              )}
            </>
          )}

          {openMetric !== null && (
            <WhyPopover
              metric={openMetric}
              why={whyFor(openMetric.key, data.whys)}
              onClose={() => setOpenWhy(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
