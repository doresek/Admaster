'use client';
// Leads UI presentational components — the one-tap stage-marking surface.
// The owner marks leads from the phone: big tap targets (min-h-[42px]), the
// LEGAL next stages only (legalNextStages — a button that would 409 never
// renders), closed_won opens a tiny inline ₪ input before submitting.
import { useState } from 'react';
import { Btn, Card, Chip } from '@/components/ui';
import type { FunnelLeadRow, LeadStage } from '@/lib/capability-contracts';
import {
  STAGE_FILTER_TABS,
  STAGE_HE,
  STAGE_TONE,
  SOURCE_HE,
  formatILDate,
  formatShekel,
  legalNextStages,
  parseShekelInput,
  type StageFilter,
} from './helpers';

// ─── Stage chip (current stage, colored) ──────────────────────
export function StageChip({ stage }: { stage: LeadStage }) {
  return (
    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${STAGE_TONE[stage]}`}>
      {STAGE_HE[stage]}
    </span>
  );
}

// ─── Source badge ─────────────────────────────────────────────
export function SourceBadge({ source }: { source: FunnelLeadRow['source'] }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#2A4158] bg-[#162030] text-[#6B8FA8]">
      {SOURCE_HE[source]}
    </span>
  );
}

// ─── Consent indicator (חוק הספאם) ────────────────────────────
export function ConsentMark({ consent }: { consent: boolean }) {
  return consent ? (
    <span className="text-[11px] text-[#34D399]">✓ אישר דיוור</span>
  ) : (
    <span className="text-[11px] text-[#2E4459]">—</span>
  );
}

// ─── One-tap action buttons per legal next stage ──────────────
const ACTION_VARIANT: Partial<Record<LeadStage, 'outline' | 'green' | 'red' | 'ghost'>> = {
  contacted:   'outline',
  qualified:   'outline',
  meeting:     'outline',
  closed_won:  'green',
  closed_lost: 'red',
  irrelevant:  'ghost',
};

function StageActions({
  lead,
  busy,
  onMark,
}: {
  lead: FunnelLeadRow;
  busy: boolean;
  onMark: (stage: LeadStage, value: number | null) => void;
}) {
  const [valueOpen, setValueOpen] = useState(false);
  const [valueRaw, setValueRaw] = useState('');
  const [valueErr, setValueErr] = useState(false);
  // Which button was tapped — so only IT shows the spinner while in flight.
  const [tapped, setTapped] = useState<LeadStage | null>(null);
  const next = legalNextStages(lead.current_stage);
  if (next.length === 0) return null; // terminal stage — nothing to offer

  function tap(stage: LeadStage) {
    if (stage === 'closed_won') {
      setValueOpen((open) => !open);
      setValueErr(false);
      return;
    }
    setValueOpen(false);
    setTapped(stage);
    onMark(stage, null);
  }

  function confirmWon() {
    const parsed = parseShekelInput(valueRaw);
    if (!parsed.ok) {
      setValueErr(true);
      return;
    }
    setValueErr(false);
    setValueOpen(false);
    setValueRaw('');
    setTapped('closed_won');
    onMark('closed_won', parsed.value);
  }

  return (
    <div className="mt-3 pt-3 border-t border-[#1E2F42]">
      <div className="flex flex-wrap gap-2">
        {next.map((stage) => (
          <Btn
            key={stage}
            variant={ACTION_VARIANT[stage] ?? 'outline'}
            size="sm"
            disabled={busy}
            loading={busy && tapped === stage}
            onClick={() => tap(stage)}
            className="min-h-[42px] px-4"
          >
            {STAGE_HE[stage]}
          </Btn>
        ))}
      </div>

      {valueOpen && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#6B8FA8] flex-shrink-0">₪</span>
            <input
              inputMode="decimal"
              value={valueRaw}
              onChange={(e) => setValueRaw(e.target.value)}
              placeholder="שווי העסקה — לא חובה"
              dir="ltr"
              className="flex-1 min-w-0 bg-[#162030] border border-[#1E2F42] rounded-lg px-3 py-2.5 text-[13px] text-[#D9E8F5] outline-none focus:border-[#059669] placeholder-[#2E4459] transition-colors text-left"
            />
            <Btn variant="green" size="sm" loading={busy} onClick={confirmWon} className="min-h-[42px]">
              סגור עסקה
            </Btn>
            <Btn variant="ghost" size="sm" disabled={busy} onClick={() => { setValueOpen(false); setValueErr(false); }} className="min-h-[42px]">
              ביטול
            </Btn>
          </div>
          {valueErr && (
            <div className="text-[11px] text-red-400 mt-1.5">
              הסכום לא תקין — מספר בלבד (אפשר גם להשאיר ריק).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Lead card ────────────────────────────────────────────────
export function LeadCard({
  lead,
  busy,
  error,
  onMark,
}: {
  lead: FunnelLeadRow;
  busy: boolean;
  error: string | null;
  onMark: (stage: LeadStage, value: number | null) => void;
}) {
  const displayName = lead.name ?? lead.phone ?? lead.email ?? 'ליד ללא פרטים';
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[14px] font-semibold text-[#D9E8F5] truncate">{displayName}</span>
            <StageChip stage={lead.current_stage} />
            <SourceBadge source={lead.source} />
          </div>
          <div className="flex items-center gap-3 flex-wrap text-[12px] text-[#6B8FA8]">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} dir="ltr" className="font-mono hover:text-[#3D9FFF] transition-colors">
                {lead.phone}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} dir="ltr" className="font-mono hover:text-[#3D9FFF] transition-colors truncate">
                {lead.email}
              </a>
            )}
            <span>נוצר: {formatILDate(lead.created_at)}</span>
            <ConsentMark consent={lead.consent_marketing} />
            {lead.current_stage === 'closed_won' && (
              <span className="text-[#34D399] font-semibold">
                שווי עסקה: {formatShekel(lead.value)}
              </span>
            )}
          </div>
        </div>
      </div>

      <StageActions lead={lead} busy={busy} onMark={onMark} />

      {error && (
        <div className="mt-2 text-[12px] text-red-400 bg-red-900/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </Card>
  );
}

// ─── Filter tabs with counts ──────────────────────────────────
export function FilterTabs({
  active,
  counts,
  onChange,
}: {
  active: StageFilter;
  counts: Record<StageFilter, number>;
  onChange: (filter: StageFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {STAGE_FILTER_TABS.map((t) => (
        <Chip
          key={t.id}
          label={`${t.label} (${counts[t.id]})`}
          active={active === t.id}
          onClick={() => onChange(t.id)}
        />
      ))}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────
export function LeadsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-[#111A24] border border-[#1E2F42] rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-4 w-28 rounded bg-[#1D2D3E]" />
            <div className="h-5 w-16 rounded-full bg-[#1D2D3E]" />
          </div>
          <div className="h-3 w-2/3 rounded bg-[#162030] mb-4" />
          <div className="flex gap-2">
            <div className="h-[42px] w-24 rounded-lg bg-[#162030]" />
            <div className="h-[42px] w-24 rounded-lg bg-[#162030]" />
            <div className="h-[42px] w-24 rounded-lg bg-[#162030]" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────
export function LeadsEmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="text-center py-14 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
      <div className="text-4xl mb-3 opacity-30">📇</div>
      {filtered ? (
        <>
          <div className="text-base font-semibold mb-2 text-[#6B8FA8]">אין לידים בקטגוריה הזו</div>
          <div className="text-sm">נסו סינון אחר — או ״הכל״ כדי לראות את כולם.</div>
        </>
      ) : (
        <>
          <div className="text-base font-semibold mb-2 text-[#6B8FA8]">עדיין אין לידים</div>
          <div className="text-sm">הם יופיעו כאן ברגע שדף הנחיתה יתחיל לעבוד.</div>
        </>
      )}
    </div>
  );
}
