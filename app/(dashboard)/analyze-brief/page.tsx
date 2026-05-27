'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, CostBadge, CopyBtn, Textarea } from '@/components/ui';
import type { Brief } from '@/types';

interface Result {
  completeness_score: number;
  strengths:          string[];
  gaps:               string[];
  questions:          string[];
  refinements:        string[];
}

export default function AnalyzeBriefPage() {
  const [briefs,  setBriefs]  = useState<Brief[]>([]);
  const [selId,   setSelId]   = useState<string>('');
  const [pasted,  setPasted]  = useState('');
  const [out,     setOut]     = useState<Result|null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('briefs').select('id, code, values, submitted_at').eq('user_id', user.id).order('submitted_at', { ascending: false }).limit(50)
        .then(({ data }) => setBriefs((data ?? []) as any));
    });
  }, []);

  async function analyze() {
    setLoading(true); setError(''); setOut(null);
    try {
      const brief = briefs.find(b => b.id === selId);
      const values = brief ? brief.values : (() => {
        try { return JSON.parse(pasted); } catch { return { freeform: pasted }; }
      })();
      const res = await fetch('/api/tools', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tool: 'analyze_brief', input: { values, brief_id: brief?.id } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      setOut(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  const scoreColor = out
    ? out.completeness_score >= 80 ? '#34D399'
    : out.completeness_score >= 50 ? '#D97706'
    : '#DC2626'
    : '#6B8FA8';

  return (
    <div>
      <PageHeader
        eyebrow="Brief Analyzer"
        title="🧠 ניתוח בריפינג"
        sub="ציון שלמות, פערים, ושאלות חוזרות ללקוח"
        right={<CostBadge cost={2} />}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Card className="mb-3">
            <CardLabel>בחר בריף קיים</CardLabel>
            {briefs.length === 0 ? (
              <div className="text-xs text-[#2E4459] py-2">אין בריפים שמורים — הדבק בריף ידנית למטה</div>
            ) : (
              <select value={selId} onChange={e => { setSelId(e.target.value); setPasted(''); }}
                className="w-full bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-sm text-[#D9E8F5] outline-none focus:border-[#0A7AFF]" dir="rtl">
                <option value="">— בחר —</option>
                {briefs.map(b => (
                  <option key={b.id} value={b.id} className="bg-[#162030]">
                    {b.values?.biz_name || b.code} · {new Date(b.submitted_at).toLocaleDateString('he')}
                  </option>
                ))}
              </select>
            )}
          </Card>
          <Card className="mb-3">
            <CardLabel>או הדבק בריף ידני</CardLabel>
            <Textarea value={pasted} onChange={v => { setPasted(v); setSelId(''); }}
              placeholder="ניתן להדביק בריף בפורמט חופשי או JSON עם השדות הסטנדרטיים"
              rows={6} />
          </Card>
          <Btn variant="primary" full loading={loading} onClick={analyze} disabled={!selId && !pasted.trim()}>
            🧠 נתח בריף
          </Btn>
          {error && <Alert type="red">❌ {error}</Alert>}
        </div>

        <div>
          {out ? (
            <>
              <Card className="mb-3">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full border-2 flex items-center justify-center font-mono text-xl font-bold"
                    style={{ borderColor: scoreColor, color: scoreColor, background: `${scoreColor}15` }}>
                    {out.completeness_score}
                  </div>
                  <div>
                    <div className="font-bold text-base text-[#D9E8F5]">ציון שלמות בריף</div>
                    <div className="text-xs text-[#6B8FA8] mt-0.5">
                      {out.completeness_score >= 80 ? 'מצוין — כמעט מוכן ליצירה' :
                       out.completeness_score >= 50 ? 'בינוני — כדאי להשלים פערים' :
                       'חלש — חזור ללקוח לפני שתמשיך'}
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="mb-3" style={{ borderColor: 'rgba(5,150,105,.3)' }}>
                <CardLabel>💪 חוזקות</CardLabel>
                <ul className="space-y-1.5">
                  {out.strengths.map((s, i) => <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2"><span className="text-[#34D399]">✓</span>{s}</li>)}
                </ul>
              </Card>

              <Card className="mb-3" style={{ borderColor: 'rgba(220,38,38,.3)' }}>
                <CardLabel>⚠️ פערים</CardLabel>
                <ul className="space-y-1.5">
                  {out.gaps.map((s, i) => <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2"><span className="text-red-400">✕</span>{s}</li>)}
                </ul>
              </Card>

              <Card className="mb-3" style={{ borderColor: 'rgba(10,122,255,.3)' }}>
                <div className="flex items-center justify-between mb-2">
                  <CardLabel>❓ שאלות לחזור ולשאול</CardLabel>
                  <CopyBtn text={out.questions.map((q, i) => `${i+1}. ${q}`).join('\n')} label="📋" />
                </div>
                <ol className="space-y-1.5 list-decimal pr-5">
                  {out.questions.map((q, i) => <li key={i} className="text-[12.5px] text-[#D9E8F5]">{q}</li>)}
                </ol>
              </Card>

              <Card style={{ borderColor: 'rgba(184,149,58,.3)' }}>
                <CardLabel>💡 שיפורים מומלצים</CardLabel>
                <ul className="space-y-1.5">
                  {out.refinements.map((s, i) => <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2"><span className="text-[#D4AF55]">→</span>{s}</li>)}
                </ul>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🧠</span>
              <span className="text-sm">בחר בריף ולחץ "נתח"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
