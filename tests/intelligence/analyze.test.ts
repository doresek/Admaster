// Tests for lib/intelligence/analyze.ts — the deep 3-layer analyzer.
// The LLM is injected, so no API key/network is needed.
import { describe, it, expect, vi } from 'vitest';
import { analyzeToInsights, composeAnalysisPrompt, parseAnalysis } from '@/lib/intelligence/analyze';

const RAW = [
  'בלה בלה לפני הבלוק',
  '[INSIGHTS]',
  'business | real_usp | הליווי האישי הצמוד הוא הבידול האמיתי | 0.85 | הבריף מדגיש מעקב יומי',
  'business | constraint | תקציב מדיה מוגבל | 0.6 | צוין במפורש',
  'customers | pain | אין לי זמן להתאמן | 0.9 | כאב מרכזי בבריף',
  'customers | awareness | Problem-aware | 0.7 | מזהים כאב בלי פתרון',
  'bridge | angle | תתחיל בלי לשנות את היום שלך | 0.65 | מגשר זמן מול תוצאה',
  'שורה לא תקינה בלי מפרידים',
  'unknownlayer | foo | bar | 0.5 | nope',
  '[/INSIGHTS]',
].join('\n');

describe('parseAnalysis', () => {
  it('parses pipe rows across all 3 layers, clamps confidence, drops junk + unknown layers', () => {
    const cands = parseAnalysis(RAW);
    expect(cands).toHaveLength(5);
    expect(cands.map((c) => c.layer).sort()).toEqual(['bridge', 'business', 'business', 'customers', 'customers']);

    const usp = cands.find((c) => c.kind === 'real_usp')!;
    expect(usp.layer).toBe('business');
    expect(usp.content).toContain('הליווי האישי');
    expect(usp.confidence).toBeCloseTo(0.85, 5);
    expect(usp.rationale).toContain('מעקב יומי');

    // no unknown-layer rows survived
    expect(cands.some((c) => (c.layer as string) === 'unknownlayer')).toBe(false);
  });

  it('clamps out-of-range / missing confidence to [0..1] / 0.5 default', () => {
    const cands = parseAnalysis(
      '[INSIGHTS]\nbusiness | goal | a | 5 | r\ncustomers | pain | b | | r2\nbridge | hook | c\n[/INSIGHTS]',
    );
    expect(cands[0].confidence).toBe(1);   // 5 clamped to 1
    expect(cands[1].confidence).toBe(0.5); // empty -> default
    expect(cands[2].confidence).toBe(0.5); // missing column -> default
    expect(cands[2].rationale).toBe('');
  });

  it('never throws on garbage and returns []', () => {
    expect(parseAnalysis('')).toEqual([]);
    expect(parseAnalysis('no tags, no pipes')).toEqual([]);
    // @ts-expect-error testing non-string input
    expect(parseAnalysis(null)).toEqual([]);
  });

  it('tolerates a missing [INSIGHTS] wrapper (falls back to whole text)', () => {
    const cands = parseAnalysis('business | usp | x | 0.7 | r');
    expect(cands).toHaveLength(1);
    expect(cands[0].kind).toBe('usp');
  });
});

describe('composeAnalysisPrompt', () => {
  it('is Hebrew, lists all 3 layers + their kinds, and serializes the brief', () => {
    const { system, user } = composeAnalysisPrompt({ biz_name: 'Bloom' }, []);
    expect(system).toContain('business');
    expect(system).toContain('customers');
    expect(system).toContain('bridge');
    expect(system).toContain('real_usp');     // a business kind
    expect(system).toContain('unspoken_want'); // a customers kind
    expect(system).toContain('[INSIGHTS]');
    expect(user).toContain('"biz_name": "Bloom"');
  });

  it('consumes the Group-A owner fields and explains how to map them', () => {
    const { system } = composeAnalysisPrompt({}, []);
    // owner-language keys are named explicitly so the model maps them
    for (const k of ['own_about', 'own_differentiator', 'own_cost_of_no', 'own_happy_customer', 'own_unspoken_need', 'own_proof']) {
      expect(system).toContain(k);
    }
    // bridge is DERIVED from business × customers, not mapped directly
    expect(system).toContain('business × customers');
  });

  it('instructs the model to treat "__unsure__" cautiously at low confidence', () => {
    const { system } = composeAnalysisPrompt({}, []);
    expect(system).toContain('__unsure__');
    expect(system).toMatch(/0\.4/); // lower-confidence ceiling for unsure answers
  });

  it('serializes a Group-A brief (including an unsure answer) into the user prompt', () => {
    const { user } = composeAnalysisPrompt({ own_about: 'תכשיטי כסף בעבודת יד', own_differentiator: '__unsure__' }, []);
    expect(user).toContain('own_about');
    expect(user).toContain('__unsure__');
  });

  it('injects existing active atoms so the model can reconcile, not just restate', () => {
    const { user } = composeAnalysisPrompt({}, [
      { layer: 'business', kind: 'real_usp', content: 'מהירות', confidence: 0.6 } as any,
    ]);
    expect(user).toContain('כבר מאמינים');
    expect(user).toContain('[business/real_usp]');
    expect(user).toContain('מהירות');
  });
});

describe('analyzeToInsights', () => {
  it('composes -> runs (injected) -> parses into candidates with max_tokens 3000', async () => {
    const run = vi.fn(async (_s: string, _u: string, _m: number) => RAW);
    const cands = await analyzeToInsights({ briefValues: { biz_name: 'X' }, run });
    expect(cands).toHaveLength(5);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][2]).toBe(3000);
  });
});
