// Tests for lib/client-core/orchestrator.ts — the post-brief-submit core builder.
//
// Claude calls are INJECTED (analyzeRun / avatarRun), so no API key / network is
// needed. Supabase is a tiny in-memory fake: builders are chainable AND thenable
// (await on an update resolves to { error }) and maybeSingle returns per-table
// fixtures. We assert:
//   (a) idempotency guard returns early when core_generated_at > submitted_at;
//   (b) partial failure (avatar throws) still persists analysis + stamps the
//       core, and returns { analysis: true, avatar: false }.
import { describe, it, expect, vi } from 'vitest';
import { orchestrateClientCore } from '@/lib/client-core/orchestrator';

const ANALYSIS_RAW = [
  '[SCORE]77[/SCORE]',
  '[STRENGTHS]', '- חוזקה', '[/STRENGTHS]',
  '[GAPS]', '- פער', '[/GAPS]',
  '[QUESTIONS]', '- שאלה', '[/QUESTIONS]',
  '[REFINEMENTS]', '- שינוי', '[/REFINEMENTS]',
].join('\n');

// ── In-memory fake Supabase admin client ────────────────────────
function makeAdmin(opts: { brief: any; client: any }) {
  const updates: Array<{ table: string; payload: any }> = [];
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  const admin: any = {
    _updates: updates,
    _rpcCalls: rpcCalls,
    rpc(fn: string, args: any) {
      rpcCalls.push({ fn, args });
      // deduct_credits SECURITY DEFINER RPC shape
      return Promise.resolve({ data: { success: true, credits: 100 }, error: null });
    },
    from(table: string) {
      const builder: any = {
        select() { return builder; },
        update(payload: any) { updates.push({ table, payload }); return builder; },
        eq() { return builder; },
        maybeSingle() {
          if (table === 'briefs')       return Promise.resolve({ data: opts.brief, error: null });
          if (table === 'meta_clients') return Promise.resolve({ data: opts.client, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        // makes `await builder` (update().eq().eq()) resolve to { error: null }
        then(resolve: any) { resolve({ error: null }); },
      };
      return builder;
    },
  };
  return admin;
}

describe('orchestrateClientCore', () => {
  it('(a) idempotency guard: no-op when core_generated_at is newer than the brief', async () => {
    const admin = makeAdmin({
      brief:  { values: { biz_name: 'X' }, submitted_at: '2026-01-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      client: { core_generated_at: '2026-02-01T00:00:00Z' }, // newer than submitted_at
    });
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);
    const avatarRun  = vi.fn(async () => 'AVATAR');

    const result = await orchestrateClientCore(admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun, avatarRun,
    });

    expect(result).toEqual({ analysis: false, avatar: false });
    expect(analyzeRun).not.toHaveBeenCalled();
    expect(avatarRun).not.toHaveBeenCalled();
    expect(admin._updates).toHaveLength(0); // nothing persisted, no stamp
    expect(admin._rpcCalls).toHaveLength(0); // no credits deducted
  });

  it('(a2) force=true bypasses the idempotency guard', async () => {
    const admin = makeAdmin({
      brief:  { values: { biz_name: 'X' }, submitted_at: '2026-01-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      client: { core_generated_at: '2026-02-01T00:00:00Z' },
    });
    const result = await orchestrateClientCore(admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1', force: true,
      analyzeRun: async () => ANALYSIS_RAW,
      avatarRun:  async () => 'AVATAR',
    });
    expect(result).toEqual({ analysis: true, avatar: true });
  });

  it('(b) partial failure: avatar throws → analysis persisted + stamped, returns {analysis:true, avatar:false}', async () => {
    const admin = makeAdmin({
      brief:  { values: { biz_name: 'X' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      client: { core_generated_at: null }, // never built → guard passes
    });
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);
    const avatarRun  = vi.fn(async () => { throw new Error('avatar provider down'); });

    const result = await orchestrateClientCore(admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun, avatarRun,
    });

    expect(result).toEqual({ analysis: true, avatar: false });

    // analysis was persisted onto meta_clients.business_analysis
    const analysisUpdate = admin._updates.find((u: any) => 'business_analysis' in u.payload);
    expect(analysisUpdate).toBeTruthy();
    expect(analysisUpdate.payload.business_analysis.completeness_score).toBe(77);

    // avatar was NOT persisted
    expect(admin._updates.some((u: any) => 'avatar' in u.payload)).toBe(false);

    // core_generated_at was stamped despite the partial failure
    expect(admin._updates.some((u: any) => 'core_generated_at' in u.payload)).toBe(true);

    // only the analysis credit was deducted (avatar failed before its deduct)
    expect(admin._rpcCalls.map((c: any) => c.args.p_action)).toEqual(['analyze_brief']);
  });

  it('(c) Avatar v2: injected v2 runner stores a STRUCTURED avatar (not the v1 shim)', async () => {
    const admin = makeAdmin({
      brief:  { values: { biz_name: 'X', biz_what: 'מאמן כושר', pain_main: 'אין זמן' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      client: { core_generated_at: null },
    });

    const STRUCTURED = {
      name: 'דנה',
      age: '34',
      occupation: 'מנהלת שיווק',
      pains: ['אין זמן להתאמן', 'עייפות כרונית'],
      desires: ['להרגיש אנרגטית'],
      fears: ['לבזבז עוד כסף'],
      objections: ['כבר ניסיתי'],
      awareness_level: 'problem_aware',
      recommended_angle: 'story-led',
      voice_quotes: ['אני פשוט מותשת'],
      recommended_creative_angles: ['בוקר חדש'],
    };

    // v2 runner: branches on the critique system prompt; never throws → no refine.
    const avatarV2Run = vi.fn(async (system: string) => {
      if (system.includes('creative director')) {
        return JSON.stringify({
          scores: { specificity: 9, voice: 9, consistency: 9, usefulness: 9, originality: 9 },
          needs_refinement: false,
          summary: 'solid',
          top_3_issues: [],
        });
      }
      return JSON.stringify(STRUCTURED);
    });
    const avatarRun = vi.fn(async () => 'V1-AVATAR'); // must NOT be used

    const result = await orchestrateClientCore(admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1',
      analyzeRun: async () => ANALYSIS_RAW,
      avatarV2Run, avatarRun,
    });

    expect(result.avatar).toBe(true);
    expect(avatarRun).not.toHaveBeenCalled(); // v1 fallback untouched

    const avatarUpdate = admin._updates.find((u: any) => 'avatar' in u.payload);
    expect(avatarUpdate).toBeTruthy();
    expect(avatarUpdate.payload.avatar.name).toBe('דנה');
    expect(avatarUpdate.payload.avatar.pains).toContain('אין זמן להתאמן');
    expect('v1_text' in avatarUpdate.payload.avatar).toBe(false); // structured, not shim

    // core stamped + avatar credit deducted once
    expect(admin._updates.some((u: any) => 'core_generated_at' in u.payload)).toBe(true);
    expect(admin._rpcCalls.map((c: any) => c.args.p_action)).toContain('avatar');
  });

  it('(d) Avatar v2 throws → falls back to v1 { v1_text } shim, still stamps core', async () => {
    const admin = makeAdmin({
      brief:  { values: { biz_name: 'X' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      client: { core_generated_at: null },
    });

    const avatarV2Run = vi.fn(async () => { throw new Error('v2 provider down'); });
    const avatarRun   = vi.fn(async () => 'V1-AVATAR');

    const result = await orchestrateClientCore(admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1',
      analyzeRun: async () => ANALYSIS_RAW,
      avatarV2Run, avatarRun,
    });

    expect(result.avatar).toBe(true);
    expect(avatarV2Run).toHaveBeenCalled();      // v2 attempted
    expect(avatarRun).toHaveBeenCalled();        // v1 fallback used

    const avatarUpdate = admin._updates.find((u: any) => 'avatar' in u.payload);
    expect(avatarUpdate.payload.avatar).toEqual({ v1_text: 'V1-AVATAR' });

    // core_generated_at still stamped despite v2 failure
    expect(admin._updates.some((u: any) => 'core_generated_at' in u.payload)).toBe(true);
  });

  it('returns early (no work) when the brief does not belong to the user', async () => {
    const admin = makeAdmin({ brief: null, client: { core_generated_at: null } });
    const result = await orchestrateClientCore(admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1',
      analyzeRun: async () => ANALYSIS_RAW,
      avatarRun:  async () => 'AVATAR',
    });
    expect(result).toEqual({ analysis: false, avatar: false });
    expect(admin._updates).toHaveLength(0);
  });
});
