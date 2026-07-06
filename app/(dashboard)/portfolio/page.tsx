'use client';
// AGENCY PORTFOLIO — D-2 (DASHBOARD-ARCHITECTURE §2). The portfolio analyst
// over the agency's own clients: portfolio narration on top, then triage lanes
// (🔴 דחוף / 🟡 לתשומת לב / 🟢 תקין) with client cards in attention-rank order
// (the C-06 ranking IS the order — §2), then the aggregates strip.
//
// Card click → the client becomes the app-wide active client (the same
// cookie+context mechanism the ClientSwitcher uses) and we navigate to /pulse,
// so the single-client dashboard opens already scoped to them.
//
// One owner's portfolio ONLY — the API is owner-scoped end to end; nothing
// cross-agency is ever fetched or rendered.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Alert } from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';
import {
  AggregatesStrip,
  LaneSection,
  NarrationBlock,
  PortfolioEmptyState,
} from './components';
import type { Lane, PortfolioPayload } from '@/app/api/portfolio/shared';

const LANE_ORDER: readonly Lane[] = ['urgent', 'watch', 'ok'];

/**
 * Shallow structural narrowing for our own route's response — runtime-guarded
 * (zero casts): the payload contract lives in app/api/portfolio/shared.ts and
 * this page only trusts a body that carries its top-level shape.
 */
function isPortfolioPayload(u: unknown): u is PortfolioPayload {
  return (
    typeof u === 'object' && u !== null &&
    'narration' in u && 'lanes' in u && 'aggregates' in u && 'warnings' in u
  );
}

function usePortfolio() {
  const [data, setData]       = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/portfolio', { cache: 'no-store' });
      const body: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'שגיאה בטעינת התיק';
        throw new Error(message);
      }
      if (!isPortfolioPayload(body)) throw new Error('תשובת שרת לא צפויה');
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה בטעינת התיק');
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, err, setErr };
}

export default function PortfolioPage() {
  const router = useRouter();
  const { setActiveClient } = useActiveClient();
  const { data, loading, err, setErr } = usePortfolio();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Activate the clicked client app-wide (cookie + context — the exact
  // ClientSwitcher mechanism), then open their single-client dashboard.
  const openClient = useCallback(async (clientId: string) => {
    setBusyId(clientId);
    setErr('');
    try {
      await setActiveClient(clientId);
      router.push('/pulse');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שגיאה במעבר ללקוח');
    } finally {
      setBusyId(null);
    }
  }, [router, setActiveClient, setErr]);

  const clientsTotal = data?.aggregates.clients_total ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="תיק הלקוחות"
        title="פורטפוליו הסוכנות"
        sub="כל הלקוחות שלך במבט אחד — ממוינים לפי מה שדורש את תשומת הלב שלך עכשיו"
      />

      {err && <Alert type="red">{err}</Alert>}

      {loading && (
        <div className="text-center py-14 text-[#6B8FA8] text-sm">טוען את התיק…</div>
      )}

      {!loading && data !== null && clientsTotal === 0 && (
        <PortfolioEmptyState
          icon="👥"
          title="אין עדיין לקוחות בתיק"
          sub="ברגע שתוסיף לקוחות, הם יופיעו כאן — ממוינים אוטומטית לפי מה שדורש טיפול."
        />
      )}

      {!loading && data !== null && clientsTotal > 0 && (
        <>
          <NarrationBlock narration={data.narration} />

          {clientsTotal === 1 && (
            <Alert type="blue" className="mb-4">
              עם לקוח אחד — הדשבורד המלא נמצא ב-Pulse. לחיצה על הכרטיס תפתח אותו.
            </Alert>
          )}

          {LANE_ORDER.map((lane) => (
            <LaneSection
              key={lane}
              lane={lane}
              clients={data.lanes[lane]}
              busyId={busyId}
              onOpen={(clientId) => { void openClient(clientId); }}
            />
          ))}

          <AggregatesStrip aggregates={data.aggregates} />
        </>
      )}
    </div>
  );
}
