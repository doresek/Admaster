// lib/client-core/orchestrator.ts
//
// Post-brief-submit orchestrator (MASTER-PLAN W2.3b). Given a freshly-submitted
// brief, it builds the durable client core on meta_clients:
//   • business_analysis  ← analyzeBrief + persistBusinessAnalysis (W2.2a)
//   • avatar             ← the shared Avatar v1 generator, stored as the
//                          { v1_text } shim the AI context loader understands
//   • core_generated_at  ← stamped once, the ONLY readiness signal
//
// Design constraints:
//   • Reuses the existing analyze + avatar + credit code paths (single source
//     of truth) — it does not reinvent prompts or credit logic.
//   • IDEMPOTENT: if core_generated_at is newer than the brief's submitted_at
//     (and !force), it is a no-op. This makes the serverless fire-and-forget
//     trigger in /api/briefs/submit safe to re-run via /api/client-core/run.
//   • PARTIAL-FAILURE TOLERANT: analysis and avatar are wrapped independently;
//     whichever succeeds is persisted, the stamp is always written, and the
//     function returns which parts succeeded. It NEVER throws.
//   • Does NOT touch client_journeys.state — that column has a DB CHECK
//     constraint and no new state value is introduced. Journey transitions stay
//     with advanceJourneyOnBrief; core-readiness is signaled by
//     core_generated_at alone.
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeBrief, persistBusinessAnalysis, type BriefRunner } from '@/lib/analyze-brief';
import { generateAvatarV1, type AvatarRunner } from '@/lib/client-core/avatar';
import { deductCredits } from '@/lib/credits';

export interface OrchestrateClientCoreOpts {
  userId:   string;
  clientId: string;
  briefId:  string;
  /** Rebuild even if the core was generated after this brief. Default false. */
  force?:   boolean;
  /** Injectable Claude runners for tests (no API key / network needed). */
  analyzeRun?: BriefRunner;
  avatarRun?:  AvatarRunner;
}

export interface ClientCoreResult {
  analysis: boolean;
  avatar:   boolean;
}

export async function orchestrateClientCore(
  admin: SupabaseClient,
  opts: OrchestrateClientCoreOpts,
): Promise<ClientCoreResult> {
  const { userId, clientId, briefId, force = false, analyzeRun, avatarRun } = opts;
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

    // (2) Idempotency guard: skip when the core is already newer than the brief.
    const { data: client } = await admin
      .from('meta_clients')
      .select('core_generated_at')
      .eq('id', clientId)
      .eq('user_id', userId)
      .maybeSingle();
    if (
      !force &&
      client?.core_generated_at &&
      brief.submitted_at &&
      new Date(client.core_generated_at) > new Date(brief.submitted_at)
    ) {
      return result; // core already built after this brief — no-op
    }

    // (3) ANALYSIS — independent; persist on success, deduct credits, mark done.
    try {
      const analysis = await analyzeBrief({ briefValues, run: analyzeRun });
      await persistBusinessAnalysis(admin, { userId, clientId, analysis });
      await deductCredits(admin, userId, 'analyze_brief');
      result.analysis = true;
    } catch (e: any) {
      console.error('[orchestrateClientCore] analysis failed:', e?.message);
    }

    // (4) AVATAR v1 — independent; store as the { v1_text } shim, deduct credits.
    try {
      const text = await generateAvatarV1({ briefValues, run: avatarRun });
      if (!text) throw new Error('empty avatar text');
      const { error } = await admin
        .from('meta_clients')
        .update({ avatar: { v1_text: text } })
        .eq('id', clientId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await deductCredits(admin, userId, 'avatar');
      result.avatar = true;
    } catch (e: any) {
      console.error('[orchestrateClientCore] avatar failed:', e?.message);
    }

    // (5) Stamp core_generated_at — always, even on partial failure, so the
    //     dashboard can stop polling. Re-runs are governed by the guard above.
    try {
      const { error } = await admin
        .from('meta_clients')
        .update({ core_generated_at: new Date().toISOString() })
        .eq('id', clientId)
        .eq('user_id', userId);
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
