// lib/intelligence/artifacts.ts
//
// Data layer for content_artifacts — the record of every concrete thing the AI
// generated FOR a client (a post, a campaign variant, a creative image, a
// landing page, …), tagged with the framework / angle / funnel-stage it used and
// the living-insight ids it was grounded on.
//
// These rows are the bridge between generation and the learning loop: a user (or
// performance data) can later attach a learning_signal to an artifact, which
// resolves the artifact's `insight_ids` and feeds the lifecycle engine.
//
// recordArtifact is BEST-EFFORT at the call site (generators must never fail a
// successful generation because the tagging insert errored) — but it surfaces
// errors to the caller so the caller can decide. listArtifacts/updateArtifactStatus
// work under either the admin or a user (RLS owner-only) client.
import type { SupabaseClient } from '@supabase/supabase-js';

/** The concrete kinds of generated content we tag and track. */
export type ArtifactType =
  | 'hook'
  | 'post'
  | 'creative_image'
  | 'ad'
  | 'campaign'
  | 'message'
  | 'landing';

/** Lifecycle status of an artifact. */
export type ArtifactStatus = 'draft' | 'approved' | 'rejected' | 'published';

/** A content_artifacts row. */
export interface ContentArtifact {
  id:            string;
  client_id:     string;
  owner_user_id: string;
  type:          ArtifactType;
  parent_id:     string | null;
  content:       Record<string, unknown>;
  avatar_ref:    Record<string, unknown> | null;
  framework:     string | null;
  angle:         string | null;
  funnel_stage:  string | null;
  hook_ref:      string | null;
  insight_ids:   string[] | null;
  generated_from: Record<string, unknown> | null;
  status:        ArtifactStatus;
  created_at:    string;
  updated_at:    string;
}

export const ARTIFACT_COLUMNS =
  'id, client_id, owner_user_id, type, parent_id, content, avatar_ref, framework, angle, ' +
  'funnel_stage, hook_ref, insight_ids, generated_from, status, created_at, updated_at';

export interface RecordArtifactInput {
  clientId:       string;
  ownerUserId:    string;
  type:           ArtifactType;
  content:        Record<string, unknown>;
  parentId?:      string | null;
  framework?:     string | null;
  angle?:         string | null;
  funnelStage?:   string | null;
  avatarRef?:     Record<string, unknown> | null;
  hookRef?:       string | null;
  insightIds?:    string[] | null;
  generatedFrom?: Record<string, unknown> | null;
  status?:        ArtifactStatus;
}

/**
 * Insert one content_artifacts row. Returns the created row. The generator
 * routes call this AFTER a successful generation; they wrap it so a failed insert
 * is logged but never breaks the response (see recordArtifactSafe).
 */
export async function recordArtifact(
  admin: SupabaseClient,
  input: RecordArtifactInput,
): Promise<ContentArtifact> {
  const { data, error } = await admin
    .from('content_artifacts')
    .insert({
      client_id:      input.clientId,
      owner_user_id:  input.ownerUserId,
      type:           input.type,
      parent_id:      input.parentId ?? null,
      content:        input.content ?? {},
      avatar_ref:     input.avatarRef ?? null,
      framework:      input.framework ?? null,
      angle:          input.angle ?? null,
      funnel_stage:   input.funnelStage ?? null,
      hook_ref:       input.hookRef ?? null,
      insight_ids:    input.insightIds && input.insightIds.length ? input.insightIds : null,
      generated_from: input.generatedFrom ?? null,
      status:         input.status ?? 'draft',
    })
    .select(ARTIFACT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ContentArtifact;
}

/**
 * Best-effort wrapper used by the generator routes: records the artifact and
 * returns it, or returns null and logs on any failure (missing env, RLS, table
 * absent). NEVER throws — tagging must not break a successful generation.
 */
export async function recordArtifactSafe(
  admin: SupabaseClient,
  input: RecordArtifactInput,
): Promise<ContentArtifact | null> {
  try {
    return await recordArtifact(admin, input);
  } catch (e: any) {
    console.error('[recordArtifact] insert failed:', e?.message ?? e);
    return null;
  }
}

/**
 * Like recordArtifactSafe but takes a factory so that even constructing the admin
 * client (e.g. a missing SUPABASE_SERVICE_ROLE_KEY) can't throw out of a
 * generator route. This is the form the routes call. NEVER throws.
 */
export async function recordArtifactWith(
  adminFactory: () => SupabaseClient,
  input:        RecordArtifactInput,
): Promise<ContentArtifact | null> {
  try {
    return await recordArtifact(adminFactory(), input);
  } catch (e: any) {
    console.error('[recordArtifact] insert failed:', e?.message ?? e);
    return null;
  }
}

/**
 * Stable, cheap, non-cryptographic hash of the grounding context (FNV-1a, hex).
 * Stored in generated_from.context_hash so identical-context generations are
 * recognizable without persisting the full prompt.
 */
export function contextHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** List a client's artifacts, newest first, optionally scoped to one type. */
export async function listArtifacts(
  supabase: SupabaseClient,
  clientId: string,
  type?:    ArtifactType,
): Promise<ContentArtifact[]> {
  let q = supabase
    .from('content_artifacts')
    .select(ARTIFACT_COLUMNS)
    .eq('client_id', clientId);
  if (type) q = q.eq('type', type);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as ContentArtifact[]) ?? [];
}

/** Patch an artifact's status (draft → approved/rejected/published). */
export async function updateArtifactStatus(
  admin:  SupabaseClient,
  id:     string,
  status: ArtifactStatus,
): Promise<ContentArtifact> {
  const { data, error } = await admin
    .from('content_artifacts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(ARTIFACT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ContentArtifact;
}
