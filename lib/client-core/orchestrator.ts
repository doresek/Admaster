// lib/client-core/orchestrator.ts
//
// Post-brief-submit orchestrator (MASTER-PLAN W2.3b). Given a freshly-submitted
// brief, it builds the durable client core on meta_clients:
//   • business_analysis  ← analyzeBrief + persistBusinessAnalysis (W2.2a)
//   • avatar             ← the structured Avatar v2 generator (lib/avatar),
//                          stored as the structured Avatar object buildAiContext
//                          formats. Falls back to the Avatar v1 { v1_text } shim
//                          if v2 throws (W2.5a).
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
import { generateAvatarV2, type AvatarV2Runner, type AvatarInput } from '@/lib/avatar/generator';
import { deductCredits } from '@/lib/credits';

export interface OrchestrateClientCoreOpts {
  userId:   string;
  clientId: string;
  briefId:  string;
  /** Rebuild even if the core was generated after this brief. Default false. */
  force?:   boolean;
  /** Injectable Claude runners for tests (no API key / network needed). */
  analyzeRun?:  BriefRunner;
  /** Avatar v2 multi-pass runner (StageRunner shape). Defaults to a real call. */
  avatarV2Run?: AvatarV2Runner;
  /** Avatar v1 fallback runner (used only when v2 throws). */
  avatarRun?:   AvatarRunner;
}

/** Map the Hormozi×Schwartz brief fields onto the Avatar v2 generator input. */
function avatarInputFromBrief(v: Record<string, string>): AvatarInput {
  const notes = [
    v.biz_result    && `תוצאה ללקוח: ${v.biz_result}`,
    v.cust_who      && `הלקוח האידיאלי: ${v.cust_who}`,
    v.pain_main     && `הכאב הגדול: ${v.pain_main}`,
    v.pain_internal && `כאב פנימי: ${v.pain_internal}`,
    v.desire_dream  && `החלום: ${v.desire_dream}`,
    v.obj_main      && `התנגדות עיקרית: ${v.obj_main}`,
    v.obj_fear      && `הפחד הכי גדול: ${v.obj_fear}`,
    v.mkt_awareness && `רמת מודעות: ${v.mkt_awareness}`,
  ].filter(Boolean).join('\n');

  return {
    businessName: v.biz_name || null,
    product:      v.biz_what  || null,
    industry:     v.industry  || null,
    region:       'IL',
    language:     'he',
    userNotes:    notes || null,
  };
}

export interface ClientCoreResult {
  analysis: boolean;
  avatar:   boolean;
}

export async function orchestrateClientCore(
  admin: SupabaseClient,
  opts: OrchestrateClientCoreOpts,
): Promise<ClientCoreResult> {
  const { userId, clientId, briefId, force = false, analyzeRun, avatarV2Run, avatarRun } = opts;
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

    // (4) AVATAR — Avatar v2 structured generator, with the v1 { v1_text } shim
    //     as a fallback. Either path stores onto meta_clients.avatar (jsonb) and
    //     deducts the same 'avatar' credit once. buildAiContext already formats
    //     both the structured object and the legacy shim.
    try {
      let avatarValue: Record<string, unknown>;
      try {
        const { avatar } = await generateAvatarV2(avatarInputFromBrief(briefValues), avatarV2Run);
        if (!avatar || typeof avatar !== 'object') throw new Error('empty avatar object');
        avatarValue = avatar as unknown as Record<string, unknown>;
      } catch (v2err: any) {
        console.error('[orchestrateClientCore] avatar v2 failed, falling back to v1:', v2err?.message);
        const text = await generateAvatarV1({ briefValues, run: avatarRun });
        if (!text) throw new Error('empty avatar text');
        avatarValue = { v1_text: text };
      }
      const { error } = await admin
        .from('meta_clients')
        .update({ avatar: avatarValue })
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
