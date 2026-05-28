'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Btn, Alert, PageHeader } from '@/components/ui';
import type { MetaClient } from '@/types';

// ════════════════════════════════════════════════════════════
// REPORTS PAGE
// ════════════════════════════════════════════════════════════
export default function ReportsPage() {
  const [clients,  setClients]  = useState<MetaClient[]>([]);
  const [reports,  setReports]  = useState<any[]>([]);
  const [selC,     setSelC]     = useState('');
  const [form,     setForm]     = useState({ start: '', end: '', sendTo: '' });
  const [loading,  setLoading]  = useState(false);
  const [current,  setCurrent]  = useState<any>(null);
  const [error,    setError]    = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('meta_clients').select('*').eq('user_id', user.id)
        .then(({ data }) => { setClients(data??[]); if(data?.[0]) setSelC(data[0].id); });
      fetch('/api/reports').then(r=>r.json()).then(d=>setReports(Array.isArray(d)?d:[]));
    });
  }, []);

  async function generate() {
    if (!selC||!form.start||!form.end) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/reports', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ clientId:selC, periodStart:form.start, periodEnd:form.end, sendTo:form.sendTo||null }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrent(data.data);
      setReports(p=>[data.report,...p]);
    } catch(e:any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <PageHeader eyebrow="דוחות" title="דוחות ביצועים" sub="צור דוחות מקצועיים ושלח ללקוחות" />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>הגדר דוח</CardLabel>
            <div className="flex flex-wrap gap-2 mb-3">
              {clients.map(c=><button key={c.id} onClick={()=>setSelC(c.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#243752] bg-[#1A2A42] text-[#6B8FA8]'}`}>
                <span>{c.emoji}</span>{c.name}
              </button>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">מתאריך</label>
                <input type="date" value={form.start} onChange={e=>setForm(p=>({...p,start:e.target.value}))} className="w-full bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="ltr"/></div>
              <div><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">עד תאריך</label>
                <input type="date" value={form.end} onChange={e=>setForm(p=>({...p,end:e.target.value}))} className="w-full bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="ltr"/></div>
            </div>
            <Input label="שלח ל (אימייל, אופציונלי)" value={form.sendTo} onChange={v=>setForm(p=>({...p,sendTo:v}))} placeholder="client@example.com" />
            {error && <Alert type="red">{error}</Alert>}
            <Btn variant="primary" loading={loading} onClick={generate} disabled={!selC||!form.start||!form.end}>📊 צור דוח</Btn>
          </Card>

          {reports.length > 0 && (
            <Card>
              <CardLabel>דוחות קודמים</CardLabel>
              {reports.slice(0,8).map(r=>(
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-[#243752] last:border-0 cursor-pointer hover:opacity-80" onClick={()=>setCurrent(r.data)}>
                  <div><div className="text-xs font-medium">{r.title}</div><div className="text-[10px] text-[#2E4459]">{r.period_start} — {r.period_end}</div></div>
                  {r.sent_to && <div className="text-[10px] text-[#34D399]">✓ נשלח</div>}
                </div>
              ))}
            </Card>
          )}
        </div>

        <div>
          {current ? (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="font-bold">{current.client} — דוח ביצועים</div>
                <div className="text-xs text-[#6B8FA8]">{current.period?.start} — {current.period?.end}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  ['💰','הוצאה',`₪${parseFloat(current.metrics?.spend||0).toFixed(0)}`],
                  ['👁','חשיפות',parseInt(current.metrics?.impressions||0).toLocaleString()],
                  ['🖱','קליקים',parseInt(current.metrics?.clicks||0).toLocaleString()],
                  ['📊','CTR',`${current.metrics?.avgCtr||0}%`],
                  ['💎','CPC',`₪${current.metrics?.avgCpc||0}`],
                  ['📤','פוסטים',current.postsPublished||0],
                ].map(([i,l,v])=>(
                  <div key={l} className="bg-[#1A2A42] rounded-lg p-2.5">
                    <div className="text-[10px] text-[#6B8FA8]">{i} {l}</div>
                    <div className="font-mono text-sm font-medium mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
              <div className="bg-[#1A2A42] rounded-lg p-3">
                <div className="text-xs font-bold text-[#2E4459] mb-2 uppercase">ניתוח AI</div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{current.analysis}</div>
              </div>
            </Card>
          ):(
            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">📊</span><span className="text-sm">הגדר תקופה ולחץ "צור דוח"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
