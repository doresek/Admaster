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
  it('scores scroll_stop as an explicit, weighted dimension', () => {
    const { system } = composeJudgePrompt(variants as any, { brief: 'x', platform: 'FB' });
    expect(system).toContain('scroll_stop');            // listed in the dims + contract
    expect(system).toContain('עצירת-גלילה');            // defined as a judged dimension
    expect(system).toMatch(/pattern-interrupt/);        // craft cues present
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

  it('parses a scroll_stop sub-score per variant and computes a weighted total', () => {
    const r = parseJudge(valid, 2)!;
    // scroll_stop is parsed into dims for every variant (0 when the model omits it).
    expect(r.scores[0].dims.scroll_stop).toBe(0);
    // weighted = 0.6*score + 0.4*scroll_stop → 0.6*88 = 52.8 → 53.
    expect(r.scores[0].weighted).toBe(53);
    expect(r.scores[1].weighted).toBe(44); // 0.6*74 = 44.4 → 44
  });

  it('scroll_stop can flip the best-of-N winner even when the model picks otherwise', () => {
    // Variant 0 has the higher overall score but a weak thumb-stop; variant 1 is
    // slightly lower overall but massively more scroll-stopping. The model votes 0.
    const raw = JSON.stringify({
      variants: [
        { index: 0, score: 85, dims: { scroll_stop: 20, hook_strength: 85, clarity: 90, emotional_resonance: 80, cta_strength: 85, brand_fit: 85, awareness_match: 85, framework_adherence: 85 }, note: 'polished but scroll-past' },
        { index: 1, score: 78, dims: { scroll_stop: 96, hook_strength: 80, clarity: 75, emotional_resonance: 90, cta_strength: 74, brand_fit: 76, awareness_match: 78, framework_adherence: 74 }, note: 'stops the thumb' },
      ],
      winner_index: 0, rationale: 'x',
    });
    const r = parseJudge(raw, 2)!;
    // weighted: v0 = 0.6*85 + 0.4*20 = 59; v1 = 0.6*78 + 0.4*96 = 85.2 → 85.
    expect(r.scores[0].weighted).toBe(59);
    expect(r.scores[1].weighted).toBe(85);
    // Selection overrides the model's vote (0) because v1 is far more thumb-stopping.
    expect(r.winnerIndex).toBe(1);
  });

  it('honors the model winner_index only as a tie-breaker on equal weighted scores', () => {
    const raw = JSON.stringify({
      variants: [
        { index: 0, score: 80, dims: { scroll_stop: 80, hook_strength: 80, clarity: 80, emotional_resonance: 80, cta_strength: 80, brand_fit: 80, awareness_match: 80, framework_adherence: 80 }, note: '' },
        { index: 1, score: 80, dims: { scroll_stop: 80, hook_strength: 80, clarity: 80, emotional_resonance: 80, cta_strength: 80, brand_fit: 80, awareness_match: 80, framework_adherence: 80 }, note: '' },
      ],
      winner_index: 1, rationale: 'tie',
    });
    const r = parseJudge(raw, 2)!;
    expect(r.scores[0].weighted).toBe(r.scores[1].weighted);
    expect(r.winnerIndex).toBe(1); // model's pick honored on the tie
  });
});
