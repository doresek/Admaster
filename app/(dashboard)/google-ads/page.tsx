'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { GoogleAdsConnection } from '@/types';

export default function GoogleAdsPage() {
  const supabase     = createClient();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [connections, setConnections] = useState<GoogleAdsConnection[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [busyId,      setBusyId]      = useState<string | null>(null);
  const [banner,      setBanner]      = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Read callback query params once on mount, then clean the URL.
  useEffect(() => {
    const status = searchParams.get('status');
    const error  = searchParams.get('error');
    if (status === 'connected') setBanner({ kind: 'success', text: 'החיבור ל-Google Ads בוצע בהצלחה' });
    else if (error)             setBanner({ kind: 'error',   text: `שגיאה בחיבור: ${error}` });
    if (status || error) router.replace('/google-ads');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshList() {
    setLoading(true);
    const { data } = await supabase
      .from('google_ads_connections')
      .select('*')
      .order('connected_at', { ascending: false });
    setConnections((data ?? []) as GoogleAdsConnection[]);
    setLoading(false);
  }

  useEffect(() => { refreshList(); /* eslint-disable-line */ }, []);

  async function refreshCustomers(connectionId: string) {
    setBusyId(connectionId);
    try {
      const res  = await fetch(`/api/google-ads/accounts?connectionId=${connectionId}`);
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: 'error', text: `שגיאה ברענון: ${data.error ?? 'unknown'}` });
      } else {
        setBanner({ kind: 'success', text: `נמצאו ${data.customers?.length ?? 0} חשבונות` });
      }
      await refreshList();
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(connectionId: string) {
    if (!confirm('לנתק את החיבור? פעולה זו לא ניתנת לשחזור.')) return;
    setBusyId(connectionId);
    try {
      const res = await fetch(`/api/google-ads/accounts?connectionId=${connectionId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        setBanner({ kind: 'error', text: `שגיאה בניתוק: ${data.error ?? 'unknown'}` });
        return;
      }
      setBanner({ kind: 'success', text: 'החיבור נותק' });
      await refreshList();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="-mx-8 -my-7 min-h-screen bg-stone-50 text-stone-900 px-8 py-10" dir="rtl">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-amber-700 mb-2">Google Ads</div>
          <h1 className="font-serif text-3xl text-stone-900 mb-2">חיבורי Google Ads</h1>
          <p className="text-stone-500 text-sm">
            התחבר לחשבון Google שלך כדי לאפשר ל-AdMaster לקרוא נתוני קמפיינים.
            הרשאה: צפייה בלבד.
          </p>
        </header>

        {banner && (
          <div
            role="status"
            className={
              banner.kind === 'success'
                ? 'mb-6 px-4 py-3 rounded-xl bg-stone-900 text-white text-sm'
                : 'mb-6 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm'
            }
          >
            {banner.text}
          </div>
        )}

        <div className="mb-8">
          <a
            href="/api/google-ads/connect"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-[13px] font-semibold transition shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
          >
            חבר חשבון Google Ads
          </a>
        </div>

        {loading ? (
          <div className="text-stone-500 text-sm">טוען…</div>
        ) : connections.length === 0 ? (
          <div className="text-center py-14 border border-dashed border-stone-300 rounded-2xl bg-white">
            <div className="font-serif text-lg text-stone-900 mb-1">אין עדיין חיבורים</div>
            <div className="text-stone-500 text-sm">לחץ על "חבר חשבון" כדי להתחיל.</div>
          </div>
        ) : (
          <ul className="space-y-4">
            {connections.map((c) => (
              <li
                key={c.id}
                className="bg-white border border-stone-200 rounded-2xl p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-1">
                      חשבון Google
                    </div>
                    <div className="font-serif text-xl text-stone-900">
                      {c.google_user_email ?? '—'}
                    </div>
                    <div className="text-xs text-stone-500 mt-1">
                      חובר ב-{new Date(c.connected_at).toLocaleDateString('he-IL')}
                      {c.last_synced_at && (
                        <> · סונכרן ב-{new Date(c.last_synced_at).toLocaleDateString('he-IL')}</>
                      )}
                    </div>
                  </div>
                  <StatusPill status={c.status} />
                </div>

                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 mb-4">
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">
                    {c.customer_ids.length} חשבונות Google Ads נגישים
                  </div>
                  {c.customer_ids.length === 0 ? (
                    <div className="text-xs text-stone-500">
                      לחץ "רענן רשימה" כדי למשוך את החשבונות.
                    </div>
                  ) : (
                    <ul className="space-y-1 max-h-40 overflow-auto">
                      {c.customer_ids.map((cust) => (
                        <li
                          key={cust.id}
                          className="font-mono text-[12.5px] text-stone-700"
                          dir="ltr"
                        >
                          {cust.id}{cust.descriptive_name ? ` — ${cust.descriptive_name}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => refreshCustomers(c.id)}
                    disabled={busyId === c.id}
                    className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900 text-sm font-medium transition disabled:opacity-50"
                  >
                    {busyId === c.id ? 'מרענן…' : 'רענן רשימה'}
                  </button>
                  <button
                    onClick={() => disconnect(c.id)}
                    disabled={busyId === c.id}
                    className="px-4 py-2 rounded-xl text-amber-800 hover:bg-amber-50 text-sm font-medium transition disabled:opacity-50"
                  >
                    נתק
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: GoogleAdsConnection['status'] }) {
  const map = {
    connected: { bg: 'bg-stone-900',  fg: 'text-white',     label: 'פעיל' },
    error:     { bg: 'bg-amber-100',  fg: 'text-amber-900', label: 'שגיאה' },
    revoked:   { bg: 'bg-stone-200',  fg: 'text-stone-700', label: 'מנותק' },
  }[status] ?? { bg: 'bg-stone-200', fg: 'text-stone-700', label: status };
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${map.bg} ${map.fg}`}>
      {map.label}
    </span>
  );
}
