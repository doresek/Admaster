// app/(dashboard)/leads/helpers.ts
//
// PURE helpers for the Leads UI (MEASUREMENT-SPINE-PLAN §6 step 4) — no React,
// no fetch, no supabase. Everything here is unit-tested in __tests__/.
//
// The legal-transition knowledge is DERIVED here (forward-only pipeline with
// skips; terminal outcome stages exit nowhere) instead of importing
// lib/measurement/leads — that module drags the whole learning-lifecycle chain
// into the client bundle. The derivation is verified against the canonical
// LEGAL_TRANSITIONS map in __tests__/helpers.test.ts, stage by stage, so the
// two can never drift silently.

import type { FunnelLeadRow, LeadSource, LeadStage } from '@/lib/capability-contracts';

// ── stage model ───────────────────────────────────────────────────────────────

/** The forward pipeline, in funnel order. */
export const PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'meeting'] as const;

/** Outcome stages — terminal, no exits ever. */
export const TERMINAL_STAGES = ['closed_won', 'closed_lost', 'irrelevant'] as const;

export const ALL_STAGES: readonly LeadStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

export function isTerminalStage(stage: LeadStage): boolean {
  return TERMINAL_STAGES.some((s) => s === stage);
}

/**
 * The stages a lead may legally move to from `stage`: every LATER pipeline
 * stage (skips are legal — one-tap "closed_won" straight from new is a real
 * workflow) plus the three terminals. Terminal stages return [] — the UI must
 * never offer a button that would 409.
 */
export function legalNextStages(stage: LeadStage): readonly LeadStage[] {
  const idx = PIPELINE_STAGES.findIndex((s) => s === stage);
  if (idx === -1) return []; // terminal — no exits
  return [...PIPELINE_STAGES.slice(idx + 1), ...TERMINAL_STAGES];
}

// ── Hebrew vocabulary ─────────────────────────────────────────────────────────

/**
 * Stage labels — used both as the current-stage chip and as the one-tap
 * action-button label ("mark as X"): יצרנו קשר / רלוונטי / נקבעה פגישה /
 * נסגר ✓ / לא נסגר / לא רלוונטי.
 */
export const STAGE_HE: Record<LeadStage, string> = {
  new:         'חדש',
  contacted:   'יצרנו קשר',
  qualified:   'רלוונטי',
  meeting:     'נקבעה פגישה',
  closed_won:  'נסגר ✓',
  closed_lost: 'לא נסגר',
  irrelevant:  'לא רלוונטי',
};

/** Stage-chip tone classes (palette per command-center STATUS_TONE). */
export const STAGE_TONE: Record<LeadStage, string> = {
  new:         'text-[#7AC0FF] bg-[#0A7AFF]/12 border-[#0A7AFF]/30',
  contacted:   'text-[#6B8FA8] bg-[#1D2D3E] border-[#2A4158]',
  qualified:   'text-[#D4AF55] bg-[#B8953A]/12 border-[#B8953A]/30',
  meeting:     'text-[#D97706] bg-[#D97706]/12 border-[#D97706]/30',
  closed_won:  'text-[#34D399] bg-[#059669]/12 border-[#059669]/30',
  closed_lost: 'text-[#F87171] bg-[#DC2626]/12 border-[#DC2626]/30',
  irrelevant:  'text-[#2E4459] bg-[#111A24] border-[#1E2F42]',
};

export const SOURCE_HE: Record<LeadSource, string> = {
  landing:      'דף נחיתה',
  site:         'אתר',
  whatsapp:     'וואטסאפ',
  instant_form: 'טופס',
  call:         'שיחה',
  manual:       'ידני',
};

// ── filter tabs (stage groups) ────────────────────────────────────────────────

export type StageFilter = 'all' | 'new' | 'in_progress' | 'closed' | 'irrelevant';

export const STAGE_FILTER_TABS: readonly { id: StageFilter; label: string }[] = [
  { id: 'all',         label: 'הכל' },
  { id: 'new',         label: 'חדשים' },
  { id: 'in_progress', label: 'בטיפול' },
  { id: 'closed',      label: 'נסגרו' },
  { id: 'irrelevant',  label: 'לא רלוונטיים' },
] as const;

/** Which filter group a stage belongs to (exhaustive — TS enforces all 7). */
export function stageGroupOf(stage: LeadStage): Exclude<StageFilter, 'all'> {
  switch (stage) {
    case 'new':
      return 'new';
    case 'contacted':
    case 'qualified':
    case 'meeting':
      return 'in_progress';
    case 'closed_won':
    case 'closed_lost':
      return 'closed';
    case 'irrelevant':
      return 'irrelevant';
  }
}

export function matchesFilter(stage: LeadStage, filter: StageFilter): boolean {
  return filter === 'all' || stageGroupOf(stage) === filter;
}

export function countByFilter(leads: readonly FunnelLeadRow[]): Record<StageFilter, number> {
  const counts: Record<StageFilter, number> = {
    all: leads.length, new: 0, in_progress: 0, closed: 0, irrelevant: 0,
  };
  for (const lead of leads) counts[stageGroupOf(lead.current_stage)] += 1;
  return counts;
}

// ── IL formatting ─────────────────────────────────────────────────────────────

const IL_DATE_FMT = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem',
});

/** ISO timestamp → DD.MM.YYYY in Israel time; '—' when unparseable. */
export function formatILDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return IL_DATE_FMT.format(t);
}

/** ₪ with he-IL grouping; '—' for null. */
export function formatShekel(n: number | null): string {
  return n == null ? '—' : `₪${n.toLocaleString('he-IL')}`;
}

