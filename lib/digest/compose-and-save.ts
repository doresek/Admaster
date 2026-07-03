// lib/digest/compose-and-save.ts
//
// The one-call pipeline: load recorded rows → compose deterministically →
// persist as a draft digest (VISION-DEEP §1.3). Recomposition on the same
// (client, kind, period_start) overwrites the DRAFT; an approved/sent digest
// is immutable (typed rejection — see lib/digest/store.ts state machine).
//
// SENDING IS OUT OF SCOPE: delivering the digest over WhatsApp (InforU) is
// gated on C2 (no live-send channel yet). This module only produces and
// persists the draft; the 'approved' → 'sent' transition belongs to the
// C2-gated send path.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DigestKind, DigestRow, DigestStatus } from '@/lib/capability-contracts';
import { composeDigest } from './compose';
import { loadDigestInputs } from './load';
import { saveDigest } from './store';
import type { ApprovalRequest } from './types';

export interface ComposeAndSaveParams {
  clientId:    string;
  ownerUserId: string;
  kind:        DigestKind;
  /** YYYY-MM-DD inclusive. */
  periodStart: string;
  /** YYYY-MM-DD inclusive. */
  periodEnd:   string;
  /**
   * Pending autonomy proposals to narrate under "ממתין לאישורך" — supplied by
   * the heartbeat (kept generic: {kind, rationale, ref}).
   */
  approvalsNeeded?: ApprovalRequest[];
}

export type ComposeAndSaveResult =
  | { ok: true;  digest: DigestRow; warnings: string[] }
  | { ok: false; reason: 'immutable'; status: DigestStatus };

/**
 * load → compose → save. Loader warnings travel into the composition (and the
 * persisted content.stats.warnings) so a skipped malformed row is visible on
 * the stored digest, not silently dropped.
 */
export async function composeAndSave(
  supabase: SupabaseClient,
  params:   ComposeAndSaveParams,
): Promise<ComposeAndSaveResult> {
  const { inputs, warnings: loadWarnings } = await loadDigestInputs(supabase, {
    clientId:    params.clientId,
    ownerUserId: params.ownerUserId,
    periodStart: params.periodStart,
    periodEnd:   params.periodEnd,
    kind:        params.kind,
  });

  const composed = composeDigest(
    { ...inputs, approvalsNeeded: params.approvalsNeeded ?? [] },
    loadWarnings,
  );

  const saved = await saveDigest(supabase, {
    clientId:     params.clientId,
    ownerUserId:  params.ownerUserId,
    kind:         params.kind,
    periodStart:  params.periodStart,
    periodEnd:    params.periodEnd,
    content:      composed.content,
    renderedText: composed.rendered_text,
    sources:      composed.sources,
  });

  if (!saved.ok) return saved;
  return { ok: true, digest: saved.digest, warnings: composed.warnings };
}
