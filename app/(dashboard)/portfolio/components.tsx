'use client';
// Portfolio dashboard building blocks (D-2, DASHBOARD-ARCHITECTURE §2):
// narration block → triage lanes (attention-ranked client cards) → aggregates
// strip. RTL/Hebrew-first, mobile-first; every number rendered here arrives
// pre-computed from /api/portfolio (the metrics layer's values or tested sums
// of them) — this file formats, it never calculates.

import { useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui';
import type {
  ClientHealthSummary,
  Lane,
  PortfolioAggregates,
  PortfolioNarration,
} from '@/app/api/portfolio/shared';

// ── lane look & feel ──────────────────────────────────────────────────────────

export const LANE_META: Record<Lane, { emoji: string; title: string; border: string; chip: string }> = {
  urgent: {
    emoji:  '🔴',
    title:  'דחוף',
    border: 'border-red-500/30',
    chip:   'bg-red-900/20 text-red-400 border-red-500/25',
  },
  watch: {
    emoji:  '🟡',
    title:  'לתשומת לב',
    border: 'border-amber-500/25',
    chip:   'bg-amber-900/15 text-amber-400 border-amber-500/25',
  },
  ok: {
    emoji:  '🟢',
    title:  'תקין',
    border: 'border-emerald-500/20',
    chip:   'bg-emerald-900/15 text-emerald-400 border-emerald-500/25',
  },
};

const LANE_EMPTY_TEXT: Record<Lane, string> = {
  urgent: 'אין לקוחות במצב דחוף — נקי 🎉',
  watch:  'אין לקוחות שדורשים תשומת לב מיוחדת',
  ok:     'אין לקוחות במסלול הזה כרגע',
};

// ── narration block (leap 1 — the story first) ───────────────────────────────

export function NarrationBlock({ narration }: { narration: PortfolioNarration }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-5 mb-5">
      <div className="text-[15px] md:text-base font-bold text-[#D9E8F5] leading-relaxed">
        {narration.headline_he}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs text-[#3D9FFF] hover:text-[#6FB9FF] transition-colors"
      >
        {open ? 'הסתר פירוט' : 'הצג פירוט'}
      </button>
      {open && (
        <div className="mt-3 text-[13px] text-[#9FB8CC] whitespace-pre-line leading-relaxed border-t border-[#1E2F42] pt-3">
          {narration.text_he}
        </div>
      )}
    </div>
  );
}

// ── client card ───────────────────────────────────────────────────────────────

/** '↑12%' / '↓8%' — the sign is stripped for display, digits stay verbatim. */
function leadsDelta(deltaPct: number): { text: string; good: boolean } {
  const arrow = deltaPct > 0 ? '↑' : '↓';
  return { text: `${arrow}${String(Math.abs(deltaPct))}%`, good: deltaPct > 0 }; // leads: up = good
}

export function ClientCard({
  client,
  busy,
  onOpen,
}: {
  client: ClientHealthSummary;
  busy:   boolean;
  onOpen: () => void;
}) {
  const meta = LANE_META[client.lane];
  const headline = client.headline_metric;
  const delta = headline !== null && headline.delta_pct !== null && headline.delta_pct !== 0
    ? leadsDelta(headline.delta_pct)
    : null;

  return (
    <button
      onClick={onOpen}
      disabled={busy}
      className={`w-full text-right bg-[#111A24] border ${meta.border} rounded-xl p-4 transition-all hover:border-[#2A4158] hover:bg-[#131E2A] disabled:opacity-60`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-bold text-[#D9E8F5] text-sm truncate">{client.name}</div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {busy && <Spinner size={13} />}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.chip}`}>
            {meta.emoji} {meta.title}
          </span>
        </div>
      </div>

      {client.top_issue !== null && (
        // The Hebrew label names the issue KIND; the verbatim C-06 reason (the
        // audit-trail text) rides on the tooltip.
        <div className="mt-2 text-xs text-[#9FB8CC] truncate" title={client.top_issue.reason}>
          {client.top_issue.label_he}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs">
        {headline !== null && headline.leads !== null ? (
          <>
            <span className="text-[#D9E8F5] font-semibold">
              {headline.leads === 1 ? 'ליד אחד' : `${String(headline.leads)} לידים`}
            </span>
            {delta !== null && (
              <span className={delta.good ? 'text-emerald-400' : 'text-red-400'}>{delta.text}</span>
            )}
            <span className="text-[#4A6378]">בתקופה</span>
          </>
        ) : (
          <span className="text-[#6B8FA8]">נתונים חלקיים</span>
        )}
        {client.partial && headline !== null && (
          <span className="text-[#6B8FA8]">· נתונים חלקיים</span>
        )}
      </div>
    </button>
  );
}

// ── triage lane section ───────────────────────────────────────────────────────

export function LaneSection({
  lane,
  clients,
  busyId,
  onOpen,
}: {
  lane:    Lane;
  clients: ClientHealthSummary[];
  busyId:  string | null;
  onOpen:  (clientId: string) => void;
}) {
  const meta = LANE_META[lane];
  return (
    <section className="mb-6">
      <h2 className="flex items-center gap-2 text-sm font-bold text-[#D9E8F5] mb-3">
        <span>{meta.emoji}</span>
        <span>{meta.title}</span>
        <span className="text-[#6B8FA8] font-normal">({clients.length})</span>
      </h2>
      {clients.length === 0 ? (
        <div className="text-xs text-[#4A6378] px-1">{LANE_EMPTY_TEXT[lane]}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map((c) => (
            <ClientCard
              key={c.clientId}
              client={c}
              busy={busyId === c.clientId}
              onOpen={() => onOpen(c.clientId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── aggregates strip ──────────────────────────────────────────────────────────

function AggCard({ icon, value, label, sub }: { icon: string; value: string; label: string; sub?: string }) {
  return (
    <div className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <span className="text-lg font-bold text-[#D9E8F5]">{value}</span>
      </div>
      <div className="mt-1 text-[11px] text-[#6B8FA8]">{label}</div>
      {sub !== undefined && <div className="mt-0.5 text-[10px] text-[#4A6378]">{sub}</div>}
    </div>
  );
}

export function AggregatesStrip({ aggregates }: { aggregates: PortfolioAggregates }) {
  const lanes = aggregates.lane_counts;
  const leadsValue = aggregates.leads_total !== null ? String(aggregates.leads_total) : '—';
  const leadsSub = aggregates.leads_delta_pct !== null
    ? `${aggregates.leads_delta_pct > 0 ? '↑' : '↓'}${String(Math.abs(aggregates.leads_delta_pct))}% מול התקופה הקודמת`
    : undefined;
  const spendValue = aggregates.spend_total !== null
    ? `₪${aggregates.spend_total.toLocaleString('he-IL')}`
    : '—';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <AggCard
        icon="👥"
        value={String(aggregates.clients_total)}
        label="לקוחות בתיק"
        sub={`🔴 ${String(lanes.urgent)} · 🟡 ${String(lanes.watch)} · 🟢 ${String(lanes.ok)}`}
      />
      <AggCard icon="🧲" value={leadsValue} label="לידים בתקופה (7 ימים)" sub={leadsSub} />
      <AggCard
        icon="₪"
        value={spendValue}
        label="השקעה בפרסום"
        // Honesty label straight from the metrics registry — planned budget
        // until live platform spend lands (H4). Never rendered as "actual".
        sub={aggregates.spend_honesty_label ?? undefined}
      />
      <AggCard
        icon="📈"
        value={String(aggregates.computed_clients)}
        label="לקוחות עם מדדים מחושבים"
        sub={aggregates.metrics_capped ? 'מעל 20 לקוחות — המדדים חושבו לראש הרשימה' : undefined}
      />
    </div>
  );
}

// ── empty state ───────────────────────────────────────────────────────────────

export function PortfolioEmptyState({ icon, title, sub }: { icon: string; title: string; sub: ReactNode }) {
  return (
    <div className="text-center py-16 bg-[#111A24] border border-[#1E2F42] rounded-xl">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="text-base font-bold text-[#D9E8F5] mb-1">{title}</div>
      <div className="text-sm text-[#6B8FA8] max-w-md mx-auto leading-relaxed">{sub}</div>
    </div>
  );
}