/** Matches the API's MAX_VALUE_ILS sanity cap. */
export const MAX_DEAL_VALUE_ILS = 100_000_000;

export type ShekelInputResult = { ok: true; value: number | null } | { ok: false };

/**
 * Parse the optional inline deal-value input: empty = "no value" (legal),
 * digits (commas/₪/spaces tolerated) = value, anything else = invalid.
 */
export function parseShekelInput(raw: string): ShekelInputResult {
  const cleaned = raw.replace(/[₪,\s]/g, '');
  if (cleaned === '') return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DEAL_VALUE_ILS) return { ok: false };
  return { ok: true, value: n };
}

// ── API-payload narrowing (runtime-checked, never structurally trusted) ───────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isLeadStage = (v: unknown): v is LeadStage => ALL_STAGES.some((s) => s === v);

const LEAD_SOURCES: readonly LeadSource[] = [
  'landing', 'site', 'whatsapp', 'instant_form', 'call', 'manual',
];
const isLeadSource = (v: unknown): v is LeadSource => LEAD_SOURCES.some((s) => s === v);

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Narrow one unknown API row into a FunnelLeadRow — null when malformed. */
export function toFunnelLeadRow(v: unknown): FunnelLeadRow | null {
  if (!isRecord(v)) return null;
  const {
    id, client_id, owner_user_id, source, source_ref, name, phone, email,
    consent_marketing, consent_recorded_at, current_stage, value, created_at, updated_at,
  } = v;
  if (typeof id !== 'string' || typeof client_id !== 'string' || typeof owner_user_id !== 'string') return null;
  if (!isLeadStage(current_stage) || !isLeadSource(source)) return null;
  if (typeof created_at !== 'string' || typeof updated_at !== 'string') return null;
  return {
    id,
    client_id,
    owner_user_id,
    source,
    source_ref:          isRecord(source_ref) ? source_ref : {},
    name:                strOrNull(name),
    phone:               strOrNull(phone),
    email:               strOrNull(email),
    consent_marketing:   consent_marketing === true,
    consent_recorded_at: strOrNull(consent_recorded_at),
    current_stage,
    value:               typeof value === 'number' && Number.isFinite(value) ? value : null,
    created_at,
    updated_at,
  };
}

/** GET /api/measurement payload → leads. null = malformed (surface an error). */
export function parseLeadsPayload(payload: unknown): FunnelLeadRow[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.leads)) return null;
  const rows: FunnelLeadRow[] = [];
  for (const item of payload.leads) {
    const row = toFunnelLeadRow(item);
    if (row === null) return null; // one corrupt row = don't trust the payload
    rows.push(row);
  }
  return rows;
}

/** POST /api/measurement success payload → the updated lead row (or null). */
export function parseMarkedLead(payload: unknown): FunnelLeadRow | null {
  if (!isRecord(payload)) return null;
  return toFunnelLeadRow(payload.lead);
}

// ── optimistic-state reducer ──────────────────────────────────────────────────

export interface LeadsState {
  leads: FunnelLeadRow[];
  /** leadId → pre-mark snapshot, kept for rollback while the POST is in flight. */
  pending: Record<string, FunnelLeadRow>;
}

export const INITIAL_LEADS_STATE: LeadsState = { leads: [], pending: {} };

export type LeadsAction =
  | { type: 'loaded'; leads: FunnelLeadRow[] }
  | { type: 'mark_start'; leadId: string; stage: LeadStage; value: number | null }
  | { type: 'mark_success'; leadId: string; lead: FunnelLeadRow }
  | { type: 'mark_fail'; leadId: string };

function withoutKey(
  map: Record<string, FunnelLeadRow>,
  key: string,
): Record<string, FunnelLeadRow> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

/**
 * Pure optimistic reducer:
 *  - mark_start applies the stage (and, for closed_won, the value) immediately
 *    and snapshots the original for rollback. Illegal/unknown/already-pending
 *    marks leave the state untouched (identity) — the UI disables buttons while
 *    a mark is in flight, and the reducer refuses to corrupt state regardless.
 *  - mark_success replaces the optimistic row with the SERVER row (source of
 *    truth — it carries updated_at and the persisted value).
 *  - mark_fail restores the snapshot.
 */
export function leadsReducer(state: LeadsState, action: LeadsAction): LeadsState {
  switch (action.type) {
    case 'loaded':
      return { leads: action.leads, pending: {} };

    case 'mark_start': {
      const lead = state.leads.find((l) => l.id === action.leadId);
      if (!lead) return state;
      if (action.leadId in state.pending) return state;
      if (!legalNextStages(lead.current_stage).some((s) => s === action.stage)) return state;
      const optimistic: FunnelLeadRow = {
        ...lead,
        current_stage: action.stage,
        ...(action.stage === 'closed_won' && action.value !== null ? { value: action.value } : {}),
      };
      return {
        leads: state.leads.map((l) => (l.id === action.leadId ? optimistic : l)),
        pending: { ...state.pending, [action.leadId]: lead },
      };
    }

    case 'mark_success': {
      if (!(action.leadId in state.pending)) return state;
      return {
        leads: state.leads.map((l) => (l.id === action.leadId ? action.lead : l)),
        pending: withoutKey(state.pending, action.leadId),
      };
    }

    case 'mark_fail': {
      const snapshot = state.pending[action.leadId];
      if (snapshot === undefined) return state;
      return {
        leads: state.leads.map((l) => (l.id === action.leadId ? snapshot : l)),
        pending: withoutKey(state.pending, action.leadId),
      };
    }
  }
}
