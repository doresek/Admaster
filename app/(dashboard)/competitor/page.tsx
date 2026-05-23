'use client';
import { useState } from 'react';
import { Card, CardLabel, Input, Btn, Alert, PageHeader } from '@/components/ui';
import { clsx } from 'clsx';

export default function CompetitorPage() {
  const [query,    setQuery]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [analyzing,setAnalyzing]= useState(false);
  const [ads,      setAds]      = useState<any[]>([]);
  const [analysis, setAnalysis] = useState('');
  const [error,    setError]    = useState('');
  const [isMock,   setIsMock]   = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true); setError(''); setAds([]); setAnalysis('');
    try {
      const res  = await fetch(`/api/competitor?query=${encodeURIComponent(query)}&analyze=true`);
      const data = await res.json();
      setAds(data.ads ?? []);
      setAnalysis(data.analysis ?? '');
      setIsMock(data.mock ?? false);
    } catch(e:any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <PageHeader eyebrow="מחקר שוק" title="ניתוח מתחרים" sub="Facebook Ad Library — ראה מה המתחרים שלך מפרסמים" />

      <Card className="mb-4">
        <CardLabel>🔍 חיפוש מודעות מתחרים</CardLabel>
        <div className="flex gap-3">
          <input type="text" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()}
            placeholder="חפש תחום, מוצר, או שם עסק... לדוגמה: תפילין, בר מצווה, ספרי תורה"
            className="flex-1 bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF] placeholder-[#2E4459]" dir="rtl" />
          <Btn variant="primary" loading={loading} onClick={search} disabled={!query.trim()}>🔍 חפש</Btn>
        </div>
        {isMock && <Alert type="amber" className="mt-3">💡 מציג דוגמאות — להגדרת Meta Ad Library API הוסף META_APP_TOKEN</Alert>}
        {error && <Alert type="red">{error}</Alert>}
      </Card>

      {ads.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {/* Ads list */}
          <div>
            <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">{ads.length} מודעות נמצאו</div>
            {ads.map((ad,i)=>(
              <Card key={ad.id || i} className="mb-3 hover:border-[#2A4158]">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded bg-[#1D2D3E] flex items-center justify-center text-xs font-bold text-[#0A7AFF]">{i+1}</div>
                  <div>
                    <div className="text-xs font-bold">{ad.page_name}</div>
                    {ad.ad_delivery_start_time && <div className="text-[10px] text-[#2E4459]">מ-{new Date(ad.ad_delivery_start_time).toLocaleDateString('he')}</div>}
                  </div>
                  {ad.impressions && <div className="mr-auto text-[10px] text-[#6B8FA8]">{ad.impressions.lower_bound?.toLocaleString()}+ חשיפות</div>}
                </div>
                {ad.ad_creative_bodies?.[0] && (
                  <div className="text-[13px] leading-relaxed text-[#D9E8F5] bg-[#162030] rounded-lg p-3 mb-2">
                    {ad.ad_creative_bodies[0].substring(0, 200)}
                    {ad.ad_creative_bodies[0].length > 200 ? '...' : ''}
                  </div>
                )}
                {ad.ad_creative_link_titles?.[0] && (
                  <div className="text-xs font-bold text-[#3D9FFF]">{ad.ad_creative_link_titles[0]}</div>
                )}
                {ad.ad_snapshot_url && (
                  <a href={ad.ad_snapshot_url} target="_blank" rel="noreferrer" className="text-[11px] text-[#3D9FFF] hover:underline mt-1 inline-block">
                    👁 ראה מודעה מקורית →
                  </a>
                )}
              </Card>
            ))}
          </div>

          {/* AI Analysis */}
          {analysis && (
            <div>
              <Card style={{ borderColor: 'rgba(109,40,217,.3)', position: 'sticky', top: 20 }}>
                <CardLabel>🤖 ניתוח AI</CardLabel>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#D9E8F5]">{analysis}</div>
                <div className="mt-4 pt-4 border-t border-[#1E2F42]">
                  <a href="/create" className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold rounded-lg transition-colors">
                    ✨ צור מודעה מנצחת →
                  </a>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {!loading && ads.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <span className="text-5xl mb-3 opacity-30">🔍</span>
          <div className="text-base font-semibold mb-1">חפש מתחרים</div>
          <div className="text-sm">הזן מילת מפתח או שם עסק לגילוי מודעות פעילות</div>
        </div>
      )}
    </div>
  );
}
