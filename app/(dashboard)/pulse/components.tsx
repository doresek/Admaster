'use client';
// app/(dashboard)/pulse/components.tsx
//
// Presentational pieces of the PULSE dashboard (D-1, §1 wireframe). All data
// arrives from the /api/pulse payload — nothing here computes a number, and
// every metric tile RENDERS ITS HONESTY LABEL (the architecture doc's hard
// rule: labeled numbers beat confident fabrications).
//
// Every tile tap opens the "למה?" popover (leap 3); act-from-here is a LINK
// to the approvals surface (leap 6 — no writes from this dashboard).

import Link from 'next/link';
import { clsx } from 'clsx';
import { Alert, Card } from '@/components/ui';
import type { MetricValue } from '@/lib/metrics-layer';
import type { PulsePayload, PulsePendingItem, PulseWhy } from '@/app/api/pulse/shared';
import { comparisonLine, deltaBadge, formatMetricValue, whyLines } from './helpers';

// ── the one-line story block (leap 1) ─────────────────────────────────────────

export function StoryBlock({ story, shockNote }: {
  story:     PulsePayload['story'];
  shockNote: string | null;
}) {
  return (
    <Card className="mb-4">
      <div className="text-lg md:text-xl font-bold text-[#D9E8F5] leading-relaxed">
        {story.headline_he}
      </div>
      {story.lines_he.length > 0 && (
        <ul className="mt-2 space-y-1">
          {story.lines_he.map((line) => (
            <li key={line} className="text-[13px] text-[#6B8FA8] leading-relaxed">{line}</li>
          ))}
        </ul>
      )}
      {story.heads_up_he !== null && (
        <div className="mt-3 text-[12.5px] text-[#D97706] leading-relaxed">{story.heads_up_he}</div>
      )}
      {/* Forecast (leap 5): rendered ONLY when the API sent one — never derived here. */}
      {story.forecast_he !== null && (
        <div className="mt-2 text-[12.5px] text-[#7AC0FF] leading-relaxed">{story.forecast_he}</div>
      )}
      {shockNote !== null && (
        <Alert type="amber" className="mt-3 mb-0">🌍 {shockNote}</Alert>
      )}
    </Card>
  );
}

// ── the "ממתין לך" action strip (leap 6 — links, never inline writes) ─────────

