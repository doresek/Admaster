'use client';
// ═══ ANALYZE PAGE ════════════════════════════════════════════
import { useState } from 'react';
import { Card, CardLabel, Textarea, Btn, OutputBox, CopyBtn, CostBadge, Alert, PageHeader, Input } from '@/components/ui';
import { useAI } from '@/lib/hooks/useAI';

const xt = (raw: string, t: string) => { const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`)); return m ? m[1].trim() : ''; };

export default function AnalyzePage() {
  const [adText, setAdText] = useState('');
  const [metrics, setMetrics] = useState({ ctr:'', cpa:'', roas:'', spend:'' });
  const [out, setOut] = useState<{sc:number;hook:string;offer:string;cta:string;imp:string;rw:string}|null>(null);
  const { call, loading, error } = useAI();

  async function analyze() {
    if (!adText.trim()) return;
    const mStr = Object.values(metrics).some(v=>v)
      ? `\nנתוני ביצוע: CTR=${metrics.ctr||'?'}%, CPA=₪${metrics.cpa||'?'}, ROAS=${metrics.roas||'?'}, Spend=₪${metrics.spend||'?'}` : '';
    const text = await call('analyze',
      `מומחה ניתוח קריאייטיב ברמת Eugene Schwartz לשוק הישראלי. נתח בפירוט.
החזר:
[SCORE]מספר 0-100[/SCORE]
[HOOK]ניתוח הפתיחה: חוזקות וחולשות[/HOOK]
[OFFER]ניתוח ההצעה: ערך, בהירות, שכנוע[/OFFER]
[CTA]ניתוח הCTA[/CTA]
[IMPROVEMENTS]3 שיפורים קונקרטיים ממוספרים[/IMPROVEMENTS]
[REWRITTEN]גרסה משופרת מלאה[/REWRITTEN]`,
      `מודעה:\n${adText}${mStr}`, 1400);
    if (!text) return;
    const sc = parseInt(xt(text,'SCORE')) || 70;
    setOut({ sc, hook:xt(text,'HOOK'), offer:xt(text,'OFFER'), cta:xt(text,'CTA'), imp:xt(text,'IMPROVEMENTS'), rw:xt(text,'REWRITTEN') });
  }

  const scColor = out ? (out.sc>=75?'#059669':out.sc>=50?'#D97706':'#DC2626') : '#6B8FA8';

  return (
    <div>
      <PageHeader eyebrow="ניתוח" title="נתח מודעה" sub="ציון AI + שיפורים + גרסה מחודשת" right={<CostBadge cost={5} />} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>טקסט המודעה</CardLabel>
            <Textarea value={adText} onChange={setAdText} placeholder="הדבק כאן טקסט של פוסט או מודעה..." rows={8} />
          </Card>
          <Card className="mb-3">
            <CardLabel>נתוני ביצוע (אופציונלי)</CardLabel>
            <div className="grid grid-cols-2 gap-2">
              {[['ctr','CTR %'],['cpa','CPA ₪'],['roas','ROAS'],['spend','הוצאה ₪']].map(([k,l])=>(
                <Input key={k} label={l} value={metrics[k as keyof typeof metrics]} onChange={v=>setMetrics(p=>({...p,[k]:v}))} placeholder="0" />
              ))}
            </div>
          </Card>
          <Btn variant="violet" full loading={loading} onClick={analyze} disabled={!adText.trim()}>🔬 נתח מודעה</Btn>
          {error && <Alert type="red" className="mt-3">❌ {error}</Alert>}
        </div>

        <div>
          {out ? (
            <>
              <Card className="mb-3">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full border-2 flex items-center justify-center font-mono text-xl font-bold flex-shrink-0"
                    style={{ borderColor: scColor, color: scColor, background: `${scColor}15` }}>
                    {out.sc}
                  </div>
                  <div>
                    <div className="font-bold text-base">ציון קריאייטיב</div>
                    <div className="text-sm text-[#6B8FA8]">{out.sc>=75?'חזק — יש מה לשפר':out.sc>=50?'בינוני':'חלש — שיפור דחוף'}</div>
                  </div>
                </div>
              </Card>

              {[['🎣','פתיחה',out.hook],['💎','הצעה',out.offer],['📣','CTA',out.cta]].map(([i,l,v])=>(
                <Card key={l} className="mb-2">
                  <div className="text-[11px] font-bold text-[#2E4459] uppercase mb-2">{i} {l}</div>
                  <div className="text-[13px] leading-relaxed">{v}</div>
                </Card>
              ))}

              <Card className="mb-2" style={{ borderColor: 'rgba(217,119,6,.3)' }}>
                <div className="text-[11px] font-bold text-[#D97706] mb-2">💡 שיפורים מומלצים</div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{out.imp}</div>
              </Card>

              <Card style={{ borderColor: 'rgba(5,150,105,.3)' }}>
                <div className="text-[11px] font-bold text-[#059669] mb-2">✅ גרסה משופרת</div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap mb-3">{out.rw}</div>
                <CopyBtn text={out.rw} label="📋 העתק גרסה משופרת" />
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-4xl mb-3 opacity-30">🔬</span>
              <span className="text-sm">הדבק מודעה ולחץ "נתח"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
