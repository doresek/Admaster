'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, Textarea, Btn, OutputBox, Tabs, CopyBtn, CostBadge, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';

const xt = (raw:string,t:string)=>{const m=raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));return m?m[1].trim():'';};

const HOLIDAYS = [
  {name:'שבועות',    date:'2026-05-22',emoji:'📜'},
  {name:'ראש השנה', date:'2026-09-11',emoji:'🍎'},
  {name:'יום כיפור',date:'2026-09-20',emoji:'🕯️'},
  {name:'סוכות',    date:'2026-09-25',emoji:'🌿'},
  {name:'חנוכה',    date:'2026-12-04',emoji:'🕎'},
  {name:'פורים',    date:'2027-03-02',emoji:'🎭'},
  {name:'פסח',      date:'2027-04-01',emoji:'🍷'},
  {name:'בר מצווה', date:'2026-04-01',emoji:'✡️'},
];

export default function CalendarPage() {
  const [sel,  setSel]  = useState<{name:string;emoji:string}|null>(null);
  const [tab,  setTab]  = useState('post');
  const [out,  setOut]  = useState<{post:string;hashtags:string[];campaign:string}|null>(null);
  const { call, loading, error } = useAI();
  const today = new Date();

  async function gen(h: {name:string;emoji:string}) {
    setSel(h); setOut(null); setTab('post');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('users').select('brand').eq('id', user.id).single();
    const biz = (profile?.brand as any)?.name || 'תפילין ומזוזות';

    const text = await call('holiday',
      `שיווק דיגיטלי לעסקי יודאיקה — ${biz}.
[POST]פוסט חג מקצועי עם אמוג'ים[/POST]
[HASHTAGS]12 האשטגים רלוונטיים[/HASHTAGS]
[CAMPAIGN]רעיון קמפיין שלם לחג: מטרה, קהל, תקציב, מסר[/CAMPAIGN]`,
      `חג: ${h.name}`);
    if (!text) return;
    setOut({ post:xt(text,'POST'), hashtags:xt(text,'HASHTAGS').split(/\s+/).filter(x=>x.startsWith('#')), campaign:xt(text,'CAMPAIGN') });
  }

  return (
    <div>
      <PageHeader eyebrow="לוח שנה" title="לוח חגים ישראלי" sub="לחץ על חג לייצור פוסט + קמפיין" right={<CostBadge cost={3} />} />

      <div className="grid grid-cols-4 gap-3 mb-6">
        {HOLIDAYS.map(h => {
          const days = Math.ceil((new Date(h.date).getTime()-today.getTime())/86400000);
          const past = days < 0;
          const soon = days > 0 && days <= 45;
          return (
            <div key={h.name} onClick={() => !past && gen(h)}
              className={`rounded-xl border p-3.5 transition-all ${past?'opacity-40 cursor-default':'cursor-pointer hover:-translate-y-0.5'} ${soon?'border-[#D97706]/35 bg-[#D97706]/08':sel?.name===h.name?'border-[#0A7AFF]':'border-[#243752] bg-[#152138] hover:border-[#324C6B]'}`}>
              <div className="text-2xl mb-2">{h.emoji}</div>
              <div className="font-bold text-sm">{h.name}</div>
              <div className="text-[11px] mt-1" style={{color:soon?'#D97706':'#2E4459'}}>
                {past?'עבר':days===0?'היום!':soon?`⚡ ${days} ימים`:`${days} ימים`}
              </div>
            </div>
          );
        })}
      </div>

      {loading && <div className="flex items-center justify-center py-8 gap-3 text-[#6B8FA8]"><div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"/><span className="text-sm">מייצר תוכן ל{sel?.name}...</span></div>}
      {error && <Alert type="red">❌ {error}</Alert>}

      {out && sel && (
        <Card style={{borderColor:'rgba(217,119,6,.3)'}}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold">{sel.emoji} {sel.name}</div>
            <button onClick={() => { setOut(null); setSel(null); }} className="text-[#2E4459] hover:text-[#6B8FA8] text-lg">✕</button>
          </div>
          <Tabs tabs={[{id:'post',label:'📝 פוסט'},{id:'hashtags',label:'# האשטגים'},{id:'campaign',label:'🚀 קמפיין'}]} active={tab} onChange={setTab} />
          {tab==='post' && <><OutputBox text={out.post} /><CopyBtn text={out.post+'\n\n'+out.hashtags.join(' ')} /></>}
          {tab==='hashtags' && <div className="flex flex-wrap gap-2">{out.hashtags.map((h,i)=><span key={i} className="bg-[#0A7AFF]/10 border border-[#0A7AFF]/20 text-[#3D9FFF] px-3 py-1 rounded-full text-sm">{h}</span>)}</div>}
          {tab==='campaign' && <OutputBox text={out.campaign} />}
        </Card>
      )}
    </div>
  );
}