export function PendingStrip({ pending, note }: {
  pending: PulsePendingItem[];
  note:    string | null;
}) {
  if (note !== null) {
    return <Alert type="amber">⚡ {note}</Alert>;
  }
  if (pending.length === 0) return null;
  const first = pending[0];
  return (
    <Link href="/approvals" className="block mb-4">
      <div className="flex items-center justify-between gap-3 bg-[#0A7AFF]/10 border border-[#0A7AFF]/25 rounded-xl px-4 py-3 hover:bg-[#0A7AFF]/15 transition-colors">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-[#7AC0FF]">
            ⚡ ממתין לך: {pending.length === 1 ? 'פעולה אחת לאישור' : `${pending.length} פעולות לאישור`}
          </div>
          {first.title !== null && (
            <div className="text-[12px] text-[#6B8FA8] truncate mt-0.5">{first.title}</div>
          )}
        </div>
        <span className="text-[12px] text-[#3D9FFF] font-semibold flex-shrink-0">צפה ←</span>
      </div>
    </Link>
  );
}

// ── honesty label (rendered small on EVERY tile that carries one) ─────────────

export function HonestyLabel({ label }: { label: string | null }) {
  if (label === null) return null;
  return (
    <span className="inline-block text-[10px] leading-tight text-[#B8953A] bg-[#B8953A]/10 border border-[#B8953A]/20 rounded px-1.5 py-0.5 mt-1.5">
      {label}
    </span>
  );
}

// ── metric tile (tap → למה?, leap 3) ─────────────────────────────────────────

export function MetricTile({ metric, why, dominant = false, showReason = false, onWhy }: {
  metric:      MetricValue;
  why:         PulseWhy | null;
  /** The north-star tile — visually dominant (top-right in RTL grid flow). */
  dominant?:   boolean;
  /** Marketer mode shows the null-reason inline; owner keeps the tile clean. */
  showReason?: boolean;
  onWhy:       () => void;
}) {
  const delta = deltaBadge(metric);
  const vs = comparisonLine(metric);
  return (
    <button
      type="button"
      onClick={onWhy}
      aria-label={`למה? — ${metric.name_he}`}
      className={clsx(
        'text-right bg-[#111A24] border border-[#1E2F42] rounded-xl p-3.5 transition-colors hover:border-[#2A4158] focus:outline-none focus:border-[#0A7AFF]',
        dominant && 'col-span-2 border-[#0A7AFF]/40',
      )}
    >
      <div className="text-[11px] text-[#6B8FA8] mb-1">{metric.name_he}</div>
      {metric.value !== null ? (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={clsx(
            'font-mono font-semibold text-[#D9E8F5] leading-none',
            dominant ? 'text-4xl md:text-5xl' : 'text-2xl',
          )}>
            {formatMetricValue(metric.value, metric.unit)}
          </span>
          {delta !== null && (
            <span className={clsx(
              'text-[12px] font-bold',
              delta.good ? 'text-[#34D399]' : 'text-red-400',
            )}>
              {delta.arrow}{delta.text}
            </span>
          )}
        </div>
      ) : (
        <div>
          <div className="text-[15px] text-[#2E4459] font-semibold">אין נתונים עדיין</div>
          {showReason && metric.not_computable_reason !== null && (
            <div className="text-[11px] text-[#6B8FA8] mt-1 leading-relaxed">
              {metric.not_computable_reason}
            </div>
          )}
        </div>
      )}
      {vs !== null && <div className="text-[11px] text-[#6B8FA8] mt-1.5">{vs}</div>}
      <HonestyLabel label={metric.honesty_label} />
      <div className="text-[10px] text-[#2E4459] mt-1.5">
        {why !== null && (why.diagnosis !== null || why.shock !== null) ? 'למה? יש אבחנה →' : 'למה? →'}
      </div>
    </button>
  );
}

// ── the "למה?" popover (leap 3 — mobile-first bottom sheet) ───────────────────

export function WhyPopover({ metric, why, onClose }: {
  metric:  MetricValue;
  why:     PulseWhy | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="סגור"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 cursor-default"
      />
      <div className="relative w-full md:max-w-md bg-[#111A24] border border-[#1E2F42] rounded-t-2xl md:rounded-2xl p-5 max-h-[70vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-1">למה?</div>
            <div className="text-base font-bold text-[#D9E8F5]">{metric.name_he}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#6B8FA8] hover:text-[#D9E8F5] text-lg leading-none px-1"
            aria-label="סגירה"
          >
            ✕
          </button>
        </div>
        <div className="space-y-2">
          {whyLines(metric, why).map((line) => (
            <p key={line} className="text-[13px] text-[#D9E8F5] leading-relaxed bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5">
              {line}
            </p>
          ))}
        </div>
        <HonestyLabel label={metric.honesty_label} />
      </div>
    </div>
  );
}

// ── marketer extras: reconciliation honesty panel ─────────────────────────────

export function ReconciliationPanel({ metric }: { metric: MetricValue | null }) {
  if (metric === null) return null;
  return (
    <Card className="mb-4">
      <div className="text-[11px] font-bold text-[#2E4459] uppercase tracking-widest mb-2">
        פאנל כנות — פלטפורמה מול CRM
      </div>
      {metric.value !== null ? (
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-2xl font-semibold text-[#D9E8F5]">
            {formatMetricValue(metric.value, metric.unit)}
          </span>
          {metric.vs_benchmark !== null && (
            <span className={clsx(
              'text-[12px] font-semibold',
              metric.vs_benchmark.met ? 'text-[#34D399]' : 'text-[#D97706]',
            )}>
              {metric.vs_benchmark.met
                ? `בטווח הבריא (עד ${formatMetricValue(metric.vs_benchmark.target, metric.unit)})`
                : `מעל הטווח הבריא (${formatMetricValue(metric.vs_benchmark.target, metric.unit)})`}
            </span>
          )}
        </div>
      ) : (
        <div className="text-[13px] text-[#6B8FA8] leading-relaxed">
          {metric.not_computable_reason ?? 'אין נתוני הצלבה עדיין'}
        </div>
      )}
      <p className="text-[11px] text-[#6B8FA8] mt-2 leading-relaxed">
        כמה המרות הפלטפורמה טוענת מול כמה לידים באמת נרשמו ב-CRM — היחס שמונע החלטות על סמך דיווח-יתר.
      </p>
      <HonestyLabel label={metric.honesty_label} />
    </Card>
  );
}

// ── marketer extras: links to the deeper surfaces (no rebuilds) ───────────────

export function MarketerLinks() {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <Link
        href="/command-center"
        className="text-[12px] px-3 py-1.5 rounded-full border border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158] hover:text-[#D9E8F5] transition-colors"
      >
        📣 קמפיינים והחלטות ←
      </Link>
      <Link
        href="/approvals"
        className="text-[12px] px-3 py-1.5 rounded-full border border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158] hover:text-[#D9E8F5] transition-colors"
      >
        ⚡ אישורים ←
      </Link>
    </div>
  );
}
