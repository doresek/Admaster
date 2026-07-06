'use client';
// Leads — the stage-marking surface (MEASUREMENT-SPINE-PLAN §6 step 4).
// The owner sees every lead of the active client and marks funnel progress in
// one tap; closed_won optionally carries the deal value (₪). Pure consumer of
// GET/POST /api/measurement — optimistic update, rollback + Hebrew message on
// 409/error (a 409 also refetches: the list was stale).
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Alert, PageHeader, StatCard } from '@/components/ui';
import { useActiveClient } from '@/components/ClientProvider';
import type { LeadStage } from '@/lib/capability-contracts';
import {
  INITIAL_LEADS_STATE,
  countByFilter,
  formatShekel,
  leadsReducer,
  matchesFilter,
  parseLeadsPayload,
  parseMarkedLead,
  type StageFilter,
} from './helpers';
import { FilterTabs, LeadCard, LeadsEmptyState, LeadsSkeleton } from './components';

// Hebrew failure messages — every fetch outcome the owner can hit has one.
const MSG_LOAD_FAILED   = 'לא הצלחנו לטעון את הלידים — נסו לרענן את העמוד.';
const MSG_BAD_PAYLOAD   = 'קיבלנו תשובה לא צפויה מהשרת — נסו לרענן את העמוד.';
const MSG_NETWORK       = 'שגיאת רשת — העדכון לא נשמר. בדקו את החיבור ונסו שוב.';
const MSG_CONFLICT_409  = 'הסטטוס של הליד השתנה בינתיים והמעבר הזה כבר לא אפשרי — ריעננו את הרשימה.';
const MSG_MARK_FAILED   = 'לא הצלחנו לשמור את העדכון — נסו שוב בעוד רגע.';

function useLeads(clientId: string | null) {
  const [state, dispatch] = useReducer(leadsReducer, INITIAL_LEADS_STATE);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const load = useCallback(async () => {
    if (!clientId) {
      dispatch({ type: 'loaded', leads: [] });
      setLoading(false);
      setLoadErr('');
      return;
    }
    setLoading(true);
    setLoadErr('');
    try {
      const res = await fetch(`/api/measurement?clientId=${clientId}&limit=200`);
      const payload: unknown = await res.json().catch(() => null);
      const leads = res.ok ? parseLeadsPayload(payload) : null;
      if (leads === null) {
        dispatch({ type: 'loaded', leads: [] });
        setLoadErr(res.ok ? MSG_BAD_PAYLOAD : MSG_LOAD_FAILED);
      } else {
        dispatch({ type: 'loaded', leads });
      }
    } catch {
      // Network/parse failure — surfaced to the owner, never swallowed.
      dispatch({ type: 'loaded', leads: [] });
      setLoadErr(MSG_NETWORK);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  /**
   * One-tap mark: optimistic apply → POST → server row on success, rollback +
   * Hebrew message on failure. Returns the message to show (null = success).
   */
  const mark = useCallback(async (
    leadId: string,
    stage:  LeadStage,
    value:  number | null,
  ): Promise<string | null> => {
    if (!clientId) return MSG_MARK_FAILED;
    dispatch({ type: 'mark_start', leadId, stage, value });
    try {
      const res = await fetch('/api/measurement', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ clientId, leadId, stage, ...(value !== null ? { value } : {}) }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        dispatch({ type: 'mark_fail', leadId });
        if (res.status === 409) {
          void load(); // the list was stale — resync to the real stages
          return MSG_CONFLICT_409;
        }
        return MSG_MARK_FAILED;
      }
      const lead = parseMarkedLead(payload);
      if (lead === null) {
        // Persisted on the server but the payload was malformed — resync.
        void load();
        return null;
      }
      dispatch({ type: 'mark_success', leadId, lead });
      return null;
    } catch {
      dispatch({ type: 'mark_fail', leadId });
      return MSG_NETWORK;
    }
  }, [clientId, load]);

  return { leads: state.leads, loading, loadErr, mark };
}

export default function LeadsPage() {
  const { activeClient, activeClientId } = useActiveClient();
  const { leads, loading, loadErr, mark } = useLeads(activeClientId);
  const [filter, setFilter] = useState<StageFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});

  async function onMark(leadId: string, stage: LeadStage, value: number | null) {
    setBusyId(leadId);
    setLeadErrors((prev) => ({ ...prev, [leadId]: '' }));
    const err = await mark(leadId, stage, value);
    if (err !== null) setLeadErrors((prev) => ({ ...prev, [leadId]: err }));
    setBusyId(null);
  }

  const counts = useMemo(() => countByFilter(leads), [leads]);
  const visible = useMemo(
    () => leads.filter((l) => matchesFilter(l.current_stage, filter)),
    [leads, filter],
  );

  const wonLeads = leads.filter((l) => l.current_stage === 'closed_won');
  const wonValue = wonLeads.reduce((sum, l) => sum + (l.value ?? 0), 0);

  return (
    <div>
      <PageHeader
        eyebrow="מדידה"
        title="לידים"
        sub={
          activeClient
            ? `הלידים של ${activeClient.emoji} ${activeClient.name} — טאפ אחד מסמן איפה כל ליד עומד, וזה מה שמלמד את המערכת מה באמת עובד`
            : 'בחרו לקוח למעלה כדי לראות את הלידים שלו ולסמן התקדמות'
        }
      />

      {loadErr && <Alert type="red">{loadErr}</Alert>}

      {!activeClientId && !loading && (
        <div className="text-center py-14 border border-dashed border-[#2A4158] rounded-xl text-[#2E4459]">
          <div className="text-4xl mb-3 opacity-30">👆</div>
          <div className="text-base font-semibold mb-2 text-[#6B8FA8]">לא נבחר לקוח</div>
          <div className="text-sm">בחרו לקוח בסרגל העליון — הלידים שלו יופיעו כאן.</div>
        </div>
      )}

      {activeClientId && (
        <>
          {!loading && leads.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard icon="📇" value={counts.all} label="לידים" />
              <StatCard icon="✨" value={counts.new} label="חדשים" glow="rgba(10,122,255,0.14)" />
              <StatCard icon="🤝" value={wonLeads.length} label="עסקאות שנסגרו" glow="rgba(5,150,105,0.14)" />
              <StatCard icon="₪" value={formatShekel(wonValue)} label="שווי עסקאות" glow="rgba(184,149,58,0.14)" />
            </div>
          )}

          {!loading && leads.length > 0 && (
            <FilterTabs active={filter} counts={counts} onChange={setFilter} />
          )}

          {loading && <LeadsSkeleton />}

          {!loading && visible.length === 0 && (
            <LeadsEmptyState filtered={leads.length > 0} />
          )}

          {!loading && visible.length > 0 && (
            <div className="space-y-4">
              {visible.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  busy={busyId === lead.id}
                  error={leadErrors[lead.id] || null}
                  onMark={(stage, value) => onMark(lead.id, stage, value)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
