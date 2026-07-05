// lib/measurement/leads.ts
//
// The canonical lead registry (funnel_leads, migration 060) — creation from
// landing submissions, append-only stage marking, and the sales-outcome bridge
// into the learning lifecycle (plan §2 "lead → stages → sale" + §4 "the loop
// finally reaches money").
//
// Conventions per lib/hypotheses/store.ts / lib/intelligence/insights.ts:
// DI'd SupabaseClient first argument, every query explicitly client+owner
// scoped (background paths run on the service-role client which bypasses RLS),
// reads via .overrideTypes<T, { merge: false }>().
//
// ── Dedupe policy (DESIGN DECISION) ──────────────────────────────────────────
// A human who inquires twice within 30 days is ONE lead re-engaging, not two
// leads — double-counting would corrupt CVR, reconciliation and CAC. Identity
// key: (client_id, normalized phone) first, then (client_id, normalized email)
// — checked as two sequential equality lookups (no PostgREST .or(): its filter
// string interpolates user-derived values, an injection surface we refuse).
// On a hit within 30d: the existing lead gets a NEW touchpoint row (the
// re-inquiry's attribution is real and kept) + a marked_via='system' stage
// event noting the re-inquiry at the lead's CURRENT stage (audit trail, no
// stage change), and consent is upgraded false→true when the new submission
// grants it (never downgraded — revocation is an explicit user action, not a
// forgotten checkbox). After 30 days the same phone/email becomes a NEW lead:
// stale re-inquiries are new demand. Dedupe LOOKUP failure fails OPEN (create
// the lead, record why) — losing dedupe beats losing a lead.
//
// ── Stage transition map (DESIGN DECISION) ───────────────────────────────────
// Forward-only funnel; skipping stages is legal (owner one-tap "closed_won"
// straight from new is a real workflow); the three outcome stages
// (closed_won / closed_lost / irrelevant) are TERMINAL — no exits, ever
// (closed_won → new is exactly the corruption the map exists to reject).
// A re-engaged closed lead re-enters as a fresh lead via the dedupe window
// (>30d) or manual creation. Same-stage re-marks are rejected as no-ops.
//
// ── Sales-outcome learning (DESIGN DECISION) ─────────────────────────────────
// On a terminal stage the lead's source campaign_item is resolved via its most
// recent touchpoint whose utm.content is a UUID (utm_content={campaign_item_id}
// is the campaign-linkage convention, plan §2) — most recent because the model
// is labeled LAST-click. The item's grounded_in atoms each receive one
// learning_signals row (signal_type 'sales_outcome' — migration 060 §6 widened
// the CHECK; the string is defined locally because lib/capability-contracts is
// read-only for this module and does not yet export it):
//   closed_won              → polarity positive, weight 0.60
//   closed_lost / irrelevant → polarity negative, weight 0.40
// E5/E3-grade evidence: strong enough to move confidence (±0.12*w via the
// lifecycle engine), deliberately BELOW the 0.70 decisive threshold — one deal
// never refutes an atom. All confidence math lives in
// lib/intelligence/lifecycle (claimSignal → applyLearningSignal, mirroring
// lib/hypotheses/resolve-and-learn); nothing here touches confidence directly.
// Per-move failures are typed outcomes, never throws: the stage event is
// already durable and must not be lost to a failed emission.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FunnelLeadRow,
  LeadSource,
  LeadStage,
  LeadStageEventRow,
  LeadTouchpointRow,
  StageMarkedVia,
} from '@/lib/capability-contracts';
import { INSIGHT_COLUMNS, type ClientInsight } from '@/lib/intelligence/types';
import { applyLearningSignal, claimSignal } from '@/lib/intelligence/lifecycle';
import { buildTouchpoint, MAX_CAPTURED_LEN, type CapturedIdentity } from './capture';

export const FUNNEL_LEAD_COLUMNS =
  'id, client_id, owner_user_id, source, source_ref, name, phone, email, ' +
  'consent_marketing, consent_recorded_at, current_stage, value, created_at, updated_at';

export const TOUCHPOINT_COLUMNS =
  'id, lead_id, client_id, owner_user_id, fbclid, gclid, ctwa_clid, meta_lead_id, ' +
  'utm, landing_path, referrer, user_agent, captured_at';

