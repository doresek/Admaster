'use client';
import { useState } from 'react';
import type { ClientInsight, InsightStatus } from '@/lib/intelligence/types';
import { confidenceBand, confidencePct, sourceMeta, relativeHe } from '@/lib/intelligence/display';
import { SignalButtons, type SignalInsightSummary } from './SignalButtons';

// One living-knowledge atom rendered as a card on the wall: the Hebrew headline
// (content), a color-coded confidence meter, a provenance chip and a freshness
// line — plus the inline signal loop (✓ עבד / ✗ לא נכון). After a signal the
// route returns the updated summary; we update the meter in place and show the
// immediate effect. A "wrong" that supersedes/refutes fades the card out.
export function InsightCard({ insight }: { insight: ClientInsight }) {
  const [confidence, setConfidence] = useState(insight.confidence);
  const [status, setStatus]         = useState(insight.status);
  const [note, setNote]             = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [fading, setFading]         = useState(false);
  const [hidden, setHidden]         = useState(false);

  const isUnspoken = insight.kind === 'unspoken_want';
  const band = confidenceBand(confidence);
  const pct  = confidencePct(confidence);
  const src  = sourceMeta(insight.source);
  const fresh = relativeHe(insight.updated_at || insight.first_seen_at);

  function handleResult(kind: 'worked' | 'wrong', summary: SignalInsightSummary | null) {
    const nextConfidence = summary ? summary.confidence : confidence;
    const nextStatus     = (summary ? summary.status : status) as InsightStatus;
    setConfidence(nextConfidence);
    setStatus(nextStatus);
    if (nextStatus !== 'active') {
      setNote({ tone: 'bad', text: '✗ סומן כשגוי — המערכת תעדכן' });
      setFading(true);
      setTimeout(() => setHidden(true), 1400);
    } else if (kind === 'worked') {
      setNote({ tone: 'good', text: `👍 חוזק — ביטחון ${confidencePct(nextConfidence)}%` });
    } else {
      setNote({ tone: 'bad', text: `נחלש — ביטחון ${confidencePct(nextConfidence)}%` });
    }
  }

  if (hidden) return null;

  return (
    <div
      dir="rtl"
      className={[
        'rounded-xl border p-3.5 transition-all duration-500',
        fading ? 'opacity-0 scale-95' : 'opacity-100',
        isUnspoken
          ? 'bg-[#1A1330] border-[#6D28D9]/40'
          : 'bg-[#111A24] border-[#1E2F42] hover:border-[#2A4158]',
      ].join(' ')}
    >
      {isUnspoken && (
        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-[#C4B5FD] bg-[#6D28D9]/20 border border-[#6D28D9]/40 rounded-full px-2 py-0.5 mb-2">
          💡 מה שהם לא אומרים
        </div>
      )}

      <div className="text-[13px] leading-relaxed text-[#D9E8F5] font-medium mb-3">
        {insight.content}
      </div>

      {/* confidence meter */}
      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[10px] font-semibold ${band.text}`}>ביטחון {band.label}</span>
          <span className={`text-[10px] font-mono ${band.text}`}>{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[#1E2F42] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${band.bar}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* provenance + freshness */}
      <div className="flex items-center justify-between text-[10px] text-[#6B8FA8] mb-2.5">
        <span className="inline-flex items-center gap-1 bg-[#162030] border border-[#1E2F42] rounded-full px-2 py-0.5">
          <span>{src.icon}</span>{src.label}
        </span>
        {fresh && <span>נוצר/עודכן {fresh}</span>}
      </div>

      {/* signal loop + inline effect */}
      {note ? (
        <div className={`text-[11px] font-semibold ${note.tone === 'good' ? 'text-emerald-400' : 'text-rose-400'}`}>
          {note.text}
        </div>
      ) : (
        status === 'active' && (
          <SignalButtons insightId={insight.id} silent onResult={handleResult} />
        )
      )}
    </div>
  );
}
