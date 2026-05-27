'use client';
import { useState } from 'react';
import { Card, CardLabel, Btn, Alert, PageHeader, CostBadge, CopyBtn, Textarea, Input } from '@/components/ui';

interface Result {
  diagnosis:    string;
  root_causes:  string[];
  improvements: string[];
  rewritten_ad: string;
}

export default function AnalyzeWeakPage() {
  const [adText,  setAdText]  = useState('');
  const [metrics, setMetrics] = useState({ ctr: '', cpa: '', spend: '', roas: '', impressions: '' });
  const [out,     setOut]     = useState<Result|null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function analyze() {
    if (!adText.trim()) return;
    setLoading(true); setError(''); setOut(null);
    try {
      const res = await fetch('/api/tools', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tool: 'analyze_weak', input: { ad_text: adText, metrics } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setOut(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const m = (k: keyof typeof metrics, l: string, ph: string) =>
    <Input label={l} value={metrics[k]} onChange={v => setMetrics(p => ({ ...p, [k]: v }))} placeholder={ph} />;

  return (
    <div>
      <PageHeader
        eyebrow="Performance Doctor"
        title="🩺 ניתוח מודעה חלשה"
        sub="אבחון, סיבות שורש, וגרסה משופרת מוכנה לפרסום"
        right={<CostBadge cost={3} />}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>המודעה שלא הצליחה</CardLabel>
            <Textarea value={adText} onChange={setAdText} placeholder="הדבק את הטקסט המלא של המודעה..." rows={8} />
          </Card>
          <Card className="mb-3">
            <CardLabel>נתוני ביצוע (אופציונלי — עוזר לאבחון מדויק)</CardLabel>
            <div className="grid grid-cols-2 gap-3">
              {m('ctr',  'CTR %',         '0.4')}
              {m('cpa',  'CPA ₪',         '180')}
              {m('spend','הוצאה ₪',       '1200')}
              {m('roas', 'ROAS',          '0.8')}
              {m('impressions', 'חשיפות', '15000')}
            </div>
          </Card>
          <Btn variant="violet" full loading={loading} onClick={analyze} disabled={!adText.trim()}>
            🩺 נתח מודעה
          </Btn>
          {error && <Alert type="red">❌ {error}</Alert>}
        </div>

        <div>
          {out ? (
            <>
              <Card className="mb-3" style={{ borderColor: 'rgba(220,38,38,.3)' }}>
                <CardLabel>🔍 אבחון ראשי</CardLabel>
                <div className="text-base font-semibold text-red-400 leading-relaxed">{out.diagnosis}</div>
              </Card>

              <Card className="mb-3" style={{ borderColor: 'rgba(217,119,6,.3)' }}>
                <CardLabel>סיבות שורש</CardLabel>
                <ul className="space-y-1.5">
                  {out.root_causes.map((s, i) => (
                    <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2">
                      <span className="text-[#D97706] font-mono">{i+1}.</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="mb-3" style={{ borderColor: 'rgba(10,122,255,.3)' }}>
                <CardLabel>💡 שיפורים קונקרטיים</CardLabel>
                <ul className="space-y-1.5">
                  {out.improvements.map((s, i) => (
                    <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2">
                      <span className="text-[#3D9FFF]">✓</span>{s}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card style={{ borderColor: 'rgba(5,150,105,.3)' }}>
                <div className="flex items-center justify-between mb-2">
                  <CardLabel>✨ גרסה משופרת</CardLabel>
                  <CopyBtn text={out.rewritten_ad} label="📋 העתק" />
                </div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[#D9E8F5]">{out.rewritten_ad}</div>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 border border-dashed border-[#324C6B] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🩺</span>
              <span className="text-sm">הדבק מודעה חלשה ולחץ "נתח"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
