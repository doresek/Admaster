'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Chip, Textarea, Input, Btn, Alert, PageHeader, CostBadge, Select } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import type { MetaClient } from '@/types';

function useMetaClients() {
  const [clients, setClients] = useState<MetaClient[]>([]);
  useEffect(() => {
    const s = createClient();
    s.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      s.from('meta_clients').select('*').eq('user_id', user.id).then(({ data }) => setClients(data ?? []));
    });
  }, []);
  return clients;
}

// ═══ PUBLISH PAGE ═══════════════════════════════════════════
export function PublishPage() {
  const clients = useMetaClients();
  const [selC,    setSelC]    = useState<MetaClient|null>(null);
  const [text,    setText]    = useState('');
  const [brief,   setBrief]   = useState('');
  const [genLoading, setGenL] = useState(false);
  const [pubLoading, setPubL] = useState(false);
  const [published, setPub]   = useState('');
  const [err,     setErr]     = useState('');
  const { call } = useAI();

  const page = selC?.pages.find(p => p.id === selC.selected_page_id);

  async function genPost() {
    if (!brief.trim()) return;
    setGenL(true);
    const raw = await call('post', `כתוב פוסט קצר לFacebook עבור ${selC?.name || 'עסק'}. החזר רק את הטקסט.`, brief, 400);
    if (raw) setText(raw);
    setGenL(false);
  }

  async function publish() {
    if (!text.trim() || !selC || !page) return;
    setErr(''); setPubL(true);
    try {
      const res = await fetch('/api/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selC.id, path: `${page.id}/feed`, body: { message: text } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPub(data.id);
      // Deduct credits
      await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', system: '', prompt: '' }) });
    } catch (e: any) { setErr(e.message); }
    finally { setPubL(false); }
  }

  if (clients.length === 0) return (
    <div><PageHeader eyebrow="Meta" title="פרסם פוסט" /><Alert type="amber">⚠️ הוסף לקוח Meta תחילה <a href="/clients" className="font-bold underline">לדף לקוחות →</a></Alert></div>
  );

  return (
    <div>
      <PageHeader eyebrow="Meta" title="פרסם פוסט" sub="פרסום ישיר לדף Facebook" right={<CostBadge cost={2} />} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>לקוח</CardLabel>
            <div className="flex flex-wrap gap-2 mb-3">
              {clients.map(c => <button key={c.id} onClick={() => setSelC(c)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${selC?.id===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158]'}`}>
                <span>{c.emoji}</span>{c.name}
              </button>)}
            </div>
            {page && <Alert type="green" className="mb-0">📘 יפורסם ל: <strong>{page.name}</strong></Alert>}
          </Card>

          <Card className="mb-3">
            <CardLabel>בריף לAI</CardLabel>
            <Textarea value={brief} onChange={setBrief} placeholder="תאר מה לפרסם..." rows={2} />
            <Btn variant="ghost" size="sm" loading={genLoading} onClick={genPost} disabled={!brief.trim()}>✨ צור עם AI</Btn>
          </Card>

          <Card className="mb-3">
            <CardLabel>טקסט הפוסט</CardLabel>
            <Textarea value={text} onChange={setText} placeholder="כתוב פוסט..." rows={6} />
          </Card>

          {err && <Alert type="red">{err}</Alert>}
          {published && <Alert type="green">✅ פורסם! Post ID: {published}</Alert>}

          <Btn variant="primary" full loading={pubLoading} onClick={publish} disabled={!text.trim() || !page}>
            📤 פרסם ל-{page?.name || 'דף'}
          </Btn>
        </div>

        <div>
          <div className="text-xs text-[#6B8FA8] mb-2">תצוגה מקדימה</div>
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-[#1D2D3E] flex items-center justify-center text-base">📘</div>
              <div>
                <div className="font-semibold text-sm">{page?.name || 'הדף שלך'}</div>
                <div className="text-[10px] text-[#2E4459]">עכשיו · 🌍</div>
              </div>
            </div>
            <div className="text-sm leading-relaxed whitespace-pre-wrap min-h-[80px]" style={{ color: text ? '#D9E8F5' : '#2E4459' }}>
              {text || 'הפוסט יופיע כאן...'}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ═══ CAMPAIGN PAGE ════════════════════════════════════════════
const OBJECTIVES = [
  {id:'OUTCOME_AWARENESS',l:'מודעות למותג',i:'👁'},
  {id:'OUTCOME_TRAFFIC',  l:'תנועה לאתר', i:'🖱'},
  {id:'OUTCOME_LEADS',    l:'לידים',       i:'📋'},
  {id:'OUTCOME_SALES',    l:'מכירות',      i:'💰'},
  {id:'OUTCOME_ENGAGEMENT',l:'מעורבות',    i:'❤️'},
];

export function CampaignPage() {
  const clients = useMetaClients();
  const [step,  setStep]  = useState(1);
  const [selC,  setSelC]  = useState<MetaClient|null>(null);
  const [c, setC] = useState({ name:'', objective:'', budget:50, budgetType:'DAILY', ageMin:25, ageMax:65, headline:'', adText:'', cta:'LEARN_MORE' });
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{cid:string;aid:string}|null>(null);
  const [err,     setErr]     = useState('');
  const uc = (k: string, v: any) => setC(p => ({ ...p, [k]: v }));

  async function create() {
    if (!selC?.selected_ad_account_id) return;
    setErr(''); setLoading(true);
    try {
      const campRes = await fetch('/api/meta', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ clientId:selC.id, path:`${selC.selected_ad_account_id}/campaigns`,
          body:{ name:c.name||`קמפיין ${new Date().toLocaleDateString('he')}`, objective:c.objective, status:'PAUSED', special_ad_categories:[] } }) });
      const camp = await campRes.json();
      if (!campRes.ok) throw new Error(camp.error);

      const adsetRes = await fetch('/api/meta', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ clientId:selC.id, path:`${selC.selected_ad_account_id}/adsets`,
          body:{ name:'AdSet', campaign_id:camp.id, ...(c.budgetType==='DAILY'?{daily_budget:c.budget*100}:{lifetime_budget:c.budget*100}),
            billing_event:'IMPRESSIONS', optimization_goal:'REACH', targeting:{age_min:c.ageMin,age_max:c.ageMax,geo_locations:{countries:['IL']}}, status:'PAUSED' } }) });
      const adset = await adsetRes.json();
      if (!adsetRes.ok) throw new Error(adset.error);

      setResult({ cid:camp.id, aid:adset.id }); setStep(5);
    } catch(e:any) { setErr(e.message); }
    finally { setLoading(false); }
  }

  if (clients.length===0) return (
    <div><PageHeader eyebrow="Meta Ads" title="בנה קמפיין" /><Alert type="amber">⚠️ הוסף לקוח Meta תחילה <a href="/clients" className="font-bold underline">לדף לקוחות →</a></Alert></div>
  );

  const STEPS = ['לקוח','מטרה','תקציב','קריאייטיב','✅'];
  return (
    <div>
      <PageHeader eyebrow="Meta Ads" title="בנה קמפיין" sub="יצירת קמפיין ב-5 שלבים" right={<CostBadge cost={15} />} />

      {/* Step bar */}
      <div className="flex items-center gap-2 mb-6 pb-5 border-b border-[#1E2F42]">
        {STEPS.map((s,i)=>(
          <div key={s} className="flex items-center gap-2 flex-1">
            <div onClick={()=>i+1<step&&setStep(i+1)}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${i+1<step?'bg-[#059669] text-white cursor-pointer':i+1===step?'bg-[#0A7AFF] text-white':'bg-[#1D2D3E] text-[#2E4459]'}`}>
              {i+1<step?'✓':i+1}
            </div>
            <span className={`text-xs font-medium whitespace-nowrap ${i+1===step?'text-[#3D9FFF]':'text-[#2E4459]'}`}>{s}</span>
            {i<STEPS.length-1&&<div className={`flex-1 h-px ${i+1<step?'bg-[#0A7AFF]':'bg-[#1E2F42]'}`}/>}
          </div>
        ))}
      </div>

      {step===1&&<div>
        <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">בחר לקוח</div>
        {clients.map(c=><div key={c.id} onClick={()=>setSelC(c)}
          className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer transition-all ${selC?.id===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
          <span>{c.emoji}</span><div><div className="font-medium text-sm">{c.name}</div><div className="text-[11px] text-[#6B8FA8]">{c.ad_accounts.length} חשבונות</div></div>
          <div className={`w-4 h-4 rounded-full border ml-auto ${selC?.id===c.id?'border-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[#3D9FFF] text-[10px]':'border-[#2A4158]'}`}>{selC?.id===c.id?'✓':''}</div>
        </div>)}
        {selC&&!selC.selected_ad_account_id&&<Alert type="amber">⚠️ בחר חשבון מודעות ב"לקוחות" תחילה</Alert>}
        <Btn variant="primary" className="mt-3" onClick={()=>setStep(2)} disabled={!selC?.selected_ad_account_id}>הבא →</Btn>
      </div>}

      {step===2&&<div>
        <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">מטרת קמפיין</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {OBJECTIVES.map(o=><div key={o.id} onClick={()=>uc('objective',o.id)}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${c.objective===o.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030] hover:border-[#2A4158]'}`}>
            <span className="text-xl">{o.i}</span><span className="font-medium text-sm">{o.l}</span>
            <div className={`w-4 h-4 rounded-full border ml-auto ${c.objective===o.id?'border-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[#3D9FFF] text-[10px]':'border-[#2A4158]'}`}>{c.objective===o.id?'✓':''}</div>
          </div>)}
        </div>
        <div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(1)}>← חזור</Btn><Btn variant="primary" onClick={()=>setStep(3)} disabled={!c.objective}>הבא →</Btn></div>
      </div>}

      {step===3&&<div>
        <div className="flex gap-2 mb-3">
          {[['DAILY','יומי'],['LIFETIME','כולל']].map(([id,l])=><button key={id} onClick={()=>uc('budgetType',id)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-all ${c.budgetType===id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8]'}`}>{l}</button>)}
        </div>
        <Input label={`תקציב ${c.budgetType==='DAILY'?'יומי':'כולל'} (₪)`} value={c.budget.toString()} onChange={v=>uc('budget',parseInt(v)||50)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="גיל מינימום" value={c.ageMin.toString()} onChange={v=>uc('ageMin',parseInt(v)||18)} />
          <Input label="גיל מקסימום" value={c.ageMax.toString()} onChange={v=>uc('ageMax',parseInt(v)||65)} />
        </div>
        {c.budgetType==='DAILY'&&<Alert type="blue">💡 יומי ₪{c.budget} ≈ ₪{c.budget*30}/חודש</Alert>}
        <div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(2)}>← חזור</Btn><Btn variant="primary" onClick={()=>setStep(4)}>הבא →</Btn></div>
      </div>}

      {step===4&&<div>
        <Input label="שם הקמפיין" value={c.name} onChange={v=>uc('name',v)} placeholder={`קמפיין ${new Date().toLocaleDateString('he')}`} />
        <Input label="כותרת (עד 40 תווים)" value={c.headline} onChange={v=>uc('headline',v)} />
        <div className="mb-3"><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">טקסט ראשי (עד 125)</label>
          <textarea value={c.adText} onChange={e=>uc('adText',e.target.value)} rows={3} maxLength={125}
            className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]" dir="rtl" /></div>
        <div className="mb-4"><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">CTA</label>
          <select value={c.cta} onChange={e=>uc('cta',e.target.value)} className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]" dir="rtl">
            {[['LEARN_MORE','למד עוד'],['CONTACT_US','צור קשר'],['SHOP_NOW','קנה'],['SEND_MESSAGE','שלח הודעה']].map(([v,l])=><option key={v} value={v} className="bg-[#162030]">{l}</option>)}
          </select></div>
        {err&&<Alert type="red">{err}</Alert>}
        <div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(3)}>← חזור</Btn><Btn variant="primary" loading={loading} onClick={create}>🚀 צור קמפיין ב-Meta</Btn></div>
      </div>}

      {step===5&&result&&<div className="text-center py-10">
        <div className="text-5xl mb-4">🎉</div>
        <div className="font-bold text-xl mb-2">הקמפיין נוצר!</div>
        <div className="text-sm text-[#6B8FA8] mb-4">הקמפיין ב-PAUSED — הפעל אותו ב-Meta Ads Manager</div>
        <Alert type="green">Campaign ID: {result.cid}<br/>Ad Set ID: {result.aid}</Alert>
        <a href="https://adsmanager.facebook.com" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 bg-[#0A7AFF] hover:bg-[#3D9FFF] text-white text-sm font-semibold rounded-lg transition-colors">
          פתח ב-Meta Ads Manager →
        </a>
      </div>}
    </div>
  );
}
