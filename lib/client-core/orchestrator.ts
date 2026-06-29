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

export async function orchestrateClientCore(
  admin: SupabaseClient,
  opts: OrchestrateClientCoreOpts,
): Promise<ClientCoreResult> {
  const { userId, clientId, briefId, force = false, analyzeRun } = opts;
  const result: ClientCoreResult = { analysis: false, avatar: false };

  try {
    if (!userId || !clientId || !briefId) return result;

    // (1) Load the brief and verify it belongs to this user/client.
    const { data: brief } = await admin
      .from('briefs')
      .select('values, submitted_at, user_id, client_id')
      .eq('id', briefId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!brief) return result;
    if (brief.client_id && brief.client_id !== clientId) return result;

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

    // (4) SYNTHESIZE — project active atoms into client_strategy (stamps
    //     core_generated_at). Deduct the avatar credit when an avatar materializes.
    try {
      const snapshot = await synthesizeStrategy(admin, clientId);
      if (snapshot && avatarHasContent(snapshot.avatar)) {
        await deductCredits(admin, userId, 'avatar');
        result.avatar = true;
      }
    } catch (e: any) {
      console.error('[orchestrateClientCore] synthesize failed:', e?.message);
    }

    // (5) Readiness stamp — always, even on partial failure, so the dashboard can
    //     stop polling. synthesizeStrategy already stamps on success; this is the
    //     best-effort safety net (upsert touches only core_generated_at).
    try {
      const now = new Date().toISOString();
      const { error } = await admin
        .from('client_strategy')
        .upsert(
          { client_id: clientId, owner_user_id: userId, core_generated_at: now, updated_at: now },
          { onConflict: 'client_id' },
        );
      if (error) console.error('[orchestrateClientCore] stamp failed:', error.message);
    } catch (e: any) {
      console.error('[orchestrateClientCore] stamp exception:', e?.message);
    }
  } catch (e: any) {
    // Never throw out of the orchestrator — it runs fire-and-forget.
    console.error('[orchestrateClientCore] unexpected:', e?.message);
  }

  return result;
}
