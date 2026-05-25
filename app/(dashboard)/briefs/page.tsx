'use client';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, CopyBtn, Tabs, OutputBox, Alert, PageHeader, CostBadge } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import type { Brief, AvatarV2, AvatarV2Meta } from '@/types';
import { clsx } from 'clsx';

const xt = (raw:string,t:string)=>{const m=raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));return m?m[1].trim():'';};

// ─── BRIEF WORKSPACE ─────────────────────────────────────────
function BriefWorkspace({ brief, onBack, onUpdate }: { brief: Brief; onBack: ()=>void; onUpdate: (b:Brief)=>void }) {
  const [tab,  setTab]   = useState('overview');
  const [av,   setAv]    = useState(brief.avatar ?? '');
  const [ads,  setAds]   = useState(brief.ads ?? '');
  const [fn,   setFn]    = useState(brief.funnel ?? '');
  const [avV2, setAvV2]  = useState<AvatarV2     | null>(brief.avatar_v2      ?? null);
  const [avV2Meta, setAvV2Meta] = useState<AvatarV2Meta | null>(brief.avatar_v2_meta ?? null);
  const [v2Loading, setV2Loading] = useState(false);
  const [v2Error,   setV2Error]   = useState<string | null>(null);
  const { call, loading, error } = useAI();
  const v = brief.values;

  const supabase = createClient();

  async function save(field: 'avatar'|'ads'|'funnel', value: string) {
    const upd = { ...brief, [field]: value };
    await supabase.from('briefs').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', brief.id);
    onUpdate(upd);
  }

  async function buildAvatarV2() {
    if (v2Loading) return;
    setV2Loading(true); setV2Error(null);
    try {
      const res = await fetch('/api/avatars/generate-v2', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ briefId: brief.id, language: 'he' }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error === 'insufficient_credits'
          ? 'אין מספיק קרדיטים (נדרש 20)'
          : data.error || `שגיאה ${res.status}`;
        throw new Error(msg);
      }
      setAvV2(data.avatar);
      setAvV2Meta(data.meta);
      onUpdate({
        ...brief,
        avatar_v2:           data.avatar,
        avatar_v2_meta:      data.meta,
        avatar_generated_at: new Date().toISOString(),
      });
      setTab('avatar');
    } catch (e: any) {
      setV2Error(e?.message || 'שגיאה');
    } finally {
      setV2Loading(false);
    }
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
    { l:'בריף',   done:true },
    { l:'אווטאר', done:!!av || !!avV2 },
    { l:'מודעות', done:!!ads },
    { l:'משפך',   done:!!fn },
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
          <Btn variant="primary"  size="sm" loading={loading}   onClick={buildAvatar}>🧬 אווטאר <CostBadge cost={10} /></Btn>
          <Btn variant="gold"     size="sm" loading={v2Loading} onClick={buildAvatarV2}>🧬+ V2 <CostBadge cost={20} /></Btn>
          <Btn variant="amber"    size="sm" loading={loading}   onClick={buildAds}    disabled={!av}>✍️ מודעות <CostBadge cost={8} /></Btn>
          <Btn variant="violet"   size="sm" loading={loading}   onClick={buildFunnel} disabled={!av}>🔮 משפך <CostBadge cost={12} /></Btn>
        </div>
      </div>

      {/* Pipeline */}
      <div className="flex items-center gap-2 bg-[#111A24] border border-[#1E2F42] rounded-lg px-4 py-3 mb-4 overflow-x-auto">
        {pipe.map((p, i) => (
          <div key={p.l} className="flex items-center gap-2 flex-shrink-0">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${p.done?'bg-[#059669] text-white':'bg-[#1D2D3E] text-[#2E4459]'}`}>
              {p.done ? '✓' : i+1}
            </div>
            <span className={`text-xs font-medium ${p.done?'text-[#059669]':'text-[#2E4459]'}`}>{p.l}</span>
            {i < pipe.length-1 && <span className="text-[#2E4459] text-sm">→</span>}
          </div>
        ))}
      </div>

      {error   && <Alert type="red" className="mb-3">❌ {error}</Alert>}
      {v2Error && <Alert type="red" className="mb-3">❌ V2: {v2Error}</Alert>}

      <Tabs
        tabs={[
          {id:'overview',  label:'📋 סקירה'},
          {id:'avatar',    label:`🧬 אווטאר${avV2?' ✓ V2':av?' ✓':''}`},
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
            <div key={k} className="bg-[#111A24] border border-[#1E2F42] rounded-lg p-3">
              <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">{k.replace(/_/g,' ')}</div>
              <div className="text-xs leading-relaxed">{val as string}</div>
            </div>
          ))}
        </div>
      )}

      {/* Avatar — prefer v2 (rich JSON), fallback to v1 (tagged text) */}
      {tab==='avatar' && (avV2 ? (
        <AvatarV2View avatar={avV2} meta={avV2Meta} />
      ) : av ? (
        <div className="border border-[#1E2F42] rounded-xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#070A0E] to-[#1D2D3E] p-4 flex items-center gap-3">
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
                  <div className="text-[12.5px] leading-relaxed bg-[#162030] rounded-lg p-2.5">{c}</div>
                </div>
              );
            })}
          </div>
        </div>
      ):(
        <div className="text-center py-12 text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">🧬</div>
          <div className="text-sm mb-4">האווטאר עוד לא נבנה</div>
          <div className="flex items-center justify-center gap-2">
            <Btn variant="primary" onClick={buildAvatar}   loading={loading}>🧬 v1 <CostBadge cost={10} /></Btn>
            <Btn variant="gold"    onClick={buildAvatarV2} loading={v2Loading}>🧬+ V2 <CostBadge cost={20} /></Btn>
          </div>
        </div>
      ))}

      {/* Offer */}
      {tab==='offer' && (() => {
        const ap = parseInt((v.offer_anchor||'').replace(/\D/g,''))||0;
        const pp = parseInt((v.offer_price||'').replace(/\D/g,''))||0;
        const disc = ap&&pp ? Math.round((ap-pp)/ap*100) : 0;
        const bonuses = (v.offer_bonuses||'').split(/[,\n]/).filter(b=>b.trim());
        return(
          <div>
            <div className="text-center py-5 border-b border-[#1E2F42] mb-4">
              {ap>0&&<div className="font-mono text-xl text-[#6B8FA8] line-through mb-1">₪{ap.toLocaleString()}</div>}
              <div className="flex items-center justify-center gap-3">
                {pp>0&&<div className="font-mono text-3xl font-medium text-red-400">₪{pp.toLocaleString()}</div>}
                {disc>0&&<div className="bg-[#059669]/10 border border-[#059669]/20 text-[#34D399] text-xs font-bold px-2 py-1 rounded-full">חיסכון {disc}%</div>}
              </div>
            </div>
            {bonuses.length>0&&<div className="border-2 border-[#D4AF55] rounded-xl p-4 mb-4">
              <div className="text-[10px] font-bold text-[#D4AF55] mb-3 uppercase tracking-wider">⭐ Value Stack</div>
              {bonuses.map((b,i)=><div key={i} className="flex justify-between py-1.5 border-b border-[#1E2F42] text-sm"><span>🎁 {b}</span><span className="text-[#D4AF55] font-bold">מתנה</span></div>)}
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
          <div key={k} className="border border-[#1E2F42] rounded-xl overflow-hidden mb-3">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1E2F42]">
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

// ─── AVATAR V2 VIEW ──────────────────────────────────────────
const AWARENESS_HE: Record<AvatarV2['awareness_level'], string> = {
  unaware:         'לא מודע',
  problem_aware:   'מודע לבעיה',
  solution_aware:  'מודע לפתרון',
  product_aware:   'מודע למוצר',
  most_aware:      'מודע מלא',
};

function AvatarV2View({ avatar, meta }: { avatar: AvatarV2; meta: AvatarV2Meta | null }) {
  const a = avatar;
  const scores = meta?.scores ?? null;

  const ChipList = ({ items, color }: { items: string[]; color: string }) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <span key={i}
          className="text-[12px] leading-snug px-2.5 py-1.5 rounded-lg"
          style={{ background: `${color}10`, border: `1px solid ${color}33`, color }}>
          {t}
        </span>
      ))}
    </div>
  );

  return (
    <div className="border border-[#1E2F42] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#070A0E] to-[#1D2D3E] p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-white/5 border-2 border-[#D4AF55] flex items-center justify-center text-2xl">👤</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-bold text-base">{a.name}</div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#D4AF55]/15 text-[#D4AF55] border border-[#D4AF55]/30">V2</span>
            {meta?.refined && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#059669]/15 text-[#34D399] border border-[#059669]/30">refined</span>}
          </div>
          <div className="text-xs text-[#6B8FA8] mt-0.5">
            {a.age} · {a.occupation} · {a.location}
          </div>
        </div>
      </div>

      {/* Scores strip */}
      {scores && (
        <div className="bg-[#0C1520] border-b border-[#1E2F42] px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
          {(['specificity','voice','consistency','usefulness','originality'] as const).map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="text-[#2E4459] uppercase tracking-wider">{k}</span>
              <span className={clsx(
                'font-mono font-bold',
                scores[k] >= 8 ? 'text-[#34D399]' :
                scores[k] >= 6 ? 'text-[#D4AF55]' :
                                 'text-rose-400',
              )}>
                {scores[k]}/10
              </span>
            </div>
          ))}
          {typeof meta?.research_snippet_count === 'number' && (
            <div className="text-[#6B8FA8]">🔎 {meta.research_snippet_count} מקורות</div>
          )}
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Demographics + Psychographics */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">👤 דמוגרפיה</div>
            <div className="text-[12.5px] leading-relaxed bg-[#162030] rounded-lg p-2.5">
              {a.demographics_summary}
              <div className="text-[11px] text-[#6B8FA8] mt-1.5">
                {a.income_range && <>הכנסה: {a.income_range}<br/></>}
                {a.family_status && <>סטטוס: {a.family_status}</>}
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">🧠 פסיכוגרפיה</div>
            <div className="text-[12.5px] leading-relaxed bg-[#162030] rounded-lg p-2.5">{a.psychographics_summary}</div>
          </div>
        </div>

        {/* Pains / Desires */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">🔥 כאבים</div>
            <ChipList items={a.pains} color="#DC2626" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">⭐ רצונות</div>
            <ChipList items={a.desires} color="#059669" />
          </div>
        </div>

        {/* Fears / Status */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">⚠️ פחדים</div>
            <ChipList items={a.fears} color="#D97706" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">👑 רווחי סטטוס</div>
            <ChipList items={a.status_gains} color="#6D28D9" />
          </div>
        </div>

        {/* Voice quotes */}
        {a.voice_quotes?.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">💭 קול הלקוח</div>
            <div className="space-y-1.5">
              {a.voice_quotes.map((q, i) => (
                <div key={i} className="text-[12.5px] leading-relaxed bg-[#162030] border-r-2 border-[#D4AF55] rounded-lg px-3 py-2 italic">
                  „{q}"
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Daily routine */}
        {a.daily_routine && (
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">📅 יום ביומו</div>
            <div className="text-[12.5px] leading-relaxed bg-[#162030] rounded-lg p-2.5">{a.daily_routine}</div>
          </div>
        )}

        {/* JTBD */}
        {a.jobs_to_be_done && (
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">🎯 Jobs-to-be-Done</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#162030] rounded-lg p-2.5"><div className="text-[10px] text-[#6B8FA8] mb-0.5">פונקציונלי</div><div className="text-[12.5px]">{a.jobs_to_be_done.functional}</div></div>
              <div className="bg-[#162030] rounded-lg p-2.5"><div className="text-[10px] text-[#6B8FA8] mb-0.5">רגשי</div><div className="text-[12.5px]">{a.jobs_to_be_done.emotional}</div></div>
              <div className="bg-[#162030] rounded-lg p-2.5"><div className="text-[10px] text-[#6B8FA8] mb-0.5">חברתי</div><div className="text-[12.5px]">{a.jobs_to_be_done.social}</div></div>
              <div className="bg-[#162030] rounded-lg p-2.5"><div className="text-[10px] text-[#6B8FA8] mb-0.5">המתחרה הנוכחי</div><div className="text-[12.5px]">{a.jobs_to_be_done.old_hire}</div></div>
            </div>
          </div>
        )}

        {/* Awareness + Sophistication */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#162030] rounded-lg p-3">
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">📡 רמת מודעות (שוורץ)</div>
            <div className="text-[13px] font-bold text-[#3D9FFF]">{AWARENESS_HE[a.awareness_level] ?? a.awareness_level}</div>
            <div className="text-[12px] text-[#D9E8F5] mt-1 leading-relaxed">{a.awareness_strategy}</div>
          </div>
          <div className="bg-[#162030] rounded-lg p-3">
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1">📊 תחכום שוק</div>
            <div className="text-[13px] font-bold text-[#D4AF55]">רמה {a.market_sophistication_level}/5</div>
            <div className="text-[12px] text-[#D9E8F5] mt-1 leading-relaxed">{a.recommended_angle}</div>
          </div>
        </div>

        {/* Objections + Buying triggers */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">🚧 התנגדויות</div>
            <ChipList items={a.objections} color="#0A7AFF" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">⚡ טריגרים לרכישה</div>
            <ChipList items={a.buying_triggers} color="#D4AF55" />
          </div>
        </div>

        {/* Channels + Creative angles */}
        <div className="grid grid-cols-2 gap-3">
          {a.channels?.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">📺 ערוצים</div>
              <ChipList items={a.channels} color="#6B8FA8" />
            </div>
          )}
          {a.recommended_creative_angles?.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-[#2E4459] uppercase mb-1.5">📐 זוויות מסר מומלצות</div>
              <ChipList items={a.recommended_creative_angles} color="#059669" />
            </div>
          )}
        </div>

        {meta?.critique_summary && (
          <div className="text-[11px] text-[#6B8FA8] border-t border-[#1E2F42] pt-3">
            ⚙️ {meta.critique_summary} · {meta.total_time_ms ? `${(meta.total_time_ms/1000).toFixed(1)}s` : ''}
          </div>
        )}
      </div>
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
  const [showCreate, setShowCreate] = useState(false);
  const supabase = createClient();

  async function loadBriefs() {
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

  useEffect(() => { loadBriefs(); }, []);

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

  if (sel) return <BriefWorkspace brief={sel} onBack={()=>setSel(null)} onUpdate={upd=>{setBriefs(p=>p.map(b=>b.id===upd.id?upd:b)); setSel(upd);}} />;

  return (
    <div>
      <PageHeader eyebrow="בריפים" title="בריפי לקוחות" sub={`${briefs.length} בריפים התקבלו`}
        right={
          <>
            <Btn variant="ghost" size="sm" onClick={createCode}>+ קוד 6 ספרות</Btn>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-[13px] font-semibold transition shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
            >
              <span>צור בריף ללקוח חדש</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </>
        } />

      {newCode && (
        <Card className="mb-4" style={{borderColor:'rgba(184,149,58,.3)'}}>
          <CardLabel>🔗 קישור חדש נוצר</CardLabel>
          <div className="flex items-center justify-between bg-[#070A0E] border border-[#2A4158] rounded-lg px-4 py-3 mb-3">
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
                className="font-mono text-sm bg-[#162030] border border-[#1E2F42] text-[#6B8FA8] px-3 py-1.5 rounded-lg hover:border-[#2A4158] hover:text-[#D9E8F5] transition-colors">
                {c}
              </button>
            ))}
          </div>
        </Card>
      )}

      {loading && <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" /></div>}

      {!loading && briefs.length === 0 && (
        <div className="text-center py-16 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">📋</div>
          <div className="text-base font-semibold mb-2">אין בריפים עדיין</div>
          <div className="text-sm mb-4">צור קישור ושלח ללקוח שלך</div>
          <Btn variant="primary" onClick={createCode}>+ צור קישור ראשון</Btn>
        </div>
      )}

      {briefs.map(b => {
        const st = statusStyle[b.status] ?? statusStyle.new;
        return (
          <div key={b.id} onClick={()=>setSel(b)}
            className="flex items-center gap-3 bg-[#111A24] border border-[#1E2F42] rounded-xl px-4 py-3 mb-2 cursor-pointer hover:border-[#2A4158] hover:-translate-x-0.5 transition-all">
            <div className="w-9 h-9 rounded-lg bg-[#1D2D3E] flex items-center justify-center text-lg">🏢</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{b.values?.biz_name || 'ללא שם'}</div>
              <div className="text-xs text-[#2E4459] truncate mt-0.5">
                {(b.values?.biz_what || '').substring(0, 60)} · {new Date(b.submitted_at).toLocaleDateString('he')}
              </div>
            </div>
            <div className={clsx('text-[10px] font-bold px-2.5 py-1 rounded-full border', st.bg, st.text, st.border)}>
              {st.label}
            </div>
          </div>
        );
      })}

      {showCreate && (
        <CreateBriefDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { loadBriefs(); }}
        />
      )}
    </div>
  );
}

// ─── CREATE BRIEF DIALOG (tokenized v2) ──────────────────────
function CreateBriefDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clientName, setClientName]   = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [result, setResult]           = useState<{ url: string; whatsapp_url: string | null } | null>(null);
  const [err, setErr]                 = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const cardRef       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => firstInputRef.current?.focus(), 30);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientName.trim() || submitting) return;
    setSubmitting(true); setErr(null);
    try {
      const res = await fetch('/api/briefs/create-tokenized', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name:  clientName.trim(),
          client_phone: clientPhone.trim() || undefined,
          client_email: clientEmail.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `שגיאה ${res.status}`);
      setResult({ url: data.url, whatsapp_url: data.whatsapp_url });
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'שגיאה ביצירת הקישור');
    } finally {
      setSubmitting(false);
    }
  }

  function copyUrl() {
    if (!result) return;
    navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-brief-title"
      dir="rtl"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={submitting ? undefined : onClose}
        aria-hidden="true"
      />

      <div
        ref={cardRef}
        className="relative bg-white border border-stone-200 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        {result ? (
          <div className="p-7">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">✓</div>
              <h2 id="create-brief-title" className="font-serif text-2xl text-stone-900">הקישור מוכן</h2>
            </div>
            <p className="text-stone-500 text-sm mb-5">
              שלח את הקישור ללקוח. הוא יוכל למלא את הבריף בנוחות.
            </p>

            <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 mb-5">
              <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">קישור הבריף</div>
              <div className="font-mono text-[12.5px] text-stone-700 break-all leading-relaxed" dir="ltr">
                {result.url}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              <button
                type="button"
                onClick={copyUrl}
                className="px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-900 text-sm font-medium transition"
              >
                {copied ? '✓ הועתק!' : '📋 העתק קישור'}
              </button>
              {result.whatsapp_url && (
                <a
                  href={result.whatsapp_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition inline-flex items-center gap-2"
                >
                  💬 שתף ב-WhatsApp
                </a>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-stone-100">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium transition shadow-sm"
              >
                סיום
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="p-7">
            <h2 id="create-brief-title" className="font-serif text-2xl text-stone-900 mb-1">בריף חדש ללקוח</h2>
            <p className="text-stone-500 text-sm mb-6">
              נצור קישור ייחודי ללקוח, תוכל לשלוח לו ב-WhatsApp או להעתיק.
            </p>

            <label className="block mb-4">
              <span className="block text-[13px] text-stone-700 font-medium mb-1.5">
                שם הלקוח <span className="text-amber-700">*</span>
              </span>
              <input
                ref={firstInputRef}
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-stone-900 focus:ring-2 focus:ring-stone-900/5 outline-none transition"
                dir="rtl"
              />
            </label>

            <label className="block mb-4">
              <span className="block text-[13px] text-stone-700 font-medium mb-1.5">טלפון</span>
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="0501234567"
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-stone-900 focus:ring-2 focus:ring-stone-900/5 outline-none transition"
                dir="ltr"
              />
            </label>

            <label className="block mb-5">
              <span className="block text-[13px] text-stone-700 font-medium mb-1.5">אימייל</span>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="client@example.com"
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-stone-900 focus:ring-2 focus:ring-stone-900/5 outline-none transition"
                dir="ltr"
              />
            </label>

            {err && (
              <div className="mb-4 text-rose-700 text-sm bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
                {err}
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2.5 text-stone-600 hover:text-stone-900 text-sm font-medium transition disabled:opacity-50"
              >
                ביטול
              </button>
              <button
                type="submit"
                disabled={!clientName.trim() || submitting}
                className="px-6 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
              >
                {submitting ? 'יוצר...' : 'צור קישור'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
