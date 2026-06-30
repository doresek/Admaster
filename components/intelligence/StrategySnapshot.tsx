import Link from 'next/link';
import type { StrategyAnalysis } from '@/lib/analyze-brief';

// Passive, FREE render of the synthesized strategy snapshot
// (client_strategy.business_analysis). No generation, no credits — just a
// plain-Hebrew view of the four blocks: strategic summary, recommended
// sub-audience, platform + funnel (with reasons), and the offer-stack
// assessment. The "רענן" link points at the analyze flow but the VIEW is free.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#111A24] border border-[#1E2F42] p-4">
      <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2.5">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="mb-2 last:mb-0">
      <span className="text-[#6B8FA8] text-xs">{label}: </span>
      <span className="text-[#D9E8F5] text-[13px] leading-relaxed">{value}</span>
    </div>
  );
}

export function StrategySnapshot({
  analysis,
  activeCount,
  coreGeneratedAt,
  clientId,
}: {
  analysis: Partial<StrategyAnalysis> | null;
  activeCount: number;
  coreGeneratedAt: string | null;
  clientId: string;
}) {
  if (!analysis) return null;

  const ss = analysis.strategic_summary;
  const sa = analysis.sub_audience;
  const pf = analysis.platform_funnel;
  const os = analysis.offer_stack;
  const dateLabel = coreGeneratedAt ? new Date(coreGeneratedAt).toLocaleDateString('he') : '—';

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-base font-bold text-[#D9E8F5]">🎯 תמונת אסטרטגיה</div>
          <div className="text-[11px] text-[#6B8FA8]">
            מסונתז מ-{activeCount} תובנות פעילות · עודכן {dateLabel}
          </div>
        </div>
        <Link href={`/analyze-brief?client=${clientId}`} className="text-[#7AC0FF] text-xs hover:underline">
          רענן
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section title="סיכום אסטרטגי">
          <Field label="מטרה" value={ss?.goal} />
          <Field label="ההצעה המרכזית" value={ss?.core_offer} />
          <Field label="הבידול (USP)" value={ss?.usp} />
          {ss?.constraints && ss.constraints.length > 0 && (
            <div className="mt-2">
              <span className="text-[#6B8FA8] text-xs">אילוצים:</span>
              <ul className="list-disc pr-5 mt-1 space-y-0.5">
                {ss.constraints.map((c, i) => (
                  <li key={i} className="text-[#D9E8F5] text-[12.5px]">{c}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="הקהל המומלץ">
          <div className="flex items-center gap-2 mb-2">
            {sa?.name && <span className="text-[#D9E8F5] text-[13px] font-semibold">{sa.name}</span>}
            {sa?.awareness_level && (
              <span className="text-[10px] text-[#7AC0FF] bg-[#0A7AFF]/12 border border-[#0A7AFF]/20 rounded-full px-2 py-0.5">
                מודעות: {sa.awareness_level}
              </span>
            )}
          </div>
          <Field label="פרסונה" value={sa?.persona} />
          <Field label="הסבר" value={sa?.explanation} />
        </Section>

        <Section title="פלטפורמה ומשפך">
          <Field label="פלטפורמה" value={pf?.platform} />
          <Field label="למה" value={pf?.platform_reason} />
          <Field label="פורמט מודעה" value={pf?.ad_format} />
          <Field label="למה" value={pf?.format_reason} />
          <Field label="סוג משפך" value={pf?.funnel_type} />
          <Field label="למה" value={pf?.funnel_reason} />
        </Section>

        <Section title="הערכת הצעה">
          {os?.components && os.components.length > 0 && (
            <div className="mb-2">
              <span className="text-[#6B8FA8] text-xs">מרכיבים:</span>
              <ul className="list-disc pr-5 mt-1 space-y-0.5">
                {os.components.map((c, i) => (
                  <li key={i} className="text-[#D9E8F5] text-[12.5px]">{c}</li>
                ))}
              </ul>
            </div>
          )}
          {os?.strengths && os.strengths.length > 0 && (
            <div className="mb-2">
              <span className="text-[#6B8FA8] text-xs">חוזקות:</span>
              <ul className="list-disc pr-5 mt-1 space-y-0.5">
                {os.strengths.map((s, i) => (
                  <li key={i} className="text-emerald-300/90 text-[12.5px]">{s}</li>
                ))}
              </ul>
            </div>
          )}
          <Field label="הערכה" value={os?.assessment} />
        </Section>
      </div>
    </div>
  );
}
