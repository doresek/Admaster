'use client';
// Command Center presentational components. The product here is the WHY:
// every campaign/decision shows the grounded insights + rationale behind it.
import { type ReactNode } from 'react';
import { Card, CardLabel, Btn } from '@/components/ui';
import type {
  Campaign,
  CampaignDecision,
  Diagnosis,
  ResolvedInsight,
} from '@/app/api/command-center/shared';

// ─── Label maps (Hebrew) ─────────────────────────────────────
const STATUS_HE: Record<string, string> = {
  active: 'פעילה',
  paused: 'מושהית',
  approved: 'מאושרת',
  draft: 'טיוטה',
  pending: 'ממתינה לאישור',
  proposed: 'הוצעה',
  completed: 'הושלמה',
  archived: 'בארכיון',
};
const STATUS_TONE: Record<string, string> = {
  active: 'text-[#34D399] bg-[#059669]/12 border-[#059669]/30',
  approved: 'text-[#7AC0FF] bg-[#0A7AFF]/12 border-[#0A7AFF]/30',
  paused: 'text-[#D97706] bg-[#D97706]/12 border-[#D97706]/30',
  pending: 'text-[#D97706] bg-[#D97706]/12 border-[#D97706]/30',
  proposed: 'text-[#D97706] bg-[#D97706]/12 border-[#D97706]/30',
};
const CHANNEL_HE: Record<string, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  meta: 'מטא',
  google: 'גוגל',
  tiktok: 'טיקטוק',
  email: 'אימייל',
};
const FUNNEL_HE: Record<string, string> = {
  awareness: 'מודעות',
  consideration: 'שקילה',
  conversion: 'המרה',
  retention: 'שימור',
  acquisition: 'גיוס',
};
const DECISION_TYPE_HE: Record<string, string> = {
  budget: 'תקציב',
  targeting: 'קהל יעד',
  creative: 'קריאייטיב',
  channel: 'ערוץ',
  bid: 'הצעת מחיר',
  schedule: 'תזמון',
  pause: 'השהיה',
};

const he = (map: Record<string, string>, key: string | null, fallback?: string) =>
  (key && map[key]) || fallback || key || '—';

const shekel = (n: number | null) =>
  n == null ? '—' : `₪${Number(n).toLocaleString('he-IL')}`;