export const STAGE_EVENT_COLUMNS =
  'id, lead_id, client_id, owner_user_id, stage, value, marked_via, note, created_at';

/** Dedupe window: same phone/email within 30 days = the same human lead. */
export const DEDUPE_WINDOW_DAYS = 30;

/** migration 060 §6 widened learning_signals CHECK with this type. */
export const SALES_OUTCOME_SIGNAL_TYPE = 'sales_outcome' as const;

/** E5/E3-grade evidence weights — below CONFIDENCE.DECISIVE_WEIGHT (0.70). */
export const SALES_OUTCOME_WEIGHTS = {
  closed_won:  { polarity: 'positive', weight: 0.6 },
  closed_lost: { polarity: 'negative', weight: 0.4 },
  irrelevant:  { polarity: 'negative', weight: 0.4 },
} as const satisfies Partial<Record<LeadStage, { polarity: 'positive' | 'negative'; weight: number }>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ── contact-field normalization (public form input) ───────────────────────────

/**
 * Normalize a phone to a canonical digits form so dedupe equality works:
 * strip non-digits, convert international 972-prefix to the local leading 0
 * (0501234567 and +972-50-123-4567 are the same person). Fewer than 7 digits
 * is not a phone → null.
 */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const digits = String(v).replace(/\D/g, '');
  const local = digits.startsWith('972') ? `0${digits.slice(3)}` : digits;
  if (local.length < 7 || local.length > 15) return null;
  return local;
}

/** Lowercased, trimmed, shape-checked email — or null. */
export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase().slice(0, MAX_CAPTURED_LEN);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** First plausible name-ish field from a raw form payload, capped. */
function extractName(fields: Record<string, unknown>): string | null {
  for (const key of ['name', 'full_name', 'fullname', 'first_name']) {
    const v = fields[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, MAX_CAPTURED_LEN);
  }
  return null;
}

function extractPhone(fields: Record<string, unknown>): string | null {
  for (const key of ['phone', 'tel', 'mobile', 'whatsapp']) {
    const p = normalizePhone(fields[key]);
    if (p !== null) return p;
  }
  return null;
}

function extractEmail(fields: Record<string, unknown>): string | null {
  for (const key of ['email', 'mail']) {
    const e = normalizeEmail(fields[key]);
    if (e !== null) return e;
  }
  return null;
}

// ── createLeadFromLanding ─────────────────────────────────────────────────────

export interface CreateLeadFromLandingInput {
  clientId:    string;
  ownerUserId: string;
  /** Raw form fields as submitted (name/phone/email are extracted + normalized). */
  fields:      Record<string, unknown>;
  /** Already-validated identity (parseClickIds output — never raw input). */
  touchpoint:  CapturedIdentity;
  /** חוק הספאם: explicit, unchecked-by-default. true stamps consent_recorded_at. */
  consentMarketing: boolean;
  source?:     LeadSource;
  /** {landing_page_id?, landing_page_lead_id?, campaign_item_id?} provenance. */
  sourceRef?:  Record<string, unknown>;
  userAgent?:  string | null;
}

export type CreateLeadFromLandingResult =
  | {
      ok:           true;
      lead:         FunnelLeadRow;
      /** true = the 30d dedupe matched: touchpoint appended to an existing lead. */
      deduped:      boolean;
      touchpointId: string | null;
      /** Non-fatal degradations (dedupe lookup failed open, touchpoint insert failed…). */
      notes:        string[];
    }
  | { ok: false; reason: 'lead_insert_failed'; message: string };

/**
 * Find an existing lead by normalized phone OR email inside the dedupe window.
 * Two sequential equality lookups (no .or() — see header). Throws only on DB
 * error; the caller converts that into a fail-open note.
 */
async function findDuplicateLead(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  phone:       string | null,
  email:       string | null,
): Promise<FunnelLeadRow | null> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const [column, value] of [['phone', phone], ['email', email]] as const) {
    if (value === null) continue;
    const { data, error } = await supabase
      .from('funnel_leads')
      .select(FUNNEL_LEAD_COLUMNS)
      .eq('client_id', clientId)
      .eq('owner_user_id', ownerUserId)
      .eq(column, value)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .overrideTypes<FunnelLeadRow[], { merge: false }>();
    if (error) throw new Error(`dedupe lookup (${column}): ${error.message}`);
    if (data && data.length > 0) return data[0];
  }
  return null;
}

