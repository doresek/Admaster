// lib/client-core/orchestrator.ts
//
// Post-brief-submit orchestrator. Given a freshly-submitted brief, it builds the
// durable client core as LIVING KNOWLEDGE (Phase-A):
//   1. analyze   — deep 3-layer analysis of the brief into discrete candidates
//                  (lib/intelligence/analyze).
//   2. reconcile — fold the candidates into the client's living atoms
//                  (client_insights): corroborate / supersede / create, each
//                  with an insight_events audit row (lib/intelligence/lifecycle).
//   3. synthesize— project the active atoms into the StrategyAnalysis + avatar
//                  snapshot and upsert client_strategy (lib/intelligence/
//                  synthesize). This is the row the dashboard + buildAiContext
//                  read; core_generated_at is the readiness signal.
//
// This REPLACES the prior writes to meta_clients.business_analysis / .avatar —
// those columns do not exist on prod, so they were a latent silent failure.
//
// Design constraints (unchanged):
//   • IDEMPOTENT: if client_strategy.core_generated_at is newer than the brief's
//     submitted_at (and !force), it is a no-op — safe to re-run via
//     /api/client-core/run.
//   • PARTIAL-FAILURE TOLERANT: analyze+reconcile and synthesize are wrapped
//     independently; the readiness stamp is always written (best-effort), and
//     the function NEVER throws.
//   • Credit handling preserved: 'analyze_brief' on a successful analysis,
//     'avatar' when synthesis produces a non-empty avatar.
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeToInsights, type AnalysisRunner } from '@/lib/intelligence/analyze';
import { reconcileCandidates } from '@/lib/intelligence/lifecycle';
import { synthesizeStrategy } from '@/lib/intelligence/synthesize';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { deductCredits } from '@/lib/credits';

export interface OrchestrateClientCoreOpts {
  userId:   string;
  clientId: string;
  briefId:  string;
  /** Rebuild even if the core was generated after this brief. Default false. */
  force?:   boolean;
  /** Injectable analysis runner for tests (no API key / network needed). */
  analyzeRun?: AnalysisRunner;
}

export interface ClientCoreResult {
  analysis: boolean;
  avatar:   boolean;
}

/** True when the synthesized avatar carries any non-empty field. */
function avatarHasContent(avatar: Record<string, unknown> | null | undefined): boolean {
  if (!avatar) return false;
  return Object.values(avatar).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null,
  );
}

/** Stale-claim TTL (seconds) — a claim older than this is treated as abandoned. */
const BUILD_CLAIM_TTL_SECONDS = 600; // 10 minutes

/**
 * Per-client build claim (C1). Delegates to the `claim_client_build` RPC, which
 * atomically ensures a client_strategy row exists and compare-and-sets
 * core_building_at to now ONLY when it is free (null) or stale — so exactly one of
 * N concurrent builds wins. Returns true iff this caller took the claim.
 * FAILS OPEN: if the RPC errors (e.g. not yet applied), we proceed rather than
 * block a legitimate build — worst case is the pre-existing double-build race.
 */
async function acquireBuildClaim(
  admin: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc('claim_client_build', {
    p_client_id: clientId,
    p_owner: userId,
    p_ttl_seconds: BUILD_CLAIM_TTL_SECONDS,
  });
  if (error) {
    console.warn('[orchestrateClientCore] claim rpc failed, proceeding:', error.message);
    return true; // fail open
  }
  return data === true;
}

