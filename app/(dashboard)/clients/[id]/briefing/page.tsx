'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Btn, PageHeader, Alert, CopyBtn } from '@/components/ui';
import { BriefingWizard } from '@/components/BriefingWizard';
import { briefCompletion } from '@/lib/briefing-template';

export default function MarketerBriefingPage() {
  const params  = useParams<{ id: string }>();
  const router  = useRouter();
  const clientId = params.id;

  const [clientName, setClientName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saved,  setSaved]  = useState(false);   // "נשמר אוטומטית ✓"
  const [error,  setError]  = useState('');

  // Send-to-client link modal
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const completion = briefCompletion(values);

  // ── Load existing brief + client name ─────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [briefRes, clientsRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/brief`),
          fetch('/api/clients'),
        ]);
        const brief = await briefRes.json();
        if (alive && briefRes.ok) setValues((brief.values ?? {}) as Record<string, string>);
        if (clientsRes.ok) {
          const { clients } = await clientsRes.json();
          const c = (clients ?? []).find((x: any) => x.id === clientId);
          if (alive && c) setClientName(c.name);
        }
      } catch {
        if (alive) setError('שגיאה בטעינת הבריף');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clientId]);

  // ── Autosave (debounced PUT) ──────────────────────────────────
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const save = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: valuesRef.current }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'שגיאה בשמירה'); return; }
      setError('');
      setSaved(true);
    } catch {
      setError('שגיאה בשמירה — בדוק את החיבור');
    }
  }, [clientId]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef    = useRef(false);

  function onChange(next: Record<string, string>) {
    dirtyRef.current = true;
    setSaved(false);
    setValues(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void save(); }, 800);
  }

  function flush() {
    if (!dirtyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void save();
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Send-to-client link ───────────────────────────────────────
  async function sendToClient() {
    setLinking(true); setError('');
    try {
      const res = await fetch(`/api/clients/${clientId}/brief-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'שגיאה ביצירת קישור'); return; }
      setLinkUrl(window.location.origin + data.url);
    } catch {
      setError('שגיאה ביצירת קישור');
    } finally {
      setLinking(false);
    }
  }

  const statusLabel = completion >= 100 ? `בריפינג הושלם (${completion}%)` : `בתהליך (${completion}%)`;

  return (
    <div>
      <PageHeader
        eyebrow="בריפינג"
        title={`בריפינג — ${clientName || '...'}`}
        sub={statusLabel}
        right={
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-[#34D399]">נשמר אוטומטית ✓</span>}
            <Btn variant="ghost" size="sm" onClick={() => router.push('/clients')}>← לקוחות</Btn>
            <Btn variant="green" size="sm" loading={linking} onClick={sendToClient}>📤 שלח ללקוח</Btn>
          </div>
        }
      />

      {error && <Alert type="red">{error}</Alert>}

      {loading ? (
        <div className="text-center py-14 text-[#6B8FA8] text-sm">טוען בריף...</div>
      ) : (
        <div className="max-w-2xl">
          <BriefingWizard values={values} onChange={onChange} onStepFlush={flush} />
        </div>
      )}

      {/* Send-to-client link modal */}
      {linkUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setLinkUrl(null)}
        >
          <div
            className="bg-[#111A24] border border-[#1E2F42] rounded-2xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}
            dir="rtl"
          >
            <div className="font-bold text-lg text-[#D9E8F5] mb-1">קישור למילוי בריפינג</div>
            <p className="text-[#6B8FA8] text-sm mb-4">שלח את הקישור ללקוח כדי שימלא את הבריף בעצמו.</p>
            <input
              readOnly
              value={linkUrl}
              dir="ltr"
              onFocus={e => e.currentTarget.select()}
              className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[12px] text-[#D9E8F5] outline-none mb-3 select-all"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#6B8FA8]">הקישור תקף ל-7 ימים</span>
              <div className="flex gap-2">
                <CopyBtn text={linkUrl} />
                <Btn variant="ghost" size="sm" onClick={() => setLinkUrl(null)}>סגור</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
