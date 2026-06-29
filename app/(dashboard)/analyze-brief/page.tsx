'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardLabel, Btn, Alert, PageHeader, CostBadge, CopyBtn, Textarea } from '@/components/ui';
import type { Brief } from '@/types';

interface StrategyResult {
  strategic_summary: { goal: string; core_offer: string; usp: string; constraints: string[] };
  sub_audience:      { name: string; awareness_level: string; persona: string; explanation: string };
  platform_funnel:   { platform: string; ad_format: string; funnel_type: string;
                       platform_reason: string; format_reason: string; funnel_reason: string };
  offer_stack:       { components: string[]; strengths: string[]; assessment: string };
  raw_text:          string;
}

export default function AnalyzeBriefPage() {
  const [briefs,  setBriefs]  = useState<Brief[]>([]);
  const [selId,   setSelId]   = useState<string>('');
  const [pasted,  setPasted]  = useState('');
  const [out,     setOut]     = useState<StrategyResult|null>(null);
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

  return (
    <div>
      <PageHeader
        eyebrow="Strategy Analysis"
        title="🧭 ניתוח אסטרטגי"
        sub="סיכום אסטרטגי, תת-קהל מומלץ, פלטפורמה ומשפך, והערכת הצעה"
        right={<CostBadge cost={2} />}
      />

      <div className="grid grid-cols-2 gap-4" dir="rtl">
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
            🧭 נתח אסטרטגיה
          </Btn>
          {error && <Alert type="red">❌ {error}</Alert>}
        </div>

        <div>
          {out ? (
            <>
              {/* 1. Strategic summary */}
              <Card className="mb-3" style={{ borderColor: 'rgba(10,122,255,.3)' }}>
                <CardLabel>🎯 סיכום אסטרטגי</CardLabel>
                <dl className="space-y-2 mt-1">
                  <Field label="מטרה"   value={out.strategic_summary.goal} />
                  <Field label="ההצעה המרכזית" value={out.strategic_summary.core_offer} />
                  <Field label="מה מייחד (USP)" value={out.strategic_summary.usp} />
                </dl>
                {out.strategic_summary.constraints.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] text-[#6B8FA8] mb-1">אילוצים / סיכונים</div>
                    <ul className="space-y-1.5">
                      {out.strategic_summary.constraints.map((s, i) => (
                        <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2"><span className="text-[#D97706]">!</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>

              {/* 2. Recommended sub-audience */}
              <Card className="mb-3" style={{ borderColor: 'rgba(139,92,246,.3)' }}>
                <div className="flex items-center justify-between mb-1">
                  <CardLabel>👥 תת-קהל מומלץ</CardLabel>
                  {out.sub_audience.awareness_level && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#8B5CF620] text-[#C4B5FD] border border-[#8B5CF640]">
                      {out.sub_audience.awareness_level}
                    </span>
                  )}
                </div>
                {out.sub_audience.name && <div className="font-bold text-sm text-[#D9E8F5] mb-1">{out.sub_audience.name}</div>}
                <dl className="space-y-2">
                  <Field label="פרסונה" value={out.sub_audience.persona} />
                  <Field label="למה הם" value={out.sub_audience.explanation} />
                </dl>
              </Card>

              {/* 3. Platform & funnel */}
              <Card className="mb-3" style={{ borderColor: 'rgba(52,211,153,.3)' }}>
                <CardLabel>📡 פלטפורמה ומשפך</CardLabel>
                <div className="grid grid-cols-3 gap-2 my-2">
                  <Pill label="פלטפורמה" value={out.platform_funnel.platform} />
                  <Pill label="פורמט"    value={out.platform_funnel.ad_format} />
                  <Pill label="משפך"     value={out.platform_funnel.funnel_type} />
                </div>
                <dl className="space-y-2">
                  <Field label="למה הפלטפורמה" value={out.platform_funnel.platform_reason} />
                  <Field label="למה הפורמט"    value={out.platform_funnel.format_reason} />
                  <Field label="למה המשפך"     value={out.platform_funnel.funnel_reason} />
                </dl>
              </Card>

              {/* 4. Offer stack */}
              <Card style={{ borderColor: 'rgba(184,149,58,.3)' }}>
                <CardLabel>💎 הערכת הצעה (Offer Stack)</CardLabel>
                {out.offer_stack.components.length > 0 && (
                  <div className="mt-1">
                    <div className="text-[11px] text-[#6B8FA8] mb-1">רכיבי ההצעה</div>
                    <ul className="space-y-1.5">
                      {out.offer_stack.components.map((s, i) => (
                        <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2"><span className="text-[#6B8FA8]">•</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {out.offer_stack.strengths.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[11px] text-[#6B8FA8] mb-1">חוזקות</div>
                    <ul className="space-y-1.5">
                      {out.offer_stack.strengths.map((s, i) => (
                        <li key={i} className="text-[12.5px] text-[#D9E8F5] flex items-start gap-2"><span className="text-[#34D399]">✓</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {out.offer_stack.assessment && (
                  <div className="mt-3">
                    <div className="text-[11px] text-[#6B8FA8] mb-1">הערכה</div>
                    <p className="text-[12.5px] text-[#D9E8F5] leading-relaxed">{out.offer_stack.assessment}</p>
                  </div>
                )}
                <div className="mt-3 flex justify-end">
                  <CopyBtn text={out.raw_text} label="📋 העתק ניתוח" />
                </div>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-72 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
              <span className="text-5xl mb-3 opacity-30">🧭</span>
              <span className="text-sm">בחר בריף ולחץ "נתח"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[11px] text-[#6B8FA8]">{label}</dt>
      <dd className="text-[12.5px] text-[#D9E8F5] leading-relaxed">{value}</dd>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center bg-[#162030] border border-[#1E2F42] rounded-lg px-2 py-2">
      <div className="text-[10px] text-[#6B8FA8] mb-0.5">{label}</div>
      <div className="text-[12px] font-bold text-[#D9E8F5]">{value || '—'}</div>
    </div>
  );
}
