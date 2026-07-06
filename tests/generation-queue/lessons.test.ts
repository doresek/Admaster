// tests/generation-queue/lessons.test.ts — G1: deterministic lessons-block derivation.
import { describe, it, expect } from 'vitest';
import {
  aggregateWeakDims, recentRationales, deriveLessonsBlock, loadLearningContext,
  LESSONS_HISTORY_LIMIT, LESSONS_RATIONALE_MAX_CHARS, DIM_LABELS_HE,
} from '@/lib/generation-queue/lessons';

// Two judged rows (newest first), 3 variants total. Per-dim averages:
// scroll_stop (70+74+66)/3=70 · cta_strength (72+76+70)/3→73 · awareness_match 82
// are the chronic weak three; everything else averages higher.
const FIXTURE_ROWS = [
  {
    output: {
      scores: [
        { dims: { scroll_stop: 70, hook_strength: 80, clarity: 85, emotional_resonance: 88, cta_strength: 72, brand_fit: 84, awareness_match: 82, framework_adherence: 83 } },
        { dims: { scroll_stop: 74, hook_strength: 90, clarity: 80, emotional_resonance: 86, cta_strength: 76, brand_fit: 86, awareness_match: 84, framework_adherence: 85 } },
      ],
      why: 'המנצח עצר את הגלילה עם הוק אישי',
    },
  },
  {
    output: {
      scores: [
        { dims: { scroll_stop: 66, hook_strength: 78, clarity: 90, emotional_resonance: 84, cta_strength: 70, brand_fit: 82, awareness_match: 80, framework_adherence: 88 } },
      ],
      why: 'ה-CTA היה גנרי מדי',
    },
  },
];

describe('aggregateWeakDims', () => {
  it('averages across ALL judged variants and returns the weakest, ascending', () => {
    const weak = aggregateWeakDims(FIXTURE_ROWS);
    expect(weak).toEqual([
      { dim: 'scroll_stop',     avg: 70, n: 3 },
      { dim: 'cta_strength',    avg: 73, n: 3 },
      { dim: 'awareness_match', avg: 82, n: 3 },
    ]);
  });

  it('treats 0 as "not scored" — a missing dim never fakes a chronic weakness', () => {
    const rows = [{ output: { scores: [
      { dims: { scroll_stop: 0, hook_strength: 50, clarity: 60, cta_strength: 55, emotional_resonance: 70, brand_fit: 75, awareness_match: 72, framework_adherence: 74 } },
    ] }, why: '' }];
    const weak = aggregateWeakDims(rows);
    expect(weak.map(w => w.dim)).toEqual(['hook_strength', 'cta_strength', 'clarity']);
    expect(weak.some(w => w.dim === 'scroll_stop')).toBe(false);
  });

  it('returns [] for rows without judge scores (judge-bypass runs, legacy rows)', () => {
    expect(aggregateWeakDims([{ output: { scores: null, why: 'x' } }, { output: null }])).toEqual([]);
    expect(aggregateWeakDims([])).toEqual([]);
  });
});

describe('recentRationales', () => {
  it('keeps newest-first order, skips empties, dedupes, clips long rationales', () => {
    const long = 'א'.repeat(LESSONS_RATIONALE_MAX_CHARS + 50);
    const rows = [
      { output: { why: 'ראשון' } },
      { output: { why: '' } },
      { output: { why: 'ראשון' } },      // duplicate — dropped
      { output: { why: long } },
    ];
    const r = recentRationales(rows as never[]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBe('ראשון');
    expect(r[1]).toBe(`${'א'.repeat(LESSONS_RATIONALE_MAX_CHARS)}…`);
  });
});

describe('deriveLessonsBlock', () => {
  it('fixture rows → the exact Hebrew lessons block (fully deterministic)', () => {
    expect(deriveLessonsBlock(FIXTURE_ROWS)).toBe(
      [
        'על בסיס 2 פוסטים אחרונים שנשפטו ללקוח זה, אלו הממדים החלשים באופן עקבי (ממוצע 0-100):',
        `• ${DIM_LABELS_HE.scroll_stop} (scroll_stop) — ממוצע 70`,
        `• ${DIM_LABELS_HE.cta_strength} (cta_strength) — ממוצע 73`,
        `• ${DIM_LABELS_HE.awareness_match} (awareness_match) — ממוצע 82`,
        'נימוקי השופט האחרונים:',
        '• "המנצח עצר את הגלילה עם הוק אישי"',
        '• "ה-CTA היה גנרי מדי"',
        'בפוסט הזה תקוף את נקודות התורפה האלו במפורש — חזק אותן בכוונה תחילה, מבלי להחליש את הממדים שכבר חזקים.',
      ].join('\n')
    );
  });

  it('returns null when no row carries judge dims — nothing judged, nothing learned', () => {
    expect(deriveLessonsBlock([])).toBeNull();
    expect(deriveLessonsBlock([{ output: { why: 'רק נימוק, בלי ציונים' } }])).toBeNull();
  });
});

describe('loadLearningContext', () => {
  function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = [];
    const builder = {
      select: (...a: unknown[]) => { calls.push(['select', ...a]); return builder; },
      eq:     (...a: unknown[]) => { calls.push(['eq', ...a]);     return builder; },
      order:  (...a: unknown[]) => { calls.push(['order', ...a]);  return builder; },
      limit:  async (...a: unknown[]) => { calls.push(['limit', ...a]); return result; },
    };
    return {
      calls,
      from: (t: string) => { calls.push(['from', t]); return builder; },
    };
  }

  it('returns the derived block, scoped to user+client+master_post, limit 8', async () => {
    const sb = fakeSupabase({ data: FIXTURE_ROWS, error: null });
    const block = await loadLearningContext(sb as never, { userId: 'u1', clientId: 'c1' });
    expect(block).toContain('scroll_stop');
    expect(block).toContain('ממוצע 70');
    expect(sb.calls).toContainEqual(['from', 'generated_content']);
    expect(sb.calls).toContainEqual(['eq', 'user_id', 'u1']);
    expect(sb.calls).toContainEqual(['eq', 'client_id', 'c1']);
    expect(sb.calls).toContainEqual(['eq', 'type', 'master_post']);
    expect(sb.calls).toContainEqual(['limit', LESSONS_HISTORY_LIMIT]);
  });

  it('no client → undefined WITHOUT querying (client-scoped by design)', async () => {
    const explosive = { from: () => { throw new Error('must not query'); } };
    await expect(loadLearningContext(explosive as never, { userId: 'u1', clientId: null }))
      .resolves.toBeUndefined();
  });

  it('query error / thrown → undefined, never a failure (best-effort contract)', async () => {
    const sb = fakeSupabase({ data: null, error: { message: 'boom' } });
    await expect(loadLearningContext(sb as never, { userId: 'u1', clientId: 'c1' }))
      .resolves.toBeUndefined();
    const thrower = { from: () => { throw new Error('kaboom'); } };
    await expect(loadLearningContext(thrower as never, { userId: 'u1', clientId: 'c1' }))
      .resolves.toBeUndefined();
  });

  it('history without judge scores → undefined (prompts stay unchanged)', async () => {
    const sb = fakeSupabase({ data: [{ output: { post: 'x' } }], error: null });
    await expect(loadLearningContext(sb as never, { userId: 'u1', clientId: 'c1' }))
      .resolves.toBeUndefined();
  });
});
