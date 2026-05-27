'use client';
import { useState } from 'react';
import { Card, Input, Btn, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useMetaClients } from '@/lib/hooks/useMetaClients';
import type { MetaClient } from '@/types';

const OBJECTIVES = [
  {id:'OUTCOME_AWARENESS',l:'מודעות למותג',i:'👁'},
  {id:'OUTCOME_TRAFFIC',  l:'תנועה לאתר', i:'🖱'},
  {id:'OUTCOME_LEADS',    l:'לידים',       i:'📋'},
  {id:'OUTCOME_SALES',    l:'מכירות',      i:'💰'},
  {id:'OUTCOME_ENGAGEMENT',l:'מעורבות',    i:'❤️'},
];

export default function CampaignPage() {
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
      <div className="flex items-center gap-2 mb-6 pb-5 border-b border-[#243752]">
        {STEPS.map((s,i)=>(
          <div key={s} className="flex items-center gap-2 flex-1">
            <div onClick={()=>i+1<step&&setStep(i+1)}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${i+1<step?'bg-[#059669] text-white cursor-pointer':i+1===step?'bg-[#0A7AFF] text-white':'bg-[#22334D] text-[#2E4459]'}`}>
              {i+1<step?'✓':i+1}
            </div>
            <span className={`text-xs font-medium whitespace-nowrap ${i+1===step?'text-[#3D9FFF]':'text-[#2E4459]'}`}>{s}</span>
            {i<STEPS.length-1&&<div className={`flex-1 h-px ${i+1<step?'bg-[#0A7AFF]':'bg-[#243752]'}`}/>}
          </div>
        ))}
      </div>

      {step===1&&<div>
        <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">בחר לקוח</div>
        {clients.map(c=><div key={c.id} onClick={()=>setSelC(c)}
          className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer transition-all ${selC?.id===c.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#243752] bg-[#1A2A42] hover:border-[#324C6B]'}`}>
          <span>{c.emoji}</span><div><div className="font-medium text-sm">{c.name}</div><div className="text-[11px] text-[#6B8FA8]">{c.ad_accounts.length} חשבונות</div></div>
          <div className={`w-4 h-4 rounded-full border ml-auto ${selC?.id===c.id?'border-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[#3D9FFF] text-[10px]':'border-[#324C6B]'}`}>{selC?.id===c.id?'✓':''}</div>
        </div>)}
        {selC&&!selC.selected_ad_account_id&&<Alert type="amber">⚠️ בחר חשבון מודעות ב"לקוחות" תחילה</Alert>}
        <Btn variant="primary" className="mt-3" onClick={()=>setStep(2)} disabled={!selC?.selected_ad_account_id}>הבא →</Btn>
      </div>}

      {step===2&&<div>
        <div className="text-xs font-bold text-[#2E4459] uppercase tracking-wider mb-3">מטרת קמפיין</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {OBJECTIVES.map(o=><div key={o.id} onClick={()=>uc('objective',o.id)}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${c.objective===o.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#243752] bg-[#1A2A42] hover:border-[#324C6B]'}`}>
            <span className="text-xl">{o.i}</span><span className="font-medium text-sm">{o.l}</span>
            <div className={`w-4 h-4 rounded-full border ml-auto ${c.objective===o.id?'border-[#3D9FFF] bg-[#0A7AFF]/20 flex items-center justify-center text-[#3D9FFF] text-[10px]':'border-[#324C6B]'}`}>{c.objective===o.id?'✓':''}</div>
          </div>)}
        </div>
        <div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(1)}>← חזור</Btn><Btn variant="primary" onClick={()=>setStep(3)} disabled={!c.objective}>הבא →</Btn></div>
      </div>}

      {step===3&&<div>
        <div className="flex gap-2 mb-3">
          {[['DAILY','יומי'],['LIFETIME','כולל']].map(([id,l])=><button key={id} onClick={()=>uc('budgetType',id)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-all ${c.budgetType===id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#243752] bg-[#1A2A42] text-[#6B8FA8]'}`}>{l}</button>)}
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
            className="w-full bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]" dir="rtl" /></div>
        <div className="mb-4"><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">CTA</label>
          <select value={c.cta} onChange={e=>uc('cta',e.target.value)} className="w-full bg-[#1A2A42] border border-[#243752] rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-[#0A7AFF]" dir="rtl">
            {[['LEARN_MORE','למד עוד'],['CONTACT_US','צור קשר'],['SHOP_NOW','קנה'],['SEND_MESSAGE','שלח הודעה']].map(([v,l])=><option key={v} value={v} className="bg-[#1A2A42]">{l}</option>)}
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