/** Release the build claim so the next run can proceed. Best-effort. */
async function releaseBuildClaim(
  admin: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<void> {
  await admin
    .from('client_strategy')
    .update({ core_building_at: null })
    .eq('client_id', clientId)
    .eq('owner_user_id', userId);
}

export async function orchestrateClientCore(
  admin: SupabaseClient,
  opts: OrchestrateClientCoreOpts,
): Promise<ClientCoreResult> {
  const { userId, clientId, briefId, force = false, analyzeRun } = opts;
  const result: ClientCoreResult = { analysis: false, avatar: false };
  let claimed = false;

  try {
    if (!userId || !clientId || !briefId) return result;

    // (0) OWNERSHIP (S1): the admin client bypasses RLS, so the target client MUST be
    //     verified to belong to this user with an explicit owner filter. Without this,
    //     a caller-supplied clientId could drive analysis/reconcile/synthesis against
    //     another tenant's living knowledge.
    const { data: ownedClient } = await admin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (!ownedClient) return result; // not the caller's client — refuse

    // (1) Load the brief; it must belong to this user AND be linked to THIS client.
    //     The link check is unconditional (no null-brief bypass) — you can only build
    //     a client's core from a brief actually tied to that client.
    const { data: brief } = await admin
      .from('briefs')
      .select('values, submitted_at, user_id, client_id')
      .eq('id', briefId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!brief) return result;
    if (brief.client_id !== clientId) return result;

    const briefValues = (brief.values ?? {}) as Record<string, string>;

    // (2) Idempotency guard: skip when the snapshot is already newer than the brief.
    const { data: strat } = await admin
      .from('client_strategy')
      .select('core_generated_at')
      .eq('client_id', clientId)
      .eq('owner_user_id', userId)
      .maybeSingle();
    if (
      !force &&
      strat?.core_generated_at &&
      brief.submitted_at &&
      new Date(strat.core_generated_at) > new Date(brief.submitted_at)
    ) {
      return result; // core already built after this brief — no-op
    }

    // (2b) BUILD CLAIM (C1): serialize per client so two concurrent submits cannot
    //      double-build atoms or double-charge credits. If we don't win the claim,
    //      another build is in-flight — no-op.
    if (!(await acquireBuildClaim(admin, clientId, userId))) {
      return result;
    }
    claimed = true;

    // (3) ANALYZE + RECONCILE — independent; deduct the analysis credit on success.
    try {
      const existing   = await listActiveInsights(admin, clientId);
      const candidates = await analyzeToInsights({ briefValues, existingActiveInsights: existing, run: analyzeRun });
      if (candidates.length) {
        await reconcileCandidates(admin, clientId, userId, candidates, {
          source: 'brief',
          sourceRef: { brief_id: briefId },
        });
        await deductCredits(admin, userId, 'analyze_brief');
        result.analysis = true;
      }
    } catch (e: any) {
      console.error('[orchestrateClientCore] analyze/reconcile failed:', e?.message);
    }

    // (4) SYNTHESIZE — only when the client has active atoms (C6). synthesizeStrategy
    //     stamps core_generated_at ("brain ready"); gating it on real atoms means the
    //     dashboard never shows "ready" over an empty/failed build. When there are no
    //     atoms at all (e.g. analyze failed on a brand-new client), we deliberately
    //     leave core_generated_at UNSET so the UI reflects not-ready (retriable via
    //     /api/client-core/run) instead of a false ready-but-empty state. Deduct the
    //     avatar credit when an avatar materializes.
    try {
      const activeAtoms = await listActiveInsights(admin, clientId);
      if (activeAtoms.length > 0) {
        const snapshot = await synthesizeStrategy(admin, clientId);
        if (snapshot && avatarHasContent(snapshot.avatar)) {
          await deductCredits(admin, userId, 'avatar');
          result.avatar = true;
        }
      }
    } catch (e: any) {
      console.error('[orchestrateClientCore] synthesize failed:', e?.message);
    }
  } catch (e: any) {
    // Never throw out of the orchestrator — it runs fire-and-forget.
    console.error('[orchestrateClientCore] unexpected:', e?.message);
  } finally {
    // Always release the build claim so the next run can proceed.
    if (claimed) {
      try {
        await releaseBuildClaim(admin, clientId, userId);
      } catch (e: any) {
        console.error('[orchestrateClientCore] release claim failed:', e?.message);
      }
    }
  }

  return result;
}
