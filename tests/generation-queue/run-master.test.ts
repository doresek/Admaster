// tests/generation-queue/run-master.test.ts — G1 wiring: the shared runner
// (used by BOTH /api/ai/master and /batch) loads the client's judged history
// and threads the lessons block into the pipeline's writer prompts.
import { describe, it, expect, vi } from 'vitest';
import { runAndPersistMaster } from '@/lib/generation-queue/run-master';

// Artifact recording is lib/intelligence territory — stubbed, not exercised.
vi.mock('@/lib/intelligence/artifacts', () => ({
  recordArtifactWith: vi.fn(async () => ({ id: 'artifact-1' })),
  contextHash:        vi.fn(() => 'hash'),
}));

// ── Pipeline fixtures (same pattern as tests/master-studio/pipeline.test.ts) ──
const STRAT = `[AVATAR_PROFILE]\npersona: אמא\nfears: x\ndesires: y\nawareness_level: 2\nobjections: z\n[/AVATAR_PROFILE]
[RANKED_MARKETERS]\n1. halbert|Gary|🔥|a\n2. cialdini|Rob|🧲|b\n3. hormozi|Alex|💰|c\n[/RANKED_MARKETERS]`;
const POST = (t: string) => `[POST]${t}[/POST][HASHTAGS]#x[/HASHTAGS][IMAGE_PROMPT]i[/IMAGE_PROMPT][TIPS]t[/TIPS][WHATSAPP]w[/WHATSAPP]`;
const JUDGE = JSON.stringify({
  variants: [0, 1, 2].map(i => ({
    index: i, score: i === 0 ? 90 : 50,
    dims: { scroll_stop: 80, hook_strength: 80, clarity: 80, emotional_resonance: 80, cta_strength: 80, brand_fit: 80, awareness_match: 80, framework_adherence: 80 },
    note: '',
  })),
  winner_index: 0, rationale: 'כי כן',
});

function spyRunner(seenSystems: string[]) {
  return async (system: string) => {
    seenSystems.push(system);
    // Markers must be stage-UNIQUE: the injected lessons block quotes judge
    // rationales ("נימוקי השופט…"), so a bare 'שופט' would misfire on creators.
    if (system.includes('אסטרטג'))            return STRAT;
    if (system.includes('שופט קופי שיווקי')) return JUDGE;
    if (system.includes('עורך גרסה קודמת'))  return POST('משופר');
    return POST('פוסט');
  };
}

// One judged history row → lessons derivable. cta_strength is the weakest dim.
const HISTORY = [{
  output: {
    scores: [{ dims: { scroll_stop: 82, hook_strength: 85, clarity: 88, emotional_resonance: 86, cta_strength: 64, brand_fit: 84, awareness_match: 83, framework_adherence: 87 } }],
    why: 'ה-CTA היה גנרי',
  },
}];

/** Minimal user-scoped Supabase double: history select chain + insert capture. */
function fakeSupabase(historyRows: unknown[]) {
  const inserted: Record<string, unknown>[] = [];
  let selects = 0;
  const builder = {
    select: () => builder,
    eq:     () => builder,
    order:  () => builder,
    limit:  async () => { selects++; return { data: historyRows, error: null }; },
  };
  return {
    inserted,
    selectCount: () => selects,
    from: () => ({
      ...builder,
      insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; },
    }),
  };
}

function env(sb: ReturnType<typeof fakeSupabase>, runStage: (s: string, u: string, m: number) => Promise<string>, activeClientId: string | null) {
  return {
    supabase:    sb as never,
    createAdmin: (() => ({})) as never,
    runStage,
    userId: 'u1',
    activeClientId,
    ctx: { combined: '', insightIds: [] } as never,
    model: 'test-model',
  };
}

const INPUT = { brief: 'קורס יוגה', platform: 'Instagram' };

describe('runAndPersistMaster — learning-context wiring (G1)', () => {
  it('with an active client + judged history, creator prompts carry the lessons block', async () => {
    const seen: string[] = [];
    const sb = fakeSupabase(HISTORY);
    const outcome = await runAndPersistMaster(INPUT, env(sb, spyRunner(seen), 'client-1'));
    expect(outcome.ok).toBe(true);
    const creatorSystems = seen.filter(s => s.includes('המשווק שאתה מגלם'));
    expect(creatorSystems.length).toBeGreaterThan(0);
    for (const s of creatorSystems) {
      expect(s).toContain('═══ לקחים מפוסטים קודמים — חיזוק נקודות התורפה ═══');
      expect(s).toContain('cta_strength');           // the chronic weak dim, named
      expect(s).toContain('ה-CTA היה גנרי');         // the judge's rationale, quoted
    }
    // The generated_content row still persists (reliability contract intact).
    expect(sb.inserted).toHaveLength(1);
    expect((sb.inserted[0] as { type: string }).type).toBe('master_post');
  });

  it('without an active client, no history is read and prompts carry NO lessons', async () => {
    const seen: string[] = [];
    const sb = fakeSupabase(HISTORY);
    const outcome = await runAndPersistMaster(INPUT, env(sb, spyRunner(seen), null));
    expect(outcome.ok).toBe(true);
    expect(sb.selectCount()).toBe(0); // client-scoped: never queried
    for (const s of seen) expect(s).not.toContain('לקחים מפוסטים קודמים');
  });

  it('respects a caller-provided learningContext instead of loading its own', async () => {
    const seen: string[] = [];
    const sb = fakeSupabase(HISTORY);
    const outcome = await runAndPersistMaster(
      { ...INPUT, learningContext: 'לקח מותאם-אישית' }, env(sb, spyRunner(seen), 'client-1'));
    expect(outcome.ok).toBe(true);
    expect(sb.selectCount()).toBe(0); // no redundant load
    expect(seen.some(s => s.includes('לקח מותאם-אישית'))).toBe(true);
  });
});
