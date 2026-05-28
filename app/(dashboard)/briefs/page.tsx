'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, CopyBtn, Tabs, OutputBox, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import type { Brief } from '@/types';
import { clsx } from 'clsx';

const xt = (raw:string,t:string)=>{const m=raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));return m?m[1].trim():'';};

// ─── BRIEF WORKSPACE ─────────────────────────────────────────
function BriefWorkspace({ brief, onBack, onUpdate }: { brief: Brief; onBack: ()=>void; onUpdate: (b:Brief)=>void }) {
  const [tab,  setTab]   = useState('overview');
  const [av,   setAv]    = useState(brief.avatar ?? '');
  const [ads,  setAds]   = useState(brief.ads ?? '');
  const [fn,   setFn]    = useState(brief.funnel ?? '');
  const { call, loading, error } = useAI();
  const v = brief.values;

  const supabase = createClient();

  async function save(field: 'avatar'|'ads'|'funnel', value: string) {
    const upd = { ...brief, [field]: value };
    await supabase.from('briefs').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', brief.id);
    onUpdate(upd);
  }

  async function buildAvatar() {
    const text = await call('avatar',
      `מומחה אווטאר — Alex Hormozi + Eugene Schwartz. בנה פרופיל לקוח מלא.
[AN]שם האווטאר[/AN][AE]אמוג'י[/AE]
[DEMO]דמוגרפיה מפורטת[/DEMO]
[PSYCH]פסיכוגרפיה — ערכים, אמונות, פחדים[/PSYCH]
[MONO]מונולוג פנימי — ציטוטים[/MONO]
[PAIN]כאב חיצוני | כאב פנימי | כאב פילוסופי[/PAIN]
[DREAM]תוצאת החלום המפורטת[/DREAM]
[BA]לפני הפתרון / אחרי הפתרון[/BA]
[OBJ]3 התנגדויות + תשובה לכל אחת[/OBJ]
[AWR]שלב מודעות Schwartz + הסבר[/AWR]
[TRIG]3 טריגרים לרכישה[/TRIG]
[ANGLE]3 זוויות מסר[/ANGLE]
[VEQ]משוואת ערך Hormozi: תוצאה/סבירות/זמן/מאמץ[/VEQ]`,
      `עסק:${v.biz_name}|${v.biz_what}|תוצאה:${v.biz_result}
לקוח:${v.cust_who}|כאב:${v.pain_main}|פנימי:${v.pain_internal}
חלום:${v.desire_dream}|התנגדות:${v.obj_main}|פחד:${v.obj_fear}
מודעות:${v.mkt_awareness}`, 2000);
    if (!text) return;
    setAv(text); await save('avatar', text); setTab('avatar');
  }

  async function buildAds() {
    if (!av) return;
    const text = await call('ads_avatar',
      `קופירייטר ברמת Gary Halbert. 4 מודעות לפי האווטאר.
[ADTF]TOFU קהל קר: Hook + Body + CTA[/ADTF]
[ADMF]MOFU שיקול: Hook + Body + CTA[/ADMF]
[ADBF]BOFU המרה עם עיגון מחיר ודחיפות[/ADBF]
[ADRM]רימרקטינג — מתייחס להתנגדות הראשית[/ADRM]`,
      `אווטאר:${av.substring(0,800)}\nמחיר:${v.offer_price}|עיגון:${v.offer_anchor}|גרנטי:${v.offer_guarantee}|CTA:${v.offer_cta}`, 2000);
    if (!text) return;
    setAds(text); await save('ads', text); setTab('ads');
  }

  async function buildFunnel() {
    if (!av) return;
    const text = await call('funnel',
      `מומחה משפכי שיווק — Russell Brunson + Alex Hormozi.
[FT]סוג משפך מומלץ[/FT][FR]למה[/FR]
[S1]תנועה: מדיה + תוכן + מטרה[/S1]
[S2]דף נחיתה: סוג + כותרת + הצעה[/S2]
[S3]חינוך ואמון: 3 הודעות[/S3]
[S4]הצעה / מכירה: מבנה[/S4]
[S5]Upsell: מה + מחיר[/S5]
[KPI]CPL/CPA/ROAS מומלצים[/KPI]`,
      `עסק:${v.biz_name}|מחיר:${v.offer_price}|קהל:${v.cust_who}|מודעות:${v.mkt_awareness}`, 1800);
    if (!text) return;
    setFn(text); await save('funnel', text); setTab('funnel');
  }

  const pipe = [
    { l:'בריף', done:true },
    { l:'אווטאר', done:!!av },
    { l:'מודעות', done:!!ads },
    { l:'משפך', done:!!fn },
  ];

  const adTypes = [
    { k:'ADTF', l:'TOFU — קהל קר',  c:'#0A7AFF' },
    { k:'ADMF', l:'MOFU — שיקול',   c:'#D97706' },
    { k:'ADBF', l:'BOFU — המרה',    c:'#059669' },
    { k:'ADRM', l:'רימרקטינג',      c:'#6D28D9' },
  ];

  const stages = [
    { k:'S1', l:'תנועה',          n:1, c:'#0A7AFF' },
    { k:'S2', l:'דף נחיתה',       n:2, c:'#D97706' },
    { k:'S3', l:'חינוך ואמון',    n:3, c:'#059669' },
    { k:'S4', l:'הצעה / מכירה',   n:4, c:'#DC2626' },
    { k:'S5', l:'Upsell',         n:5, c:'#6D28D9' },
  ];

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <Btn variant="ghost" size="sm" onClick={onBack}>←</Btn>
          <div>
            <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest">בריף workspace</div>
            <h2 className="text-xl font-bold">{v.biz_name || 'ללא שם'}</h2>
          </div>
        </div>
        <div className="flex gap-2">
          <Btn variant="primary"  size="sm" loading={loading} onClick={buildAvatar}>🧬 אווטאר <CostBadge cost={10} /></Btn>
          <Btn variant="amber"    size="sm" loading={loading} onClick={buildAds}    disabled={!av}>✍️ מודעות <CostBadge cost={8} /></Btn>
          <Btn variant="violet"   size="sm" loading={loading} onClick={buildFunnel} disabled={!av}>🔮 משפך <CostBadge cost={12} /></Btn>
        </div>
      </div>

      {/* Pipeline */}
      <div className="flex items-center gap-2 bg-[#152138] border border-[#243752] rounded-lg px-4 py-3 mb-4 overflow-x-auto">
        {pipe.map((p, i) => (
          <div key={p.l} className="flex items-center gap-2 flex-shrink-0">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${p.done?'bg-[#059669] text-white':'bg-[#22334D] text-[#2E4459]'}`}>
              {p.done ? '✓' : i+1}
            </div>
            <span className={`text-xs font-medium ${p.done?'text-[#059669]':'text-[#2E4459]'}`}>{p.l}</span>
            {i < pipe.length-1 && <span className="text-[#2E4459] text-sm">→</span>}
          </div>
        ))}
      </div>

      {error && <Alert type="red" className="mb-3">❌ {error}</Alert>}

      <Tabs
        tabs={[
          {id:'overview',  label:'📋 סקירה'},
          {id:'avatar',    label:`🧬 אווטאר${av?' ✓':''}`},
          {id:'offer',     label:'💎 הצעה'},
          {id:'ads',       label:`✍️ מודעות${ads?' ✓':''}`},
          {id:'funnel',    label:`🔮 משפך${fn?' ✓':''}`},
        ]}
        active={tab} onChange={setTab}
      />

      {/* Overview */}
      {tab==='overview' && (
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(v).filter(([,val])=>val).map(([k,val])=>(
            <div key={k} className="bg-[#152138] border border-[#243752] rounded-lg p-3">
              <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">{k.replace(/_/g,' ')}</div>
              <div className="text-xs leading-relaxed">{val as string}</div>
            </div>
          ))}
        </div>
      )}

      {/* Avatar */}
      {tab==='avatar' && (av ? (
        <div className="border border-[#243752] rounded-xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#0B1424] to-[#22334D] p-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/5 border-2 border-[#D4AF55] flex items-center justify-center text-2xl">{xt(av,'AE')||'👤'}</div>
            <div>
              <div className="font-bold text-base">{xt(av,'AN')}</div>
              <div className="text-xs text-[#6B8FA8]">Hormozi × Schwartz Framework</div>
            </div>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[['👤','דמוגרפיה','DEMO'],['🧠','פסיכוגרפיה','PSYCH'],['💭','מונולוג פנימי','MONO'],['🔥','כאבים','PAIN'],['⭐','תוצאת החלום','DREAM'],['🔄','לפני/אחרי','BA'],['🚧','התנגדויות','OBJ'],['⚡','טריגרים','TRIG'],['📐','זוויות מסר','ANGLE'],['⚖️','משוואת ערך','VEQ']].map(([ico,lbl,tg])=>{
              const c=xt(av,tg); if(!c)return null;
              return(
                <div key={lbl}>
                  <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">{ico} {lbl}</div>
                  <div className="text-[12.5px] leading-relaxed bg-[#1A2A42] rounded-lg p-2.5">{c}</div>
                </div>
              );
            })}
          </div>
        </div>
      ):<div className="text-center py-12 text-[#2E4459]"><div className="text-4xl mb-3 opacity-30">🧬</div><div className="text-sm mb-4">האווטאר עוד לא נבנה</div><Btn variant="primary" onClick={buildAvatar} loading={loading}>🧬 בנה עכשיו</Btn></div>)}

      {/* Offer */}
      {tab==='offer' && (() => {
        const ap = parseInt((v.offer_anchor||'').replace(/\D/g,''))||0;
        const pp = parseInt((v.offer_price||'').replace(/\D/g,''))||0;
        const disc = ap&&pp ? Math.round((ap-pp)/ap*100) : 0;
        const bonuses = (v.offer_bonuses||'').split(/[,\n]/).filter(b=>b.trim());
        return(
          <div>
            <div className="text-center py-5 border-b border-[#243752] mb-4">
              {ap>0&&<div className="font-mono text-xl text-[#6B8FA8] line-through mb-1">₪{ap.toLocaleString()}</div>}
              <div className="flex items-center justify-center gap-3">
                {pp>0&&<div className="font-mono text-3xl font-medium text-red-400">₪{pp.toLocaleString()}</div>}
                {disc>0&&<div className="bg-[#059669]/10 border border-[#059669]/20 text-[#34D399] text-xs font-bold px-2 py-1 rounded-full">חיסכון {disc}%</div>}
              </div>
            </div>
            {bonuses.length>0&&<div className="border-2 border-[#D4AF55] rounded-xl p-4 mb-4">
              <div className="text-[10px] font-bold text-[#D4AF55] mb-3 uppercase tracking-wider">⭐ Value Stack</div>
              {bonuses.map((b,i)=><div key={i} className="flex justify-between py-1.5 border-b border-[#243752] text-sm"><span>🎁 {b}</span><span className="text-[#D4AF55] font-bold">מתנה</span></div>)}
              <div className="flex justify-between pt-2.5 font-bold text-base"><span>ערך כולל</span><span className="text-[#D4AF55]">{ap?`₪${ap.toLocaleString()}`:'שווה הרבה יותר'}</span></div>
            </div>}
            <div className="grid grid-cols-2 gap-3">
              {v.offer_guarantee&&<Card><CardLabel>🛡 גרנטי</CardLabel><div className="text-sm">{v.offer_guarantee}</div></Card>}
              {v.offer_urgency&&<Card><CardLabel>⏰ דחיפות</CardLabel><div className="text-sm">{v.offer_urgency}</div></Card>}
              {v.offer_cta&&<Card className="col-span-2"><CardLabel>📣 CTA</CardLabel><div className="font-bold text-base text-red-400">{v.offer_cta}</div></Card>}
            </div>
          </div>
        );
      })()}

      {/* Ads */}
      {tab==='ads' && (ads ? (
        adTypes.map(({k,l,c})=>{ const cnt=xt(ads,k); if(!cnt)return null; return(
          <div key={k} className="border border-[#243752] rounded-xl overflow-hidden mb-3">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#243752]">
              <div className="text-[10px] font-bold px-2 py-1 rounded-full uppercase" style={{background:`${c}15`,color:c,border:`1px solid ${c}33`}}>{l}</div>
              <CopyBtn text={cnt} />
            </div>
            <div className="p-4 text-[13px] leading-relaxed whitespace-pre-wrap">{cnt}</div>
          </div>
        );})
      ):<div className="text-center py-12 text-[#2E4459]"><div className="text-4xl mb-3 opacity-30">✍️</div><div className="text-sm mb-4">מודעות עוד לא נבנו</div><Btn variant="amber" onClick={buildAds} loading={loading} disabled={!av}>✍️ בנה מודעות</Btn></div>)}

      {/* Funnel */}
      {tab==='funnel' && (fn ? (
        <div>
          <Card className="mb-4" style={{borderColor:'rgba(184,149,58,.3)'}}>
            <div className="flex items-center gap-3"><span className="text-2xl">🔮</span><div><div className="font-bold text-[#D4AF55]">{xt(fn,'FT')}</div><div className="text-sm text-[#6B8FA8] mt-0.5">{xt(fn,'FR')}</div></div></div>
          </Card>
          {stages.map(({k,l,n,c})=>{ const cnt=xt(fn,k); if(!cnt)return null; return(
            <div key={k} className="mb-0">
              <div className="rounded-xl border p-4" style={{borderColor:`${c}22`,background:`${c}04`}}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{background:c}}>{n}</div>
                  <div className="font-bold text-sm" style={{color:c}}>{l}</div>
                </div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{cnt}</div>
              </div>
              {n<5&&<div className="text-center py-1.5 text-[#2E4459] text-lg">↓</div>}
            </div>
          );})}
          {xt(fn,'KPI')&&<Card className="mt-3" style={{borderColor:'rgba(5,150,105,.3)'}}><CardLabel>📊 KPIs מומלצים</CardLabel><div className="text-[13px] leading-relaxed whitespace-pre-wrap">{xt(fn,'KPI')}</div></Card>}
        </div>
      ):<div className="text-center py-12 text-[#2E4459]"><div className="text-4xl mb-3 opacity-30">🔮</div><div className="text-sm mb-4">משפך עוד לא נבנה</div><Btn variant="violet" onClick={buildFunnel} loading={loading} disabled={!av}>🔮 בנה משפך</Btn></div>)}
    </div>
  );
}

// ─── BRIEFS LIST ─────────────────────────────────────────────
export default function BriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [codes,  setCodes]  = useState<string[]>([]);
  const [sel,    setSel]    = useState<Brief|null>(null);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState('');
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [bRes, cRes] = await Promise.all([
        supabase.from('briefs').select('*').eq('user_id', user.id).order('submitted_at', { ascending: false }),
        supabase.from('brief_codes').select('code').eq('user_id', user.id),
      ]);
      setBriefs(bRes.data ?? []);
      setCodes(cRes.data?.map(r=>r.code) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  async function createCode() {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('users').select('name').eq('id', user.id).single();
    await supabase.from('brief_codes').insert({ code, user_id: user.id, agency_name: profile?.name });
    setCodes(p => [...p, code]);
    setNewCode(code);
  }

  const statusStyle = {
    new:        { bg:'bg-[#0A7AFF]/10', text:'text-[#3D9FFF]', border:'border-[#0A7AFF]/20', label:'חדש' },
    has_avatar: { bg:'bg-[#D97706]/10', text:'text-[#D97706]', border:'border-[#D97706]/20', label:'יש אווטאר' },
    complete:   { bg:'bg-[#059669]/10', text:'text-[#34D399]', border:'border-[#059669]/20', label:'הושלם' },
  };

  // Brief values are stored in `values` JSONB. Compute completion % client-side
  // (mirrors the SQL function brief_completion_pct).
  const BRIEF_FIELDS = [
    'biz_name','biz_what','biz_result','biz_time','biz_price','biz_usp',
    'cust_who','cust_income','pain_main','pain_internal','desire_dream',
    'obj_main','obj_tried','obj_fear','mkt_awareness',
    'offer_anchor','offer_price','offer_bonuses','offer_guarantee','offer_urgency','offer_cta',
  ] as const;
  function completionPct(values: any): number {
    if (!values) return 0;
    const filled = BRIEF_FIELDS.filter(f => String(values[f] ?? '').trim() !== '').length;
    return Math.round((filled * 100) / BRIEF_FIELDS.length);
  }

  if (sel) return <BriefWorkspace brief={sel} onBack={()=>setSel(null)} onUpdate={upd=>{setBriefs(p=>p.map(b=>b.id===upd.id?upd:b)); setSel(upd);}} />;

  return (
    <div>
      <PageHeader eyebrow="בריפים" title="בריפי לקוחות" sub={`${briefs.length} בריפים התקבלו`}
        right={<Btn variant="primary" onClick={createCode}>+ צור קישור בריף</Btn>} />

      {newCode && (
        <Card className="mb-4" style={{borderColor:'rgba(184,149,58,.3)'}}>
          <CardLabel>🔗 קישור חדש נוצר</CardLabel>
          <div className="flex items-center justify-between bg-[#0B1424] border border-[#324C6B] rounded-lg px-4 py-3 mb-3">
            <span className="font-mono text-2xl text-[#D4AF55] tracking-widest">{newCode}</span>
            <CopyBtn text={newCode} label="📋 העתק קוד" />
          </div>
          <Alert type="blue">💡 שלח את הקוד <strong>{newCode}</strong> ללקוח. הוא ייכנס לדף הבריף וימלא את השאלון.</Alert>
        </Card>
      )}

      {codes.length > 0 && (
        <Card className="mb-4">
          <CardLabel>קודים פעילים</CardLabel>
          <div className="flex flex-wrap gap-2">
            {codes.map(c => (
              <button key={c} onClick={()=>navigator.clipboard.writeText(c)}
                className="font-mono text-sm bg-[#1A2A42] border border-[#243752] text-[#6B8FA8] px-3 py-1.5 rounded-lg hover:border-[#324C6B] hover:text-[#D9E8F5] transition-colors">
                {c}
              </button>
            ))}
          </div>
        </Card>
      )}

      {loading && <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}

      {!loading && briefs.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">📋</div>
          <div className="text-base font-semibold mb-2">אין בריפים עדיין</div>
          <div className="text-sm mb-4">צור קישור ושלח ללקוח שלך</div>
          <Btn variant="primary" onClick={createCode}>+ צור קישור ראשון</Btn>
        </div>
      )}

      {briefs.map(b => {
        const st  = statusStyle[b.status] ?? statusStyle.new;
        const pct = completionPct(b.values);
        const pctColor = pct >= 90 ? '#34D399' : pct >= 50 ? '#D97706' : '#6B8FA8';
        return (
          <div key={b.id} onClick={()=>setSel(b)}
            className="flex items-center gap-3 bg-[#152138] border border-[#243752] rounded-xl px-4 py-3 mb-2 cursor-pointer hover:border-[#324C6B] hover:-translate-x-0.5 transition-all">
            <div className="w-9 h-9 rounded-lg bg-[#22334D] flex items-center justify-center text-lg">🏢</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-semibold text-sm">{b.values?.biz_name || 'ללא שם'}</span>
                <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-full border"
                  style={{ background:`${pctColor}15`, color: pctColor, borderColor: `${pctColor}40` }}>
                  בריפינג {pct}%
                </span>
              </div>
              <div className="text-xs text-[#2E4459] truncate">
                {(b.values?.biz_what || '').substring(0, 60)} · {new Date(b.submitted_at).toLocaleDateString('he')}
              </div>
              <div className="mt-1.5 h-1 bg-[#22334D] rounded-full overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${pct}%`, background: pctColor }} />
              </div>
            </div>
            <div className={clsx('text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0', st.bg, st.text, st.border)}>
              {st.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