// ─── Status badge ─────────────────────────────────────────────
export function StatusBadge({ status }: { status: string | null }) {
  const tone = (status && STATUS_TONE[status]) || 'text-[#6B8FA8] bg-[#1D2D3E] border-[#2A4158]';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone}`}>
      {he(STATUS_HE, status)}
    </span>
  );
}

// ─── Confidence bar ───────────────────────────────────────────
// confidence is 0..1; render a filled bar + percentage.
export function ConfidenceBar({ value }: { value: number | null }) {
  const pct = value == null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = pct == null ? '#2A4158' : pct >= 75 ? '#34D399' : pct >= 50 ? '#7AC0FF' : '#D97706';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[#1D2D3E] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono text-[#6B8FA8] flex-shrink-0 w-9 text-left" dir="ltr">
        {pct == null ? '—' : `${pct}%`}
      </span>
    </div>
  );
}

// ─── Grounded insight card (the WHY) ──────────────────────────
export function InsightCard({ insight }: { insight: ResolvedInsight }) {
  return (
    <div className="bg-[#162030] border border-[#1E2F42] rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[14px]">💡</span>
        {insight.layer && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#2E4459]">{insight.layer}</span>
        )}
      </div>
      <div className="text-[12.5px] text-[#D9E8F5] leading-relaxed mb-2">
        {insight.content || 'תובנה ללא תוכן'}
      </div>
      <ConfidenceBar value={insight.confidence} />
    </div>
  );
}

// ─── Decision row (rationale + its grounded insights) ─────────
function DecisionBlock({ decision }: { decision: CampaignDecision }) {
  return (
    <div className="border-r-2 border-[#0A7AFF]/40 pr-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1D2D3E] text-[#7AC0FF]">
          {he(DECISION_TYPE_HE, decision.decision_type)}
        </span>
        {decision.decision && (
          <span className="text-[12px] font-semibold text-[#D9E8F5]">{decision.decision}</span>
        )}
      </div>
      {decision.rationale && (
        <div className="text-[12px] text-[#6B8FA8] leading-relaxed mb-2">{decision.rationale}</div>
      )}
      {decision.grounded.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {decision.grounded.map((g) => (
            <InsightCard key={g.id} insight={g} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── "למה" panel for a single campaign ────────────────────────
export function WhyPanel({ campaign }: { campaign: Campaign }) {
  const hasWhy =
    !!campaign.rationale ||
    campaign.grounded.length > 0 ||
    campaign.decisions.length > 0;

  return (
    <div className="mt-3 pt-3 border-t border-[#1E2F42]">
      <CardLabel>למה — ההיגיון מאחורי הקמפיין</CardLabel>

      {!hasWhy && (
        <div className="text-[12px] text-[#2E4459]">אין עדיין הסבר מתועד לקמפיין הזה.</div>
      )}

      {campaign.rationale && (
        <div className="text-[12.5px] text-[#D9E8F5] leading-relaxed mb-3">{campaign.rationale}</div>
      )}

      {campaign.grounded.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] text-[#6B8FA8] mb-2">מבוסס על התובנות:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {campaign.grounded.map((g) => (
              <InsightCard key={g.id} insight={g} />
            ))}
          </div>
        </div>
      )}

      {campaign.decisions.length > 0 && (
        <div className="space-y-3">
          <div className="text-[11px] text-[#6B8FA8]">החלטות:</div>
          {campaign.decisions.map((d) => (
            <DecisionBlock key={d.id} decision={d} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Campaign card with status, channel, budget, dry-run + actions ─
export function CampaignCard({
  campaign,
  busy,
  onAction,
}: {
  campaign: Campaign;
  busy: boolean;
  onAction: (action: 'pause' | 'resume' | 'approve') => void;
}) {
  const isActive = campaign.status === 'active';
  const needsApproval =
    campaign.status === 'proposed' || campaign.status === 'pending' || campaign.status === 'draft';

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <StatusBadge status={campaign.status} />
            {campaign.dry_run && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#B8953A]/30 bg-[#B8953A]/12 text-[#D4AF55]">
                🧪 הרצה יבשה
              </span>
            )}
            <span className="text-[11px] text-[#6B8FA8]">{he(CHANNEL_HE, campaign.channel)}</span>
            {campaign.funnel_stage && (
              <span className="text-[11px] text-[#6B8FA8]">· {he(FUNNEL_HE, campaign.funnel_stage)}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[12px] text-[#6B8FA8]">
            <span>
              תקציב יומי: <span className="font-mono text-[#D9E8F5]">{shekel(campaign.daily_budget)}</span>
            </span>
            {campaign.meta_campaign_id && (
              <span dir="ltr" className="text-[10px] text-[#2E4459]">#{campaign.meta_campaign_id}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          {needsApproval && (
            <Btn variant="green" size="sm" loading={busy} onClick={() => onAction('approve')}>
              אשר
            </Btn>
          )}
          {isActive ? (
            <Btn variant="amber" size="sm" loading={busy} onClick={() => onAction('pause')}>
              השהה
            </Btn>
          ) : (
            <Btn variant="outline" size="sm" loading={busy} onClick={() => onAction('resume')}>
              הפעל
            </Btn>
          )}
        </div>
      </div>

      <WhyPanel campaign={campaign} />
    </Card>
  );
}

// ─── Diagnoses section ("איזה קישור נכשל") ─────────────────────
export function DiagnosesSection({ diagnoses }: { diagnoses: Diagnosis[] }) {
  if (diagnoses.length === 0) return null;
  return (
    <div className="mt-8">
      <CardLabel>אבחון — איזה קישור נכשל</CardLabel>
      <div className="space-y-3">
        {diagnoses.map((d) => (
          <Card key={d.id} style={{ borderColor: 'rgba(217,119,6,.25)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[14px]">⚠️</span>
              <span className="text-[13px] font-semibold text-[#D97706]">
                {d.failed_link || 'קישור לא ידוע'}
              </span>
            </div>
            {d.rationale && (
              <div className="text-[12.5px] text-[#D9E8F5] leading-relaxed mb-3">{d.rationale}</div>
            )}
            {d.targets.length > 0 && (
              <div>
                <div className="text-[11px] text-[#6B8FA8] mb-2">תובנות קשורות:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {d.targets.map((t) => (
                    <InsightCard key={t.id} insight={t} />
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Generic empty state ──────────────────────────────────────
export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: ReactNode }) {
  return (
    <div className="text-center py-14 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
      <div className="text-4xl mb-3 opacity-30">{icon}</div>
      <div className="text-base font-semibold mb-2 text-[#6B8FA8]">{title}</div>
      <div className="text-sm">{sub}</div>
    </div>
  );
}
