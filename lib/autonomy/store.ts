// lib/autonomy/store.ts
//
// Persistence for the autonomy ladder (tables client_autonomy + autonomy_events,
// migration 040), following lib/intelligence/insights.ts conventions: every
// function takes a SupabaseClient first (dependency injection — mockable in
// tests), every query is EXPLICITLY owner/client scoped even under the
// service-role client, and every DB error is checked (thrown as a typed
// AutonomyStoreError — the fail-safe in route-and-log depends on log failures
// being loud, so unlike insights' best-effort audit, autonomy audit writes
// THROW; the caller decides how to degrade).
//
// autonomy_events is append-only: the audit IS the product — the graduation
// story ("21 ימים ב-L1, 92% אישורים") is read straight off it, and it doubles
// as the incident-forensics log (§6.5). Nothing here ever updates or deletes
// an event.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AutonomyAction,
  AutonomyLevel,
  AutonomyRoute,
  ClientAutonomyRow,
} from '@/lib/capability-contracts';
import { AutonomyStoreError } from './types';

export const AUTONOMY_COLUMNS =
  'id, client_id, owner_user_id, level, caps, approvals_total, approvals_approved, ' +
  'level_since, created_at, updated_at';

/** The event vocabulary — mirrors the CHECK constraint in migration 040. */
type AutonomyEventName =
  | 'level_changed' | 'action_proposed' | 'action_approved' | 'action_rejected'
  | 'action_auto_executed' | 'action_blocked' | 'graduation_proposed';

/** Route verdict → audit event name. */
const ROUTE_EVENT: Record<AutonomyRoute['route'], AutonomyEventName> = {
  execute: 'action_auto_executed',
  propose: 'action_proposed',
  block:   'action_blocked',
};

interface EventInsert {
  clientId:    string;
  ownerUserId: string;
  event:       AutonomyEventName;
  fromLevel?:  AutonomyLevel;
  toLevel?:    AutonomyLevel;
  action?:     Record<string, unknown> | AutonomyAction | null;
  reason?:     string | null;
}

/**
 * Append one autonomy_events row. created_at is stamped client-side (not left
 * to the DB default) so countTodayActions sees the event the instant it is
 * written, under any clock the DB happens to run. THROWS on failure — route
 * composition needs to know the audit did not land (see routeAndLog).
 */
async function insertEvent(supabase: SupabaseClient, input: EventInsert): Promise<void> {
  const { error } = await supabase.from('autonomy_events').insert({
    client_id:     input.clientId,
    owner_user_id: input.ownerUserId,
    event:         input.event,
    from_level:    input.fromLevel ?? null,
    to_level:      input.toLevel ?? null,
    action:        input.action ?? null,
    reason:        input.reason ?? null,
    created_at:    new Date().toISOString(),
  });
  if (error) throw new AutonomyStoreError(`insertEvent(${input.event})`, error.message);
}

