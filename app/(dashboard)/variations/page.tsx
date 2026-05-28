'use client';
import { useEffect, useState } from 'react';
import { Card, CardLabel, Chip, Textarea, Btn, CopyBtn, CostBadge, Alert, PageHeader } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';
import { clsx } from 'clsx';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScorePanel } from '@/components/ScorePanel';
import { BoostButton } from '@/components/BoostButton';
import { TopFiveFilter } from '@/components/TopFiveFilter';
import type { ScoreResult } from '@/lib/scoring';

const PLATFORMS = [{ id:'facebook',l:'Facebook',i:'📘'},{id:'instagram',l:'Instagram',i:'📸'},{id:'whatsapp',l:'WhatsApp',i:'💬'},{id:'tiktok',l:'TikTok',i:'🎵'}];
const xt = (raw:string,t:string)=>{const m=raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));return m?m[1].trim():'';};

type ScoredVariant = ScoreResult & { score_id: string; iteration: number; max: number };

export default function VariationsPage() {
  const [orig, setOrig] = useState('');
  const [plt,  setPlt]  = useState('facebook');
  const [vars, setVars] = useState<{ num:number; hook:string; text:string }[]>([]);
  const [sel,  setSel]  = useState<number|null>(null);
  const { call, loading, error } = useAI();

  const [scores,    setScores]    = useState<Record<number, ScoredVariant | undefined>>({});
  const [openPanel, setOpenPanel] = useState<number | null>(null);
  const [topFive,   setTopFive]   = useState(false);

  async function scoreVariant(idx: number, copy: string) {
    const r = await fetch('/api/ai/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ copy, channel: 'meta_feed', locale: 'he', source: { kind: 'variation' } }),
    });
    const data = await r.json();
    if (data.ok) setScores(prev => ({ ...prev, [idx]: { ...data, iteration: 0, max: 2 } }));
  }

  useEffect(() => {
    vars.forEach((v, i) => {
      const text = v.text ?? '';
      if (text && !scores[i]) scoreVariant(i, text);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars]);

  async function generate() {
    if (!orig.trim()) return;
    setVars([]); setSel(null); setScores({}); setOpenPanel(null);
    const text = await call('variations',
      `מומחה קריאייטיב ל${PLATFORMS.find(p=>p.id===plt)?.l}. צור 5 וריאציות שונות עם hook שונה בכל אחת.
[V1H]סוג hook[/V1H][V1]טקסט מלא[/V1]
[V2H]סוג hook[/V2H][V2]טקסט מלא[/V2]
[V3H]סוג hook[/V3H][V3]טקסט מלא[/V3]
[V4H]סוג hook[/V4H][V4]טקסט מלא[/V4]
[V5H]סוג hook[/V5H][V5]טקסט מלא[/V5]`,
      `פוסט מקורי:\n${orig}`, 1500);
    if (!text) return;
    setVars([1,2,3,4,5].map(i=>({ num:i, hook:xt(text,`V${i}H`), text:xt(text,`V${i}`) })).filter(v=>v.text));
  }

  const visibleIdx = (() => {
    if (!topFive) return vars.map((_: any, i: number) => i);
    const idxs = vars.map((_: any, i: number) => i);
    idxs.sort((a, b) => (scores[b]?.score ?? -1) - (scores[a]?.score ?? -1));
    return idxs.slice(0, 5);
  })();
  const hidden = vars.length - visibleIdx.length;

  return (
    <div>
      <PageHeader eyebrow="A/B Testing" title="מחולל וריאציות" sub="מפוסט אחד → 5 גרסאות שונות" right={<CostBadge cost={8} />} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>פוסט מקורי</CardLabel>
            <Textarea value={orig} onChange={setOrig} placeholder="הדבק פוסט קיים שעבד טוב, או כתוב טקסט בסיסי..." rows={8} />
          </Card>
          <Card className="mb-3">
            <CardLabel>פלטפורמה</CardLabel>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p=><Chip key={p.id} label={`${p.i} ${p.l}`} active={plt===p.id} onClick={()=>setPlt(p.id)} />)}
            </div>
          </Card>
          <Btn variant="primary" full loading={loading} onClick={generate} disabled={!orig.trim()}>
            🔀 צור 5 וריאציות
          </Btn>
          {error && <Alert type="red" className="mt-3">❌ {error}</Alert>}
        </div>

        <div>
          {loading && (
            <div className="flex items-center justify-center h-48 gap-3 text-[#6B8FA8]">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span className="text-sm">מייצר 5 גרסאות שונות...</span>
            </div>
          )}

          {vars.length > 0 && (
            <div className="flex justify-end mb-2">
              <TopFiveFilter active={topFive} onToggle={() => setTopFive(v => !v)} hidden={hidden} />
            </div>
          )}

          {visibleIdx.map((i: number) => {
            const v = vars[i];
            return (
              <div key={i} onClick={() => setSel(i === sel ? null : i)}
                className={clsx(
                  'rounded-xl border p-4 mb-3 cursor-pointer transition-all',
                  sel === i
                    ? 'border-[#0A7AFF] bg-[#0A7AFF]/06'
                    : 'border-[#1E2F42] bg-[#111A24] hover:border-[#2A4158]'
                )}>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#0A7AFF]/12 border border-[#0A7AFF] text-[#3D9FFF] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {v.num}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#3D9FFF] mb-2">🎣 {v.hook}</div>
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{v.text}</div>
                    <div className="flex items-center gap-2 mt-2" dir="rtl">
                      {scores[i] && (
                        <ScoreBadge
                          score={scores[i]!.score}
                          band={scores[i]!.band}
                          onClick={() => setOpenPanel(openPanel === i ? null : i)}
                        />
                      )}
                      {scores[i] && scores[i]!.band !== 'high' && (
                        <BoostButton
                          priorScoreId={scores[i]!.score_id}
                          iteration={scores[i]!.iteration}
                          max={scores[i]!.max}
                          onBoosted={(b) => {
                            setVars(prev => prev.map((vv, j) => {
                              if (j !== i) return vv;
                              return { ...vv, text: b.copy };
                            }));
                            setScores(prev => ({ ...prev, [i]: { ...(prev[i] ?? {} as any), ...b } }));
                          }}
                        />
                      )}
                    </div>
                    {openPanel === i && scores[i] && (
                      <div className="mt-2 max-w-md"><ScorePanel result={scores[i]!} onClose={() => setOpenPanel(null)} /></div>
                    )}
                    {sel === i && (
                      <div className="mt-3" onClick={e => e.stopPropagation()}>
                        <CopyBtn text={v.text} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && vars.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">🔀</span>
              <span className="text-sm">הזן פוסט ולחץ "צור וריאציות"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
