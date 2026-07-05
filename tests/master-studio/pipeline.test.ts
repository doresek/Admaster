// tests/master-studio/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { runMasterPipeline } from '@/lib/master-studio/pipeline';

const STRAT = `[AVATAR_PROFILE]\npersona: אמא\nfears: x\ndesires: y\nawareness_level: 2\nobjections: z\n[/AVATAR_PROFILE]
[RANKED_MARKETERS]\n1. halbert|Gary|🔥|a\n2. cialdini|Rob|🧲|b\n3. hormozi|Alex|💰|c\n[/RANKED_MARKETERS]`;
const POST = (t: string) => `[POST]${t}[/POST][HASHTAGS]#x[/HASHTAGS][IMAGE_PROMPT]i[/IMAGE_PROMPT][TIPS]t[/TIPS][WHATSAPP]w[/WHATSAPP]`;
const judge = (winner: number, winnerScore: number) => JSON.stringify({
  variants: [0, 1, 2].map(i => ({ index: i, score: i === winner ? winnerScore : 50,
    dims: { hook_strength: 50, clarity: 50, emotional_resonance: 50, cta_strength: 50, brand_fit: 50, awareness_match: 50, framework_adherence: 50 }, note: '' })),
  winner_index: winner, rationale: 'כי כן',
});

// Build a runner that answers by stage, detected from the system prompt text.
function runner(map: { strat?: string; creators?: (string | null)[]; judge?: string; editor?: string }) {
  let creatorCall = 0;
  return async (system: string, _user: string) => {
    if (system.includes('אסטרטג'))   return map.strat ?? STRAT;
    if (system.includes('שופט'))      return map.judge ?? judge(0, 90);
    if (system.includes('עורך'))      return map.editor ?? POST('משופר');
    // creator — if map.creators is provided, use the entry (null → ''); else default to a valid post
    const r = map.creators ? (map.creators[creatorCall] ?? '') : POST(`variant ${creatorCall}`);
    creatorCall++;
    return r;
  };
}
const input = { brief: 'קורס יוגה', platform: 'Instagram' };

describe('runMasterPipeline', () => {
  it('happy path: returns winner, marketers, scores; no boost when score >= 80', async () => {
    const res = await runMasterPipeline(input, runner({ judge: judge(1, 92) }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.marketers).toHaveLength(3);
      expect(res.output.winner.marketer.id).toBe('cialdini'); // survivor index 1
      expect(res.output.winner.score).toBe(92);
      expect(res.output.boosted).toBe(false);
      expect(res.output.scores).toHaveLength(3);
    }
  });

  it('runs the editor and sets boosted when winner score < 80', async () => {
    const res = await runMasterPipeline(input, runner({ judge: judge(0, 64), editor: POST('הרבה יותר חזק') }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.boosted).toBe(true);
      expect(res.output.winner.draft.post).toBe('הרבה יותר חזק');
    }
  });

  it('editor failure falls back to original winner (still ok, boosted false)', async () => {
    const res = await runMasterPipeline(input, runner({ judge: judge(0, 50), editor: 'garbage no tags' }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.boosted).toBe(false);
      expect(res.output.winner.draft.post).toBe('variant 0');
    }
  });

  it('accepts a SINGLE surviving creator — one good post is valid, never a false partial', async () => {
    const res = await runMasterPipeline(input, runner({ creators: [POST('only one'), null, null] }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output.winner.draft.post.trim().length).toBeGreaterThan(0);
  });

  it('returns ok:false only when ZERO creators parse (after retries)', async () => {
    const res = await runMasterPipeline(input, runner({ creators: [null, null, null] }) as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('creators');
  });

  it('falls back to the first survivor when the judge returns invalid json (still ok, never a partial)', async () => {
    const res = await runMasterPipeline(input, runner({ judge: 'not json at all' }) as any);
    expect(res.ok).toBe(true);
  });

  it('never ships an empty image concept — synthesizes a scroll-stop prompt when IMAGE_PROMPT is missing', async () => {
    // A post with no [IMAGE_PROMPT] tag → the winner still carries a non-empty image concept.
    const noImage = '[POST]post body here[/POST]\n[HASHTAGS]#x[/HASHTAGS]';
    const res = await runMasterPipeline(input, runner({ creators: [noImage, null, null] }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output.winner.draft.image.trim().length).toBeGreaterThan(0);
  });
});