async function selectAutonomy(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<ClientAutonomyRow | null> {
  const { data, error } = await supabase
    .from('client_autonomy')
    .select(AUTONOMY_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<ClientAutonomyRow, { merge: false }>();
  if (error) throw new AutonomyStoreError('getOrCreateAutonomy', error.message);
  return data;
}

/**
 * Fetch a client's autonomy row, creating it at L1 on first touch — L1
 * (propose+approve) is the vision's DEFAULT: a new client starts with the
 * one-tap approval loop, never with autonomous spend. Insert-then-select on
 * conflict: client_id is unique, so if two callers race, one insert fails and
 * that caller re-reads the winner's row.
 */
export async function getOrCreateAutonomy(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<ClientAutonomyRow> {
  const existing = await selectAutonomy(supabase, clientId, ownerUserId);
  if (existing) return existing;

  const { data: created, error: insErr } = await supabase
    .from('client_autonomy')
    .insert({
      client_id:          clientId,
      owner_user_id:      ownerUserId,
      level:              'L1',
      caps:               {},
      approvals_total:    0,
      approvals_approved: 0,
      level_since:        new Date().toISOString(),
    })
    .select(AUTONOMY_COLUMNS)
    .single()
    .overrideTypes<ClientAutonomyRow, { merge: false }>();
  if (!insErr && created) return created;

  // Unique-violation (or any insert failure): a concurrent first-touch may
  // have won — re-select; only if the row STILL is not there is this a real error.
  const raced = await selectAutonomy(supabase, clientId, ownerUserId);
  if (raced) return raced;
  throw new AutonomyStoreError('getOrCreateAutonomy', insErr?.message ?? 'insert returned no row');
}

export interface SetLevelInput {
  clientId:    string;
  ownerUserId: string;
  level:       AutonomyLevel;
  reason:      string;
}

/**
 * Set a client's autonomy level (owner action, or graduation acceptance).
 * Writes level + resets level_since (the graduation clock restarts on every
 * change, up OR down) and appends a 'level_changed' event carrying from/to +
 * reason. Idempotent on same-level calls: no write, no event, and — crucially
 * — no level_since reset, so re-submitting the current level can never erase
 * accrued graduation progress.
 */
export async function setLevel(
  supabase: SupabaseClient,
  input:    SetLevelInput,
): Promise<ClientAutonomyRow> {
  const current = await getOrCreateAutonomy(supabase, input.clientId, input.ownerUserId);
  if (current.level === input.level) return current;
  // Capture before the UPDATE: the from-level must be what we read, not what
  // any shared reference to the row says after the write.
  const fromLevel = current.level;

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('client_autonomy')
    .update({ level: input.level, level_since: nowIso, updated_at: nowIso })
    .eq('id', current.id)
    .eq('owner_user_id', input.ownerUserId)
    .select(AUTONOMY_COLUMNS)
    .single()
    .overrideTypes<ClientAutonomyRow, { merge: false }>();
  if (error) throw new AutonomyStoreError('setLevel', error.message);

  await insertEvent(supabase, {
    clientId:    input.clientId,
    ownerUserId: input.ownerUserId,
    event:       'level_changed',
    fromLevel,
    toLevel:     input.level,
    reason:      input.reason,
  });
  return data;
}

export interface RecordProposalInput {
  clientId:    string;
  ownerUserId: string;
  action:      AutonomyAction;
  reason?:     string;
}

/**
 * Record that an action was put in front of the owner ('action_proposed').
 * Note: proposals do NOT bump approvals_total — the approval RATE is over
 * DECIDED proposals only (recordApprovalOutcome bumps both counters), so a
 * backlog of pending proposals can never drag a client's trust metric down.
 */
export async function recordProposal(
  supabase: SupabaseClient,
  input:    RecordProposalInput,
): Promise<void> {
  await insertEvent(supabase, {
    clientId:    input.clientId,
    ownerUserId: input.ownerUserId,
    event:       'action_proposed',
    action:      input.action,
    reason:      input.reason ?? input.action.rationale,
  });
}

export interface RecordApprovalOutcomeInput {
  clientId:    string;
  ownerUserId: string;
  approved:    boolean;
  /** The proposed autonomy_events row (or digest item) this decides, if known. */
  ref?:        string;
  reason?:     string;
}

/**
 * Record the owner's decision on a proposal: bumps approvals_total (+1) and
 * approvals_approved (+1 when approved) — the graduation inputs — and appends
 * an 'action_approved' / 'action_rejected' event. Read-modify-write on the
 * counters (no increment RPC exists yet); the surface is a single owner
 * tapping their own digest, so a lost increment under concurrency is a
 * cosmetic risk, not a safety one — the events remain the ground truth.
 */
export async function recordApprovalOutcome(
  supabase: SupabaseClient,
  input:    RecordApprovalOutcomeInput,
): Promise<ClientAutonomyRow> {
  const row = await getOrCreateAutonomy(supabase, input.clientId, input.ownerUserId);

  const { data, error } = await supabase
    .from('client_autonomy')
    .update({
      approvals_total:    row.approvals_total + 1,
      approvals_approved: row.approvals_approved + (input.approved ? 1 : 0),
      updated_at:         new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('owner_user_id', input.ownerUserId)
    .select(AUTONOMY_COLUMNS)
    .single()
    .overrideTypes<ClientAutonomyRow, { merge: false }>();
  if (error) throw new AutonomyStoreError('recordApprovalOutcome', error.message);

  await insertEvent(supabase, {
    clientId:    input.clientId,
    ownerUserId: input.ownerUserId,
    event:       input.approved ? 'action_approved' : 'action_rejected',
    action:      input.ref ? { ref: input.ref } : null,
    reason:      input.reason ?? null,
  });
  return data;
}

export interface LogRouteEventInput {
  clientId:    string;
  ownerUserId: string;
  action:      AutonomyAction;
  route:       AutonomyRoute;
}

/**
 * Append the audit event for one routed action — execute → 'action_auto_executed',
 * propose → 'action_proposed', block → 'action_blocked'. The `action` jsonb
 * carries the WHOLE AutonomyAction (kind, ref, impact, rationale, grounded_in):
 * the audit IS the product — the digest, the graduation story and incident
 * forensics all read from here. THROWS on failure (see insertEvent) so
 * routeAndLog can enforce the no-un-audited-execution invariant.
 */
export async function logRouteEvent(
  supabase: SupabaseClient,
  input:    LogRouteEventInput,
): Promise<void> {
  await insertEvent(supabase, {
    clientId:    input.clientId,
    ownerUserId: input.ownerUserId,
    event:       ROUTE_EVENT[input.route.route],
    action:      input.action,
    reason:      input.route.reason,
  });
}

/**
 * Count today's AUTO-EXECUTED actions for the rate limit (§6.5) — events of
 * kind 'action_auto_executed' since UTC midnight.
 *
 * Why only auto-executions count: the rate limit exists to stop a RUNAWAY
 * EXECUTION loop — the failure mode where a bug makes the system act on the
 * world twenty times in an hour. Proposals touch nothing (they are speech,
 * throttled by the digest surface), blocks already went nowhere, and
 * owner-approved actions were each individually human-gated. Counting those
 * would let a chatty-but-harmless day lock out a legitimate action; counting
 * only machine-initiated executions measures exactly the thing the limit
 * protects against. (Protective pauses DO appear in this count once executed,
 * but the pause bypass in policy.ts means the count can never block them.)
 */
export async function countTodayActions(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('autonomy_events')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .eq('event', 'action_auto_executed')
    .gte('created_at', midnight.toISOString());
  if (error) throw new AutonomyStoreError('countTodayActions', error.message);
  return count ?? 0;
}
