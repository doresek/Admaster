// lib/intelligence/insights.ts
//
// Data layer for the living-knowledge atoms (client_insights) and their
// append-only audit log (insight_events). Every MUTATION here writes an
// insight_events row so the knowledge core is fully auditable.
//
// RLS is owner-only via owner_user_id; the background paths (orchestrator,
// reconcile, synthesize) use the service-role admin client which bypasses RLS,
// but every read/write is still explicitly owner/client scoped so the layer is
// correct under either client.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CONFIDENCE,
  INSIGHT_COLUMNS,
  type ClientInsight,
  type InsightEvent,
  type InsightLayer,
  type InsightSource,
  type InsightStatus,
} from './types';

const clampConfidence = (c: number): number =>
  Math.max(CONFIDENCE.MIN, Math.min(CONFIDENCE.MAX, Number.isFinite(c) ? c : CONFIDENCE.START));

export interface LogInsightEventInput {
  insightId:       string;
  clientId:        string;
  ownerUserId:     string;
  event:           InsightEvent;
  deltaConfidence?: number | null;
  signalId?:       string | null;
  reason?:         string | null;
}

/**
 * Append one row to the insight_events audit log. Best-effort: a failed audit
 * write is logged but never throws, so it can never roll back the main mutation.
 */
export async function logInsightEvent(
  admin: SupabaseClient,
  input: LogInsightEventInput,
): Promise<void> {
  try {
    const { error } = await admin.from('insight_events').insert({
      insight_id:       input.insightId,
      client_id:        input.clientId,
      owner_user_id:    input.ownerUserId,
      event:            input.event,
      delta_confidence: input.deltaConfidence ?? null,
      signal_id:        input.signalId ?? null,
      reason:           input.reason ?? null,
    });
    if (error) console.error('[logInsightEvent] insert failed:', error.message);
  } catch (e: any) {
    console.error('[logInsightEvent] exception:', e?.message);
  }
}

export interface CreateInsightInput {
  clientId:    string;
  ownerUserId: string;
  layer:       InsightLayer;
  kind:        string;
  content:     string;
  structured?: Record<string, unknown> | null;
  source:      InsightSource;
  sourceRef?:  Record<string, unknown> | null;
  confidence?: number;
}

/**
 * Create a new living atom and log its `created` event. The atom starts with
 * evidence_count = 1 (the creating evidence) and a clamped confidence
 * (defaulting to the 0.50 baseline).
 */
export async function createInsight(
  admin: SupabaseClient,
  input: CreateInsightInput,
): Promise<ClientInsight> {
  const confidence = clampConfidence(input.confidence ?? CONFIDENCE.START);

  const { data, error } = await admin
    .from('client_insights')
    .insert({
      client_id:      input.clientId,
      owner_user_id:  input.ownerUserId,
      layer:          input.layer,
      kind:           input.kind,
      content:        input.content,
      structured:     input.structured ?? null,
      source:         input.source,
      source_ref:     input.sourceRef ?? null,
      confidence,
      evidence_count: 1,
      status:         'active',
    })
    .select(INSIGHT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  const insight = data as unknown as ClientInsight;

  await logInsightEvent(admin, {
    insightId:       insight.id,
    clientId:        insight.client_id,
    ownerUserId:     insight.owner_user_id,
    event:           'created',
    deltaConfidence: confidence,
    reason:          input.sourceRef ? `source=${input.source}` : input.source,
  });

  return insight;
}

/**
 * List the active atoms for a client, highest-confidence first. Optionally
 * scoped to a single layer. Works against either the admin or a user client.
 */
export async function listActiveInsights(
  supabase: SupabaseClient,
  clientId: string,
  layer?:   InsightLayer,
): Promise<ClientInsight[]> {
  let q = supabase
    .from('client_insights')
    .select(INSIGHT_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'active');
  if (layer) q = q.eq('layer', layer);

  const { data, error } = await q.order('confidence', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as ClientInsight[]) ?? [];
}

export interface UpdateInsightFields {
  confidence?:    number;
  evidenceCount?: number;
  status?:        InsightStatus;
}

/**
 * Patch an atom's mutable lifecycle fields (confidence / evidence_count /
 * status) and bump updated_at. Returns the updated row. Does NOT log an event —
 * callers pair this with `logInsightEvent` so the event reason/delta are precise.
 */
export async function updateInsightConfidence(
  admin: SupabaseClient,
  id:    string,
  patch: UpdateInsightFields,
): Promise<ClientInsight> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.confidence    !== undefined) payload.confidence     = clampConfidence(patch.confidence);
  if (patch.evidenceCount !== undefined) payload.evidence_count = patch.evidenceCount;
  if (patch.status        !== undefined) payload.status         = patch.status;

  const { data, error } = await admin
    .from('client_insights')
    .update(payload)
    .eq('id', id)
    .select(INSIGHT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ClientInsight;
}

/**
 * Supersede an atom: mark it `superseded`, point it at the replacement, record
 * the reason, and log the `superseded` event. The atom is NEVER deleted.
 */
export async function supersedeInsight(
  admin:           SupabaseClient,
  id:              string,
  bySupersederId:  string,
  reason:          string,
): Promise<void> {
  const { data, error } = await admin
    .from('client_insights')
    .update({
      status:            'superseded',
      superseded_by:     bySupersederId,
      superseded_reason: reason,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, client_id, owner_user_id')
    .single();

  if (error) throw new Error(error.message);
  const row = data as { id: string; client_id: string; owner_user_id: string };

  await logInsightEvent(admin, {
    insightId:   row.id,
    clientId:    row.client_id,
    ownerUserId: row.owner_user_id,
    event:       'superseded',
    reason,
    signalId:    bySupersederId,
  });
}
