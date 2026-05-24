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

const OBJECTIVES = [
  {id:'OUTCOME_AWARENESS',l:'מודעות',i:'👁'},{id:'OUTCOME_TRAFFIC',l:'תנועה',i:'🖱'},
  {id:'OUTCOME_LEADS',l:'לידים',i:'📋'},{id:'OUTCOME_SALES',l:'מכירות',i:'💰'},{id:'OUTCOME_ENGAGEMENT',l:'מעורבות',i:'❤️'},
];

export default function CampaignPage() {
  const clients = useMetaClients();
  const [step, setStep] = useState(1);
  const [selC, setSelC] = useState<MetaClient|null>(null);
  const [c, setC] = useState({ name:'', objective:'', budget:50, budgetType:'DAILY', ageMin:25, ageMax:65, headline:'', adText:'', cta:'LEARN_MORE' });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{cid:string;aid:string}|null>(null);
  const [err, setErr] = useState('');
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

  if (clients.length===0) return <div><PageHeader eyebrow="Meta Ads" title="בנה קמפיין" /><Alert type="amber">⚠️ הוסף לקוח Meta תחילה</Alert></div>;

  const STEPS = ['לקוח','מטרה','תקציב','קריאייטיב','✅'];
  return (
    <div>
      <PageHeader eyebrow="Meta Ads" title="בנה קמפיין" right={<CostBadge cost={15} />} />
      <div className="flex items-center gap-2 mb-6 pb-5 border-b border-[#1E2F42]">
        {STEPS.map((s,i)=>(
          <div key={s} className="flex items-center gap-2 flex-1">
            <div onClick={()=>i+1<step&&setStep(i+1)} className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i+1<step?'bg-[#059669] text-white cursor-pointer':i+1===step?'bg-[#0A7AFF] text-white':'bg-[#1D2D3E] text-[#2E4459]'}`}>{i+1<step?'✓':i+1}</div>
            <span className={`text-xs font-medium whitespace-nowrap ${i+1===step?'text-[#3D9FFF]':'text-[#2E4459]'}`}>{s}</span>
            {i<STEPS.length-1&&<div className={`flex-1 h-px ${i+1<step?'bg-[#0A7AFF]':'bg-[#1E2F42]'}`}/>}
          </div>
        ))}
      </div>
      {step===1&&<div>{clients.map(cl=><div key={cl.id} onClick={()=>setSelC(cl)} className={`flex items-center gap-3 p-3 rounded-lg border mb-2 cursor-pointer ${selC?.id===cl.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030]'}`}><span>{cl.emoji}</span><div><div className="font-medium text-sm">{cl.name}</div></div></div>)}<Btn variant="primary" className="mt-3" onClick={()=>setStep(2)} disabled={!selC?.selected_ad_account_id}>הבא →</Btn></div>}
      {step===2&&<div><div className="grid grid-cols-2 gap-2 mb-4">{OBJECTIVES.map(o=><div key={o.id} onClick={()=>uc('objective',o.id)} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${c.objective===o.id?'border-[#0A7AFF] bg-[#0A7AFF]/10':'border-[#1E2F42] bg-[#162030]'}`}><span>{o.i}</span><span className="text-sm">{o.l}</span></div>)}</div><div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(1)}>←</Btn><Btn variant="primary" onClick={()=>setStep(3)} disabled={!c.objective}>הבא →</Btn></div></div>}
      {step===3&&<div><div className="flex gap-2 mb-3">{[['DAILY','יומי'],['LIFETIME','כולל']].map(([id,l])=><button key={id} onClick={()=>uc('budgetType',id)} className={`px-3 py-1.5 rounded-full text-xs border ${c.budgetType===id?'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]':'border-[#1E2F42] bg-[#162030] text-[#6B8FA8]'}`}>{l}</button>)}</div><Input label="תקציב (₪)" value={c.budget.toString()} onChange={v=>uc('budget',parseInt(v)||50)} /><div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(2)}>←</Btn><Btn variant="primary" onClick={()=>setStep(4)}>הבא →</Btn></div></div>}
      {step===4&&<div><Input label="שם קמפיין" value={c.name} onChange={v=>uc('name',v)} /><Input label="כותרת" value={c.headline} onChange={v=>uc('headline',v)} /><div className="mb-3"><label className="block text-xs font-medium text-[#6B8FA8] mb-1.5">טקסט</label><textarea value={c.adText} onChange={e=>uc('adText',e.target.value)} rows={3} className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-white outline-none" dir="rtl"/></div>{err&&<Alert type="red">{err}</Alert>}<div className="flex gap-2"><Btn variant="ghost" onClick={()=>setStep(3)}>←</Btn><Btn variant="primary" loading={loading} onClick={create}>🚀 צור</Btn></div></div>}
      {step===5&&result&&<div className="text-center py-10"><div className="text-5xl mb-4">🎉</div><div className="font-bold text-xl mb-2">הקמפיין נוצר!</div><Alert type="green">Campaign ID: {result.cid}</Alert></div>}
    </div>
  );
}
