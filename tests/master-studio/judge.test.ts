// tests/master-studio/judge.test.ts
import { describe, it, expect } from 'vitest';
import { composeJudgePrompt, parseJudge } from '@/lib/master-studio/judge';

const variants = [
  { marketer: { id: 'halbert', name: 'Gary Halbert', emoji: '🔥' }, draft: { post: 'פוסט א', hashtags: [], image: '', tips: '', whatsapp: '', principles: [] } },
  { marketer: { id: 'cialdini', name: 'Robert Cialdini', emoji: '🧲' }, draft: { post: 'פוסט ב', hashtags: [], image: '', tips: '', whatsapp: '', principles: [] } },
];

describe('composeJudgePrompt', () => {
  it('numbers each variant and lists scoring dims', () => {
    const { system, user } = composeJudgePrompt(variants as any, { brief: 'x', platform: 'FB' });
    expect(user).toContain('Variant 0');
    expect(user).toContain('Variant 1');
    expect(user).toContain('פוסט א');
    expect(system).toContain('hook_strength');
    expect(system).toContain('winner_index');
  });
});

describe('parseJudge', () => {
  const valid = JSON.stringify({
    variants: [
      { index: 0, score: 88, dims: { hook_strength: 90, clarity: 85, emotional_resonance: 92, cta_strength: 80, brand_fit: 88, awareness_match: 90, framework_adherence: 86 }, note: 'חזק' },
      { index: 1, score: 74, dims: { hook_strength: 70, clarity: 80, emotional_resonance: 72, cta_strength: 70, brand_fit: 75, awareness_match: 74, framework_adherence: 78 }, note: 'בסדר' },
    ],
    winner_index: 0, rationale: 'הראשון רגשי יותר',
  });

  it('parses scores, winner and rationale', () => {
    const r = parseJudge(valid, 2)!;
    expect(r.winnerIndex).toBe(0);
    expect(r.scores).toHaveLength(2);
    expect(r.scores[0].score).toBe(88);
    expect(r.rationale).toContain('רגשי');
  });
  it('strips ```json fences', () => {
    expect(parseJudge('```json\n' + valid + '\n```', 2)).not.toBeNull();
  });
  it('returns null on invalid json', () => {
    expect(parseJudge('not json', 2)).toBeNull();
  });
  it('falls back winner to highest score when winner_index out of range', () => {
    const bad = JSON.parse(valid); bad.winner_index = 9;
    const r = parseJudge(JSON.stringify(bad), 2)!;
    expect(r.winnerIndex).toBe(0); // index 0 has score 88 > 74
  });
});
