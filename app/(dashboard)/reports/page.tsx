'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Input, Textarea, Btn, Alert, PageHeader, CopyBtn } from '@/components/ui';
import { reportLink, whatsappShareLink } from '@/lib/share';
import type { MetaClient } from '@/types';
import { clientToMetaClient } from '@/lib/clients';

// Pre-filled WhatsApp message for sharing a client-facing ROI report link.
const WA_REPORT_MSG = (link: string) =>
  `היי! הנה דוח הביצועים העדכני של הקמפיינים שלך:\n\n${link}`;

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
  // Context needed to mint a share-link for whatever report is on screen
  // (the historic list loses the row metadata when we only stash `data`).
  const [shareCtx, setShareCtx] = useState<{ clientId: string; periodStart: string; periodEnd: string; report: any } | null>(null);
  const [shareLink, setShareLink] = useState('');
  const [sharing,  setSharing]  = useState(false);
  const [shareErr, setShareErr] = useState('');
  const [error,    setError]    = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('clients').select('id, name, owner_user_id, created_at, updated_at').eq('owner_user_id', user.id)
        .then(({ data }) => { const list = (data ?? []).map(clientToMetaClient); setClients(list); if(list[0]) setSelC(list[0].id); });
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
      showReport(data.data, { clientId: selC, periodStart: form.start, periodEnd: form.end });
      setReports(p=>[data.report,...p]);
    } catch(e:any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Display a report and remember the context needed to mint a share-link.
  function showReport(data:any, ctx:{clientId:string;periodStart:string;periodEnd:string}) {
    setCurrent(data);
    setShareCtx({ ...ctx, report: data });
    setShareLink(''); setShareErr('');
  }

  async function share() {
    if (!shareCtx) return;
    setSharing(true); setShareErr('');
    try {
      const res = await fetch('/api/reports/share', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(shareCtx) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || 'יצירת הקישור נכשלה');
      setShareLink(data.link);
      navigator.clipboard?.writeText(data.link).catch(()=>{});
    } catch(e:any) { setShareErr(e.message); }
    finally { setSharing(false); }
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8]'}`}>
                <span>{c.emoji}</span>{c.name}
              </button>)}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">מתאריך</label>
                <input type="date" value={form.start} onChange={e=>setForm(p=>({...p,start:e.target.value}))} className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="ltr"/></div>
              <div><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">עד תאריך</label>
                <input type="date" value={form.end} onChange={e=>setForm(p=>({...p,end:e.target.value}))} className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="ltr"/></div>
            </div>
            <Input label="שלח ל (אימייל, אופציונלי)" value={form.sendTo} onChange={v=>setForm(p=>({...p,sendTo:v}))} placeholder="client@example.com" />
            {error && <Alert type="red">{error}</Alert>}
            <Btn variant="primary" loading={loading} onClick={generate} disabled={!selC||!form.start||!form.end}>📊 צור דוח</Btn>
          </Card>

          {reports.length > 0 && (
            <Card>
              <CardLabel>דוחות קודמים</CardLabel>
              {reports.slice(0,8).map(r=>(
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-[#1E2F42] last:border-0 cursor-pointer hover:opacity-80" onClick={()=>showReport(r.data,{clientId:r.client_id,periodStart:r.period_start,periodEnd:r.period_end})}>
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
                  <div key={l} className="bg-[#162030] rounded-lg p-2.5">
                    <div className="text-[10px] text-[#6B8FA8]">{i} {l}</div>
                    <div className="font-mono text-sm font-medium mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
              <div className="bg-[#162030] rounded-lg p-3">
                <div className="text-xs font-bold text-[#2E4459] mb-2 uppercase">ניתוח AI</div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{current.analysis}</div>
              </div>

              {/* Share: mint a public client-facing /report/<token> link */}
              <div className="mt-4 pt-4 border-t border-[#1E2F42]">
                {!shareLink ? (
                  <Btn variant="primary" loading={sharing} onClick={share}>🔗 שתף דוח</Btn>
                ) : (
                  <>
                    <CardLabel>🎉 קישור הדוח נוצר — הועתק ללוח!</CardLabel>
                    <button
                      onClick={()=>navigator.clipboard?.writeText(shareLink)}
                      title="לחץ להעתקה"
                      className="w-full text-right flex items-center justify-between gap-3 bg-[#070A0E] border border-[#2A4158] rounded-lg px-4 py-3 mb-3 hover:border-[#0A7AFF] transition-colors">
                      <span className="font-mono text-xs text-[#D9E8F5] truncate" dir="ltr">{shareLink}</span>
                      <span className="text-[#6B8FA8] text-lg flex-shrink-0">📋</span>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      <CopyBtn text={shareLink} label="📋 העתק קישור" />
                      <a
                        href={whatsappShareLink(WA_REPORT_MSG(shareLink))}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-[#059669] hover:brightness-110 text-white text-sm font-semibold px-3 py-1.5 transition-all">
                        💬 שלח ב-WhatsApp
                      </a>
                    </div>
                  </>
                )}
                {shareErr && <Alert type="red">❌ {shareErr}</Alert>}
              </div>
            </Card>
          ):(
            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">📊</span><span className="text-sm">הגדר תקופה ולחץ "צור דוח"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
