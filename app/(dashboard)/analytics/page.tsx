'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, Select } from '@/components/ui';
import type { MetaClient } from '@/types';

const DATE_PRESETS = [
  { value: 'last_7d',  label: '7 ימים אחרונים' },
  { value: 'last_30d', label: '30 ימים אחרונים' },
  { value: 'last_90d', label: '90 ימים אחרונים' },
  { value: 'this_month', label: 'החודש הנוכחי' },
  { value: 'last_month', label: 'החודש הקודם' },
];

function MetricCard({ label, value, sub, color, icon }: { label:string;value:string;sub?:string;color?:string;icon:string }) {
  return (
    <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-50" style={{ background: `radial-gradient(circle at top right, ${color||'rgba(10,122,255,0.1)'}, transparent 70%)` }} />
      <div className="text-lg opacity-20 absolute top-3 left-3">{icon}</div>
      <div className="text-[11px] text-[#6B8FA8] font-medium uppercase tracking-wider mb-1">{label}</div>
      <div className="font-mono text-2xl font-medium text-[#D9E8F5]">{value}</div>
      {sub && <div className="text-[11px] text-[#6B8FA8] mt-1">{sub}</div>}
    </div>
  );
}

function MiniBar({ label, value, max }: { label:string; value:number; max:number }) {
  const pct = max > 0 ? Math.round((value/max)*100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#6B8FA8] truncate flex-1 ml-3">{label}</span>
        <span className="text-[#D9E8F5] font-mono flex-shrink-0">₪{value.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-[#1D2D3E] rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-[#0A7AFF] to-[#3D9FFF] rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [clients,    setClients]   = useState<MetaClient[]>([]);
  const [selC,       setSelC]      = useState('');
  const [preset,     setPreset]    = useState('last_30d');
  const [data,       setData]      = useState<any>(null);
  const [loading,    setLoading]   = useState(false);
  const [error,      setError]     = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => {
          setClients(data ?? []);
          if (data?.[0]) setSelC(data[0].id);
        });
    });
  }, []);

  useEffect(() => {
    if (selC) fetchAnalytics();
  }, [selC, preset]);

  async function fetchAnalytics() {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`/api/analytics?clientId=${selC}&datePreset=${preset}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const ins = data?.insights;
  const fmt = (n: any, prefix='') => n ? `${prefix}${parseFloat(n).toLocaleString('he', { maximumFractionDigits: 2 })}` : '—';

  // Extract conversion actions
  const purchases = ins?.actions?.find((a:any) => a.action_type === 'purchase')?.value || 0;
  const leads     = ins?.actions?.find((a:any) => a.action_type === 'lead')?.value || 0;
  const revenue   = ins?.action_values?.find((a:any) => a.action_type === 'purchase')?.value || 0;
  const roas      = revenue && ins?.spend ? (parseFloat(revenue)/parseFloat(ins.spend)).toFixed(2) : '—';

  const topCampaigns = (data?.campaigns ?? [])
    .filter((c:any) => c.insights?.data?.[0])
    .sort((a:any, b:any) => parseFloat(b.insights.data[0].spend||0) - parseFloat(a.insights.data[0].spend||0))
    .slice(0, 5);

  const maxSpend = topCampaigns[0]?.insights?.data?.[0]?.spend ? parseFloat(topCampaigns[0].insights.data[0].spend) : 1;

  return (
    <div>
      <PageHeader eyebrow="Meta Insights" title="ניתוח ביצועים" sub="נתוני Meta Ads בזמן אמת"
        right={
          <div className="flex items-center gap-2">
            <select value={preset} onChange={e=>setPreset(e.target.value)}
              className="bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="rtl">
              {DATE_PRESETS.map(p=><option key={p.value} value={p.value} className="bg-[#162030]">{p.label}</option>)}
            </select>
            <Btn variant="ghost" size="sm" onClick={fetchAnalytics} loading={loading}>🔄</Btn>
          </div>
        } />

      {/* Client selector */}
      {clients.length > 1 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {clients.map(c => (
            <button key={c.id} onClick={() => setSelC(c.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158]'}`}>
              <span>{c.emoji}</span>{c.name}
            </button>
          ))}
        </div>
      )}

      {clients.length === 0 && (
        <Alert type="amber">⚠️ חבר לקוח Meta תחילה ← <a href="/clients" className="font-bold underline">לדף לקוחות</a></Alert>
      )}
      {error && <Alert type="red">❌ {error} — {error.includes('ad account')?<a href="/clients" className="font-bold underline">בחר חשבון מודעות</a>:null}</Alert>}

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-[#6B8FA8]">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <span className="text-sm">שולף נתונים מMeta...</span>
        </div>
      )}

      {ins && !loading && (
        <>
          {/* Main metrics */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <MetricCard icon="💰" label="הוצאה"     value={`₪${parseFloat(ins.spend||0).toLocaleString()}`}  color="rgba(220,38,38,.1)" />
            <MetricCard icon="👁" label="חשיפות"    value={parseInt(ins.impressions||0).toLocaleString()}       color="rgba(10,122,255,.12)" />
            <MetricCard icon="🖱" label="קליקים"    value={parseInt(ins.clicks||0).toLocaleString()}            color="rgba(109,40,217,.1)" sub={`CTR ${parseFloat(ins.ctr||0).toFixed(2)}%`} />
            <MetricCard icon="👥" label="reach"     value={parseInt(ins.reach||0).toLocaleString()}             color="rgba(5,150,105,.1)" sub={`תדירות ${parseFloat(ins.frequency||0).toFixed(2)}`} />
          </div>

          <div className="grid grid-cols-4 gap-3 mb-5">
            <MetricCard icon="💎" label="CPC"       value={`₪${parseFloat(ins.cpc||0).toFixed(2)}`}  color="rgba(217,119,6,.1)" />
            <MetricCard icon="📊" label="CPM"       value={`₪${parseFloat(ins.cpm||0).toFixed(2)}`}  color="rgba(184,149,58,.1)" />
            <MetricCard icon="🛍" label="ROAS"      value={roas}                                       color="rgba(5,150,105,.12)" sub={revenue?`הכנסה ₪${parseFloat(revenue).toFixed(0)}`:''}  />
            <MetricCard icon="📋" label="לידים"     value={leads.toString()}                          color="rgba(10,122,255,.1)" sub={purchases?`${purchases} רכישות`:''} />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Top campaigns */}
            <Card>
              <CardLabel>🚀 קמפיינים לפי הוצאה</CardLabel>
              {topCampaigns.length === 0
                ? <div className="text-xs text-[#2E4459] text-center py-4">אין קמפיינים פעילים</div>
                : topCampaigns.map((c:any) => (
                  <MiniBar key={c.id} label={c.name} value={parseFloat(c.insights.data[0].spend||0)} max={maxSpend} />
                ))}
            </Card>

            {/* Top ads */}
            <Card>
              <CardLabel>✨ מודעות מובילות (CTR)</CardLabel>
              {(data?.ads ?? []).filter((a:any)=>a.insights?.data?.[0]).slice(0,5).map((a:any,i:number) => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-[#1E2F42] last:border-0">
                  <div className="w-5 h-5 rounded-full bg-[#1D2D3E] text-[10px] flex items-center justify-center font-bold text-[#6B8FA8]">{i+1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">{a.name}</div>
                    <div className="text-[10px] text-[#2E4459]">₪{parseFloat(a.insights.data[0].spend||0).toFixed(0)} · {a.insights.data[0].impressions?.toLocaleString()} חשיפות</div>
                  </div>
                  <div className="text-xs font-bold text-[#3D9FFF] flex-shrink-0">
                    {parseFloat(a.insights.data[0].ctr||0).toFixed(2)}%
                  </div>
                </div>
              ))}
              {(data?.ads ?? []).filter((a:any)=>a.insights?.data?.[0]).length===0 &&
                <div className="text-xs text-[#2E4459] text-center py-4">אין מודעות עם נתונים</div>}
            </Card>
          </div>

          {/* Ad fatigue alert */}
          {parseFloat(ins.frequency||0) > 3 && (
            <Alert type="amber">
              ⚠️ <strong>התראת Ad Fatigue!</strong> תדירות {parseFloat(ins.frequency).toFixed(1)} — הקהל רואה את המודעה יותר מדי. הגיע הזמן לרענן קריאייטיב.
              <a href="/create" className="mr-2 font-bold underline">צור מודעה חדשה →</a>
            </Alert>
          )}

          {/* Low CTR alert */}
          {parseFloat(ins.ctr||0) < 0.5 && parseInt(ins.impressions||0) > 1000 && (
            <Alert type="red">
              📉 CTR נמוך ({parseFloat(ins.ctr).toFixed(2)}%) — הhook לא עובד. נסה וריאציות שונות.
              <a href="/variations" className="mr-2 font-bold underline">צור וריאציות →</a>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