/** Append the touchpoint row; a failure degrades to a note (lead already durable). */
async function insertTouchpoint(
  supabase: SupabaseClient,
  input:    { leadId: string; clientId: string; ownerUserId: string; identity: CapturedIdentity; userAgent?: string | null },
  notes:    string[],
): Promise<string | null> {
  const { data, error } = await supabase
    .from('lead_touchpoints')
    .insert(buildTouchpoint(input))
    .select('id')
    .single()
    .overrideTypes<{ id: string }, { merge: false }>();
  if (error || !data) {
    notes.push(`touchpoint_insert_failed: ${error?.message ?? 'no row returned'}`);
    return null;
  }
  return data.id;
}

/**
 * Register a landing submission in the canonical funnel: dedupe → insert (or
 * re-attach) → touchpoint row → consent stamping. Returns a typed result;
 * throws never — the caller sits on the sacred lead-capture path.
 */
export async function createLeadFromLanding(
  supabase: SupabaseClient,
  input:    CreateLeadFromLandingInput,
): Promise<CreateLeadFromLandingResult> {
  const notes: string[] = [];
  const phone = extractPhone(input.fields);
  const email = extractEmail(input.fields);
  const name  = extractName(input.fields);
  const nowIso = new Date().toISOString();

  // 1) Dedupe (fail OPEN: a broken lookup must not block lead creation).
  let existing: FunnelLeadRow | null = null;
  if (phone !== null || email !== null) {
    try {
      existing = await findDuplicateLead(supabase, input.clientId, input.ownerUserId, phone, email);
    } catch (e: unknown) {
      notes.push(`dedupe_lookup_failed_open: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2a) Re-inquiry: append attribution to the existing lead, no duplicate row.
  if (existing !== null) {
    const touchpointId = await insertTouchpoint(supabase, {
      leadId: existing.id, clientId: input.clientId, ownerUserId: input.ownerUserId,
      identity: input.touchpoint, userAgent: input.userAgent ?? null,
    }, notes);

    // Audit the re-inquiry at the CURRENT stage (no transition — this is a
    // note, not a stage change; marked_via 'system' distinguishes it from
    // owner marks).
    const { error: eventError } = await supabase.from('lead_stage_events').insert({
      lead_id:       existing.id,
      client_id:     input.clientId,
      owner_user_id: input.ownerUserId,
      stage:         existing.current_stage,
      value:         null,
      marked_via:    'system',
      note:          `re-inquiry within ${DEDUPE_WINDOW_DAYS}d — new touchpoint appended`,
    });
    if (eventError) notes.push(`reinquiry_event_failed: ${eventError.message}`);

    // Consent upgrade only (false→true). Never downgraded here — see header.
    const patch: Record<string, unknown> = { updated_at: nowIso };
    if (input.consentMarketing && !existing.consent_marketing) {
      patch.consent_marketing = true;
      patch.consent_recorded_at = nowIso;
    }
    const { data: updated, error: updateError } = await supabase
      .from('funnel_leads')
      .update(patch)
      .eq('id', existing.id)
      .eq('client_id', input.clientId)
      .eq('owner_user_id', input.ownerUserId)
      .select(FUNNEL_LEAD_COLUMNS)
      .maybeSingle()
      .overrideTypes<FunnelLeadRow, { merge: false }>();
    if (updateError) notes.push(`reinquiry_update_failed: ${updateError.message}`);

    return { ok: true, lead: updated ?? existing, deduped: true, touchpointId, notes };
  }

  // 2b) New lead. consent_recorded_at is stamped ONLY when consent is true —
  // an absent/unchecked box records false with no timestamp (חוק הספאם:
  // consent is an affirmative act, so only the act gets a time).
  const { data: lead, error: leadError } = await supabase
    .from('funnel_leads')
    .insert({
      client_id:           input.clientId,
      owner_user_id:       input.ownerUserId,
      source:              input.source ?? 'landing',
      source_ref:          input.sourceRef ?? {},
      name,
      phone,
      email,
      consent_marketing:   input.consentMarketing,
      consent_recorded_at: input.consentMarketing ? nowIso : null,
      current_stage:       'new',
      value:               null,
    })
    .select(FUNNEL_LEAD_COLUMNS)
    .single()
    .overrideTypes<FunnelLeadRow, { merge: false }>();

  if (leadError || !lead) {
    return { ok: false, reason: 'lead_insert_failed', message: leadError?.message ?? 'no row returned' };
  }

  const touchpointId = await insertTouchpoint(supabase, {
    leadId: lead.id, clientId: input.clientId, ownerUserId: input.ownerUserId,
    identity: input.touchpoint, userAgent: input.userAgent ?? null,
  }, notes);

  return { ok: true, lead, deduped: false, touchpointId, notes };
}

// ── stage marking ─────────────────────────────────────────────────────────────

/**
 * The legal-transition map (see header). Key = current stage, values = stages
 * it may move to. Terminal outcome stages map to the empty list.
 */
export const LEGAL_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new:         ['contacted', 'qualified', 'meeting', 'closed_won', 'closed_lost', 'irrelevant'],
  contacted:   ['qualified', 'meeting', 'closed_won', 'closed_lost', 'irrelevant'],
  qualified:   ['meeting', 'closed_won', 'closed_lost', 'irrelevant'],
  meeting:     ['closed_won', 'closed_lost', 'irrelevant'],
  closed_won:  [],
  closed_lost: [],
  irrelevant:  [],
};

export function isLegalTransition(from: LeadStage, to: LeadStage): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Per-atom outcome of the sales-outcome emission (mirrors AtomMoveResult). */
export interface SalesOutcomeMove {
  insight_id: string;
  signal_id:  string | null;
  outcome:    'applied' | 'atom_refuted' | 'atom_missing' | 'signal_insert_failed' | 'claim_lost' | 'apply_failed';
  note?:      string;
}

/** What the learning loop did (or why it typed-skipped) for one stage mark. */
export interface SalesOutcomeReport {
  emitted: boolean;
  /** Why nothing was emitted (typed skip), when emitted=false. */
  skipped?: 'not_an_outcome_stage' | 'no_campaign_item_in_touchpoints'
          | 'campaign_item_not_found' | 'item_has_no_grounded_atoms' | 'touchpoint_read_failed';
  campaignItemId?: string;
  moves:   SalesOutcomeMove[];
}

export interface MarkStageInput {
  leadId:      string;
  clientId:    string;
  ownerUserId: string;
  stage:       LeadStage;
  /** Deal value (ILS); persisted on the event and, for closed_won, on the lead. */
  value?:      number | null;
  markedVia:   StageMarkedVia;
  note?:       string | null;
}

export type MarkStageResult =
  | { ok: true; event: LeadStageEventRow; lead: FunnelLeadRow; learning: SalesOutcomeReport }
  | { ok: false; reason: 'lead_not_found' | 'invalid_transition' | 'event_insert_failed' | 'lead_update_failed'; message: string };

/** Runtime-narrow a jsonb utm blob from the DB (never structurally trusted). */
function narrowUtm(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/**
 * Resolve the campaign_item behind the lead: most recent touchpoint whose
 * utm.content is a UUID (last-click, see header). Read failures are typed.
 */
async function resolveCampaignItemId(
  supabase:    SupabaseClient,
  leadId:      string,
  clientId:    string,
  ownerUserId: string,
): Promise<{ ok: true; itemId: string | null } | { ok: false }> {
  const { data, error } = await supabase
    .from('lead_touchpoints')
    .select(TOUCHPOINT_COLUMNS)
    .eq('lead_id', leadId)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .order('captured_at', { ascending: false })
    .overrideTypes<LeadTouchpointRow[], { merge: false }>();
  if (error) return { ok: false };

  for (const tp of data ?? []) {
    const content = narrowUtm(tp.utm).content;
    if (typeof content === 'string' && UUID_RE.test(content)) return { ok: true, itemId: content };
  }
  return { ok: true, itemId: null };
}

/**
 * Emit 'sales_outcome' learning signals onto the grounded_in atoms of the
 * lead's source campaign_item. NEVER throws — every failure mode is a typed
 * move/skip so the (already persisted) stage mark is unaffected. Mirrors
 * resolve-and-learn: signal row → claimSignal (at-most-once) →
 * applyLearningSignal (which owns ALL confidence math + audit events).
 */
async function emitSalesOutcome(
  supabase: SupabaseClient,
  lead:     FunnelLeadRow,
  stage:    keyof typeof SALES_OUTCOME_WEIGHTS,
  value:    number | null,
): Promise<SalesOutcomeReport> {
  const grade = SALES_OUTCOME_WEIGHTS[stage];

  const resolved = await resolveCampaignItemId(supabase, lead.id, lead.client_id, lead.owner_user_id);
  if (!resolved.ok) return { emitted: false, skipped: 'touchpoint_read_failed', moves: [] };
  if (resolved.itemId === null) {
    return { emitted: false, skipped: 'no_campaign_item_in_touchpoints', moves: [] };
  }

  const { data: item, error: itemError } = await supabase
    .from('campaign_items')
    .select('id, grounded_in')
    .eq('id', resolved.itemId)
    .eq('client_id', lead.client_id)
    .eq('owner_user_id', lead.owner_user_id)
    .maybeSingle()
    .overrideTypes<{ id: string; grounded_in: string[] }, { merge: false }>();
  if (itemError || !item) {
    return { emitted: false, skipped: 'campaign_item_not_found', campaignItemId: resolved.itemId, moves: [] };
  }

  const atomIds = Array.isArray(item.grounded_in) ? item.grounded_in.filter((id) => UUID_RE.test(id)) : [];
  if (atomIds.length === 0) {
    return { emitted: false, skipped: 'item_has_no_grounded_atoms', campaignItemId: item.id, moves: [] };
  }

  const reason =
    `sales_outcome ${stage}${value !== null ? ` (₪${value})` : ''} — lead ${lead.id} via item ${item.id}`;
  const moves: SalesOutcomeMove[] = [];

  for (const insightId of atomIds) {
    const { data: atomData, error: atomError } = await supabase
      .from('client_insights')
      .select(INSIGHT_COLUMNS)
      .eq('id', insightId)
      .eq('client_id', lead.client_id)
      .eq('owner_user_id', lead.owner_user_id)
      .maybeSingle()
      .overrideTypes<ClientInsight, { merge: false }>();
    if (atomError || !atomData) {
      moves.push({ insight_id: insightId, signal_id: null, outcome: 'atom_missing', ...(atomError ? { note: atomError.message } : {}) });
      continue;
    }
    const atom: ClientInsight = atomData;

    const { data: signalData, error: signalError } = await supabase
      .from('learning_signals')
      .insert({
        client_id:     lead.client_id,
        owner_user_id: lead.owner_user_id,
        insight_id:    insightId,
        signal_type:   SALES_OUTCOME_SIGNAL_TYPE,
        polarity:      grade.polarity,
        weight:        grade.weight,
        detail:        reason,
        metrics:       { lead_id: lead.id, stage, campaign_item_id: item.id, value },
        processed:     false,
      })
      .select('id')
      .single()
      .overrideTypes<{ id: string }, { merge: false }>();
    if (signalError || !signalData) {
      moves.push({ insight_id: insightId, signal_id: null, outcome: 'signal_insert_failed',
        note: signalError?.message ?? 'no row returned' });
      continue;
    }

    const won = await claimSignal(supabase, signalData.id);
    if (!won) {
      moves.push({ insight_id: insightId, signal_id: signalData.id, outcome: 'claim_lost' });
      continue;
    }

    try {
      const updated = await applyLearningSignal(supabase, atom, {
        polarity: grade.polarity,
        weight:   grade.weight,
        signalId: signalData.id,
        reason,
      });
      moves.push({
        insight_id: insightId,
        signal_id:  signalData.id,
        outcome:    updated === null ? 'atom_refuted' : 'applied',
      });
    } catch (e: unknown) {
      moves.push({ insight_id: insightId, signal_id: signalData.id, outcome: 'apply_failed',
        note: e instanceof Error ? e.message : String(e) });
    }
  }

  return { emitted: true, campaignItemId: item.id, moves };
}

function isOutcomeStage(stage: LeadStage): stage is keyof typeof SALES_OUTCOME_WEIGHTS {
  return stage === 'closed_won' || stage === 'closed_lost' || stage === 'irrelevant';
}

/**
 * Append a stage event + sync funnel_leads.current_stage (+value), then — on
 * an outcome stage — push sales-outcome signals through the lifecycle.
 * Illegal transitions are typed rejections, never writes. Persist order:
 * event first (append-only truth), lead-row sync second; a failed sync is a
 * typed error carrying the durable event id so a retry can heal, not re-mark.
 */
export async function markStage(
  supabase: SupabaseClient,
  input:    MarkStageInput,
): Promise<MarkStageResult> {
  const { data: leadData, error: leadError } = await supabase
    .from('funnel_leads')
    .select(FUNNEL_LEAD_COLUMNS)
    .eq('id', input.leadId)
    .eq('client_id', input.clientId)
    .eq('owner_user_id', input.ownerUserId)
    .maybeSingle()
    .overrideTypes<FunnelLeadRow, { merge: false }>();
  if (leadError) return { ok: false, reason: 'lead_not_found', message: leadError.message };
  if (!leadData) return { ok: false, reason: 'lead_not_found', message: `lead ${input.leadId} not found for this client` };
  const lead: FunnelLeadRow = leadData;

  if (!isLegalTransition(lead.current_stage, input.stage)) {
    return {
      ok: false, reason: 'invalid_transition',
      message: `illegal transition ${lead.current_stage} → ${input.stage}` +
        (LEGAL_TRANSITIONS[lead.current_stage].length === 0
          ? ` (${lead.current_stage} is terminal)`
          : ` (legal: ${LEGAL_TRANSITIONS[lead.current_stage].join(', ')})`),
    };
  }

  const value = typeof input.value === 'number' && Number.isFinite(input.value) && input.value >= 0
    ? input.value
    : null;

  const { data: eventData, error: eventError } = await supabase
    .from('lead_stage_events')
    .insert({
      lead_id:       lead.id,
      client_id:     input.clientId,
      owner_user_id: input.ownerUserId,
      stage:         input.stage,
      value,
      marked_via:    input.markedVia,
      note:          input.note?.trim().slice(0, 500) || null,
    })
    .select(STAGE_EVENT_COLUMNS)
    .single()
    .overrideTypes<LeadStageEventRow, { merge: false }>();
  if (eventError || !eventData) {
    return { ok: false, reason: 'event_insert_failed', message: eventError?.message ?? 'no row returned' };
  }
  const event: LeadStageEventRow = eventData;

  const leadPatch: Record<string, unknown> = {
    current_stage: input.stage,
    updated_at:    new Date().toISOString(),
  };
  // Deal value lands on the lead only at the winning mark — earlier-stage
  // "expected value" stays on events, the lead row carries realized value.
  if (input.stage === 'closed_won' && value !== null) leadPatch.value = value;

  const { data: updatedData, error: updateError } = await supabase
    .from('funnel_leads')
    .update(leadPatch)
    .eq('id', lead.id)
    .eq('client_id', input.clientId)
    .eq('owner_user_id', input.ownerUserId)
    .select(FUNNEL_LEAD_COLUMNS)
    .maybeSingle()
    .overrideTypes<FunnelLeadRow, { merge: false }>();
  if (updateError || !updatedData) {
    return {
      ok: false, reason: 'lead_update_failed',
      message: `stage event ${event.id} persisted but current_stage sync failed: ` +
        `${updateError?.message ?? 'no row returned'}`,
    };
  }
  const updated: FunnelLeadRow = updatedData;

  const learning: SalesOutcomeReport = isOutcomeStage(input.stage)
    ? await emitSalesOutcome(supabase, updated, input.stage, value)
    : { emitted: false, skipped: 'not_an_outcome_stage', moves: [] };

  return { ok: true, event, lead: updated, learning };
}

// ── listLeads (UI wave) ───────────────────────────────────────────────────────

export interface ListLeadsOptions {
  stage?: LeadStage;
  limit?: number;
}

export const LIST_LEADS_DEFAULT_LIMIT = 50;
export const LIST_LEADS_MAX_LIMIT = 200;

/** Client-scoped lead list, newest first. */
export async function listLeads(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  options:     ListLeadsOptions = {},
): Promise<FunnelLeadRow[]> {
  const limit = Math.min(
    Math.max(1, Math.trunc(options.limit ?? LIST_LEADS_DEFAULT_LIMIT)),
    LIST_LEADS_MAX_LIMIT,
  );

  let q = supabase
    .from('funnel_leads')
    .select(FUNNEL_LEAD_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (options.stage) q = q.eq('current_stage', options.stage);

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit)
    .overrideTypes<FunnelLeadRow[], { merge: false }>();
  if (error) throw new Error(`listLeads: ${error.message}`);
  return data ?? [];
}
