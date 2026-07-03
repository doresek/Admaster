// lib/digest/store.ts
//
// Persistence for `public.digests` (migration 041; VISION-DEEP §1.3).
// Conventions per lib/hypotheses/store.ts / lib/intelligence/insights.ts:
// SupabaseClient injected first, every query explicitly owner/client scoped
// (background paths run on the service-role client which bypasses RLS),
// reads select DIGEST_COLUMNS, every DB error checked.
//
// State machine (enforced here, compare-and-set on status):
//
//     draft ──approveDigest──▶ approved ──(C2 send path, OUT OF SCOPE)──▶ sent
//
//   • saveDigest UPSERTS on (client_id, kind, period_start) while the row is a
//     DRAFT — recomposition (late-ingested metrics, new diagnoses) overwrites
//     the draft freely.
//   • An 'approved' or 'sent' digest is IMMUTABLE: it is the audit artifact
//     the owner read and acted on (§1.3 — "the report is the audit trail,
//     narrated"). Rewriting it would rewrite the history behind the owner's
//     approvals, so an overwrite attempt returns a TYPED rejection instead of
//     silently clobbering. New facts belong in the NEXT period's digest.
//   • No transition ever goes backwards (sent→draft etc.) — the CAS guards
//     (.eq('status', …)) enforce this atomically even under races.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DigestKind,
  DigestRow,
  DigestSources,
  DigestStatus,
} from '@/lib/capability-contracts';
import type { DigestContent } from './types';

/** Columns of every digests read/write (mirrors migration 041). */
export const DIGEST_COLUMNS =
  'id, client_id, owner_user_id, kind, period_start, period_end, ' +
  'content, rendered_text, sources, status, created_at';

export interface SaveDigestInput {
  clientId:     string;
  ownerUserId:  string;
  kind:         DigestKind;
  periodStart:  string;
  periodEnd:    string;
  content:      DigestContent;
  renderedText: string;
  sources:      DigestSources;
}

/** Typed rejection: the period's digest is past 'draft' and must not change. */
export type SaveDigestResult =
  | { ok: true;  digest: DigestRow }
  | { ok: false; reason: 'immutable'; status: DigestStatus };

/**
 * Upsert the digest for (client, kind, period_start). Draft → overwritten
 * (recomposition); approved/sent → typed rejection (see file header). The
 * update path is a compare-and-set on status='draft', so a digest approved
 * between our read and our write is still never clobbered.
 */
export async function saveDigest(
  supabase: SupabaseClient,
  input:    SaveDigestInput,
): Promise<SaveDigestResult> {
  const existingQ = await supabase
    .from('digests')
    .select('id, status')
    .eq('client_id', input.clientId)
    .eq('owner_user_id', input.ownerUserId)
    .eq('kind', input.kind)
    .eq('period_start', input.periodStart)
    .maybeSingle()
    .overrideTypes<{ id: string; status: DigestStatus }, { merge: false }>();
  if (existingQ.error) throw new Error(`saveDigest(select): ${existingQ.error.message}`);
  const existing = existingQ.data;

  if (existing !== null && existing.status !== 'draft') {
    return { ok: false, reason: 'immutable', status: existing.status };
  }

  if (existing === null) {
    const insertQ = await supabase
      .from('digests')
      .insert({
        client_id:     input.clientId,
        owner_user_id: input.ownerUserId,
        kind:          input.kind,
        period_start:  input.periodStart,
        period_end:    input.periodEnd,
        content:       input.content,
        rendered_text: input.renderedText,
        sources:       input.sources,
        status:        'draft',
      })
      .select(DIGEST_COLUMNS)
      .single()
      .overrideTypes<DigestRow, { merge: false }>();
    if (insertQ.error) throw new Error(`saveDigest(insert): ${insertQ.error.message}`);
    return { ok: true, digest: insertQ.data };
  }

  const updateQ = await supabase
    .from('digests')
    .update({
      period_end:    input.periodEnd,
      content:       input.content,
      rendered_text: input.renderedText,
      sources:       input.sources,
    })
    .eq('id', existing.id)
    .eq('owner_user_id', input.ownerUserId)
    .eq('status', 'draft')                    // CAS: never overwrite past-draft
    .select(DIGEST_COLUMNS)
    .maybeSingle()
    .overrideTypes<DigestRow, { merge: false }>();
  if (updateQ.error) throw new Error(`saveDigest(update): ${updateQ.error.message}`);
  if (updateQ.data === null) {
    // Lost the race: someone approved/sent it between our select and update.
    const statusNow = await currentStatus(supabase, existing.id, input.ownerUserId);
    return { ok: false, reason: 'immutable', status: statusNow ?? 'approved' };
  }
  return { ok: true, digest: updateQ.data };
}

async function currentStatus(
  supabase:    SupabaseClient,
  id:          string,
  ownerUserId: string,
): Promise<DigestStatus | null> {
  const q = await supabase
    .from('digests')
    .select('status')
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<{ status: DigestStatus }, { merge: false }>();
  if (q.error) throw new Error(`saveDigest(status re-read): ${q.error.message}`);
  return q.data?.status ?? null;
}

/** Fetch one digest by id, owner-scoped. */
export async function getDigest(
  supabase:    SupabaseClient,
  id:          string,
  ownerUserId: string,
): Promise<DigestRow | null> {
  const q = await supabase
    .from('digests')
    .select(DIGEST_COLUMNS)
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<DigestRow, { merge: false }>();
  if (q.error) throw new Error(`getDigest: ${q.error.message}`);
  return q.data;
}

export interface ListDigestsFilters {
  clientId:    string;
  ownerUserId: string;
  kind?:       DigestKind;
  limit?:      number;
}

/** List a client's digests, newest period first. */
export async function listDigests(
  supabase: SupabaseClient,
  filters:  ListDigestsFilters,
): Promise<DigestRow[]> {
  let q = supabase
    .from('digests')
    .select(DIGEST_COLUMNS)
    .eq('client_id', filters.clientId)
    .eq('owner_user_id', filters.ownerUserId);
  if (filters.kind) q = q.eq('kind', filters.kind);

  const res = await q
    .order('period_start', { ascending: false })
    .limit(filters.limit ?? 20)
    .overrideTypes<DigestRow[], { merge: false }>();
  if (res.error) throw new Error(`listDigests: ${res.error.message}`);
  return res.data ?? [];
}

/** Typed outcome of the draft→approved transition. */
export type ApproveDigestResult =
  | { ok: true;  digest: DigestRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_draft'; status: DigestStatus };

/**
 * draft → approved, and ONLY that transition. Compare-and-set on
 * status='draft': approving an already-approved/sent digest (or re-drafting a
 * sent one) is rejected with a typed reason — the state machine never runs
 * backwards. Sending ('approved' → 'sent') is OUT OF SCOPE here: it is gated
 * on C2 (InforU live-send channel).
 */
export async function approveDigest(
  supabase:    SupabaseClient,
  id:          string,
  clientId:    string,
  ownerUserId: string,
): Promise<ApproveDigestResult> {
  const updateQ = await supabase
    .from('digests')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .eq('status', 'draft')
    .select(DIGEST_COLUMNS)
    .maybeSingle()
    .overrideTypes<DigestRow, { merge: false }>();
  if (updateQ.error) throw new Error(`approveDigest: ${updateQ.error.message}`);
  if (updateQ.data !== null) return { ok: true, digest: updateQ.data };

  const row = await getDigest(supabase, id, ownerUserId);
  if (row === null || row.client_id !== clientId) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'not_draft', status: row.status };
}
