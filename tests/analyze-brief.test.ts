// Unit tests for lib/analyze-brief.ts — the shared brief-analysis logic
// extracted from app/api/tools/route.ts (W2.2a).
//
// `analyzeBrief` is driven with an INJECTED `run` returning a known raw string,
// so no network/API key is needed; we assert the parsed BriefAnalysis shape and
// fields. `persistBusinessAnalysis` is checked for its no-op + update behavior
// against a tiny fake Supabase.
import { describe, it, expect, vi } from 'vitest';
import {
  analyzeBrief,
  composeBriefPrompt,
  parseBriefAnalysis,
  persistBusinessAnalysis,
  type BriefAnalysis,
} from '@/lib/analyze-brief';

const RAW = [
  '[SCORE]82[/SCORE]',
  '[STRENGTHS]', '- חוזקה א', '- חוזקה ב', '[/STRENGTHS]',
  '[GAPS]', '- פער א — חסר משהו', '- פער ב', '[/GAPS]',
  '[QUESTIONS]', '- שאלה א', '- שאלה ב', '- שאלה ג', '[/QUESTIONS]',
  '[REFINEMENTS]', '- שינוי א', '[/REFINEMENTS]',
].join('\n');

describe('analyzeBrief — compose + run + parse', () => {
  it('parses the injected raw response into the BriefAnalysis shape', async () => {
    const result = await analyzeBrief({
      briefValues: { biz_name: 'Bloom', goal: 'leads' },
      run: async () => RAW,
    });

    expect(result).toEqual<BriefAnalysis>({
      completeness_score: 82,
      strengths:   ['חוזקה א', 'חוזקה ב'],
      gaps:        ['פער א — חסר משהו', 'פער ב'],
      questions:   ['שאלה א', 'שאלה ב', 'שאלה ג'],
      refinements: ['שינוי א'],
      raw_text:    RAW,
    });
  });

  it('passes the composed (system, user) prompt + max_tokens 1500 to run', async () => {
    const run = vi.fn(async (_system: string, _user: string, _maxTokens: number) => RAW);
    await analyzeBrief({
      briefValues: { biz_name: 'Bloom' },
      locale: 'he',
      contextPrefix: 'CTX\n\n',
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    const [system, user, maxTokens] = run.mock.calls[0];
    expect(system.startsWith('CTX\n\n')).toBe(true);
    expect(system).toContain('בעברית');           // locale=he language instruction
    expect(user).toContain('"biz_name": "Bloom"'); // brief values serialized
    expect(maxTokens).toBe(1500);
  });

  it('locale switches the output-language instruction', () => {
    expect(composeBriefPrompt({}, 'en').system).toContain('in English');
    expect(composeBriefPrompt({}, 'ar').system).toContain('بالعربية');
  });

  it('missing tags parse to safe defaults (score 0, empty lists)', () => {
    expect(parseBriefAnalysis('no tags here')).toEqual<BriefAnalysis>({
      completeness_score: 0,
      strengths: [], gaps: [], questions: [], refinements: [],
      raw_text: 'no tags here',
    });
  });
});

describe('persistBusinessAnalysis', () => {
  const analysis = parseBriefAnalysis(RAW);

  function fakeSupabase() {
    const calls: any = { table: undefined, update: undefined, eqs: [] as any[] };
    // .eq is both chainable and awaitable: returns a thenable that also has .eq.
    const eq = (col: string, val: any) => {
      calls.eqs.push([col, val]);
      const p: any = Promise.resolve({ error: null });
      p.eq = eq;
      return p;
    };
    const builder: any = {
      update(payload: any) { calls.update = payload; return builder; },
      eq,
    };
    return {
      sb: { from(table: string) { calls.table = table; return builder; } } as any,
      calls,
    };
  }

  it('no-ops when clientId is falsy (null/undefined/empty)', async () => {
    const { sb, calls } = fakeSupabase();
    await persistBusinessAnalysis(sb, { userId: 'u1', clientId: null, analysis });
    await persistBusinessAnalysis(sb, { userId: 'u1', clientId: undefined, analysis });
    await persistBusinessAnalysis(sb, { userId: 'u1', clientId: '', analysis });
    expect(calls.table).toBeUndefined();
    expect(calls.update).toBeUndefined();
  });

  it('updates meta_clients.business_analysis scoped by id + user_id', async () => {
    const { sb, calls } = fakeSupabase();
    await persistBusinessAnalysis(sb, { userId: 'u1', clientId: 'client-9', analysis });
    expect(calls.table).toBe('meta_clients');
    expect(calls.update).toEqual({ business_analysis: analysis });
    expect(calls.eqs).toEqual([['id', 'client-9'], ['user_id', 'u1']]);
  });

  it('swallows errors so the analysis flow is never broken', async () => {
    const sb: any = { from() { throw new Error('boom'); } };
    await expect(
      persistBusinessAnalysis(sb, { userId: 'u1', clientId: 'c1', analysis }),
    ).resolves.toBeUndefined();
  });
});
