// lib/hypotheses/store.ts
//
// Persistence for the hypothesis ledger (table `hypotheses`, migration 034),
// following the lib/intelligence/insights.ts conventions: every function takes
// a SupabaseClient first (dependency injection — mockable in tests), every
// query is EXPLICITLY owner/client scoped even under the service-role client,
// and reads select HYPOTHESIS_COLUMNS from the shared contracts.
//
// Immutability doctrine (same as client_insights): the registration fields
// (claim, prediction, floor_spec, horizon, verdict_map, kill_rules, test_refs,
// insight_ids, domain) are FROZEN at insert. Nothing in this file ever UPDATEs
// them — a "change" is `supersedeHypothesis`, which inserts a NEW row and only
// marks the old one superseded. The only allowed UPDATE is the resolution
// (status / resolution / resolved_at), which is not part of the frozen
// registration.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HYPOTHESIS_COLUMNS,
  type HypothesisDomain,
  type HypothesisResolution,
  type HypothesisRow,
  type HypothesisStatus,
} from '@/lib/capability-contracts';
import type { RegisterHypothesisInput } from './types';

/**
 * Insert a pre-registered hypothesis (status 'open'). This is the RAW insert —
 * callers that want validation + the "already tried" duplicate guard use
 * `registerHypothesisChecked` (resolve-and-learn.ts), which runs the pure
 * validator first. registered_at is stamped here (not left to the DB default)
 * so the frozen registration timestamp is what the caller saw.
 */
export async function registerHypothesis(
  supabase: SupabaseClient,
  input:    RegisterHypothesisInput,
): Promise<HypothesisRow> {
  const { data, error } = await supabase
    .from('hypotheses')
    .insert({
      client_id:     input.clientId,
      owner_user_id: input.ownerUserId,
      insight_ids:   input.insightIds,
      claim:         input.claim,
      prediction:    input.prediction,
      floor_spec:    input.floorSpec,
      horizon:       input.horizon,
      verdict_map:   input.verdictMap,
      kill_rules:    input.killRules,
      test_refs:     input.testRefs,
      domain:        input.domain,
      status:        'open',
      // Explicit nulls (instead of DB defaults) so the returned row is a
      // complete HypothesisRow regardless of the client answering.
      resolution:    null,
      resolved_at:   null,
      superseded_by: null,
      registered_at: new Date().toISOString(),
    })
    .select(HYPOTHESIS_COLUMNS)
    .single()
    .overrideTypes<HypothesisRow, { merge: false }>();

  if (error) throw new Error(`registerHypothesis: ${error.message}`);
  return data;
}

/**
 * Fetch one hypothesis, owner-scoped (and client-scoped when the caller knows
 * the client). Owner scoping is explicit even though RLS also enforces it,
 * because background paths run on the service-role client which bypasses RLS.
 */
export async function getHypothesis(
  supabase:    SupabaseClient,
  id:          string,
  ownerUserId: string,
  clientId?:   string,
): Promise<HypothesisRow | null> {
  let q = supabase
    .from('hypotheses')
    .select(HYPOTHESIS_COLUMNS)
    .eq('id', id)
    .eq('owner_user_id', ownerUserId);
  if (clientId) q = q.eq('client_id', clientId);

  const { data, error } = await q.maybeSingle().overrideTypes<HypothesisRow, { merge: false }>();
  if (error) throw new Error(`getHypothesis: ${error.message}`);
  return data;
}

export interface ListHypothesesFilters {
  clientId:    string;
  ownerUserId: string;
  status?:     HypothesisStatus;
  domain?:     HypothesisDomain;
}

/** List a client's hypotheses, newest registration first. */
export async function listHypotheses(
  supabase: SupabaseClient,
  filters:  ListHypothesesFilters,
): Promise<HypothesisRow[]> {
  let q = supabase
    .from('hypotheses')
    .select(HYPOTHESIS_COLUMNS)
    .eq('client_id', filters.clientId)
    .eq('owner_user_id', filters.ownerUserId);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.domain) q = q.eq('domain', filters.domain);

  const { data, error } = await q
    .order('registered_at', { ascending: false })
    .overrideTypes<HypothesisRow[], { merge: false }>();
  if (error) throw new Error(`listHypotheses: ${error.message}`);
  return data ?? [];
}

export interface SupersedeResult {
  superseded:  HypothesisRow;
  replacement: HypothesisRow;
}

/**
 * "Edit" a registration the only allowed way: insert the corrected hypothesis
 * as a NEW row, then mark the old one status='superseded' + superseded_by.
 * The old row's frozen fields are untouched — post-hoc edits to verdict
 * criteria are exactly what the ledger exists to prevent. Only an OPEN
 * hypothesis can be superseded (a resolved one is history, not a draft); the
 * status guard on the UPDATE enforces that atomically.
 */
export async function supersedeHypothesis(
  supabase:    SupabaseClient,
  oldId:       string,
  replacement: RegisterHypothesisInput,
): Promise<SupersedeResult> {
  const replacementRow = await registerHypothesis(supabase, replacement);

  const { data, error } = await supabase
    .from('hypotheses')
    .update({
      status:        'superseded',
      superseded_by: replacementRow.id,
      updated_at:    new Date().toISOString(),
    })
    .eq('id', oldId)
    .eq('client_id', replacement.clientId)
    .eq('owner_user_id', replacement.ownerUserId)
    .eq('status', 'open')
    .select(HYPOTHESIS_COLUMNS)
    .maybeSingle()
    .overrideTypes<HypothesisRow, { merge: false }>();

  if (error) throw new Error(`supersedeHypothesis: ${error.message}`);
  if (!data) {
    // The replacement row stays in the ledger (append-only; it is a valid
    // registration in its own right) but the caller must know the link failed.
    throw new Error(
      `supersedeHypothesis: hypothesis ${oldId} is not open (already resolved or superseded); ` +
      `replacement ${replacementRow.id} was registered standalone`,
    );
  }
  return { superseded: data, replacement: replacementRow };
}

export interface ResolveHypothesisPatch {
  status:     Extract<HypothesisStatus, 'supported' | 'refuted' | 'inconclusive' | 'killed'>;
  resolution: HypothesisResolution;
  resolvedAt: string;
}

/**
 * Persist a resolution — the ONE legal update on a hypothesis row. The
 * `.eq('status','open')` guard makes it a compare-and-set: of two racing
 * resolvers exactly one gets the row back, the other gets null and must treat
 * the hypothesis as already resolved (resolve-and-learn relies on this for
 * emit-at-most-once).
 */
export async function resolveHypothesis(
  supabase:    SupabaseClient,
  id:          string,
  clientId:    string,
  ownerUserId: string,
  patch:       ResolveHypothesisPatch,
): Promise<HypothesisRow | null> {
  const { data, error } = await supabase
    .from('hypotheses')
    .update({
      status:      patch.status,
      resolution:  patch.resolution,
      resolved_at: patch.resolvedAt,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', id)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'open')
    .select(HYPOTHESIS_COLUMNS)
    .maybeSingle()
    .overrideTypes<HypothesisRow, { merge: false }>();

  if (error) throw new Error(`resolveHypothesis: ${error.message}`);
  return data;
}
