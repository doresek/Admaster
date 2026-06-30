// Unit tests for lib/analyze-brief.ts — the shared MARKETING STRATEGY analysis
// logic used by both the manual /analyze-brief tool and the client-core
// orchestrator.
//
// `analyzeBrief` is driven with an INJECTED `run` returning a known raw string,
// so no network/API key is needed; we assert the parsed StrategyAnalysis shape
// and that all 4 sections (incl. the Schwartz awareness tag, the platform/funnel
// reasons, and the offer-stack strengths) fill correctly. `persistBusinessAnalysis`
// is checked for its no-op + update behavior against a tiny fake Supabase.
import { describe, it, expect, vi } from 'vitest';
import {
  analyzeBrief,
  composeStrategyPrompt,
  composeBriefPrompt,
  parseStrategyAnalysis,
  persistBusinessAnalysis,
  type StrategyAnalysis,
} from '@/lib/analyze-brief';

const RAW = [
  '[STRATEGIC_SUMMARY]',
  'goal: להביא לידים איכותיים לקליניקה',
  'core_offer: תוכנית ליווי 12 שבועות',
  'usp: השיטה היחידה עם מעקב אישי יומי',
  'constraints:',
  '- תקציב מדיה מוגבל',
  '- עונתיות בקיץ',
  '[/STRATEGIC_SUMMARY]',
  '[SUB_AUDIENCE]',
  'name: אמהות עסוקות בנות 30-45',
  'awareness: Problem-aware',
  'persona: עובדות במשרה מלאה, מתוסכלות מחוסר זמן',
  'explanation: הן מרגישות את הכאב אך לא מכירות פתרון',
  '[/SUB_AUDIENCE]',
  '[PLATFORM_FUNNEL]',
  'platform: Meta',
  'ad_format: Reels',
  'funnel_type: lead-gen',
  'platform_reason: הקהל פעיל באינסטגרם',
  'format_reason: וידאו קצר ממיר טוב לקהל הזה',
  'funnel_reason: מחיר גבוה מצריך חימום לפני מכירה',
  '[/PLATFORM_FUNNEL]',
  '[OFFER_STACK]',
  'components:',
  '- ליווי אישי',
  '- קבוצת תמיכה',
  'strengths:',
  '- אחריות כפולה',
  '- ערך נתפס גבוה',
  'assessment: הצעה חזקה, כדאי לחזק את האחריות',
  '[/OFFER_STACK]',
].join('\n');

describe('analyzeBrief — compose + run + parse', () => {
  it('parses the injected raw response into the full StrategyAnalysis shape', async () => {
    const result = await analyzeBrief({
      briefValues: { biz_name: 'Bloom', goal: 'leads' },
      run: async () => RAW,
    });

    expect(result).toEqual<StrategyAnalysis>({
      strategic_summary: {
        goal:        'להביא לידים איכותיים לקליניקה',
        core_offer:  'תוכנית ליווי 12 שבועות',
        usp:         'השיטה היחידה עם מעקב אישי יומי',
        constraints: ['תקציב מדיה מוגבל', 'עונתיות בקיץ'],
      },
      sub_audience: {
        name:            'אמהות עסוקות בנות 30-45',
        awareness_level: 'Problem-aware',
        persona:         'עובדות במשרה מלאה, מתוסכלות מחוסר זמן',
        explanation:     'הן מרגישות את הכאב אך לא מכירות פתרון',
      },
      platform_funnel: {
        platform:        'Meta',
        ad_format:       'Reels',
        funnel_type:     'lead-gen',
        platform_reason: 'הקהל פעיל באינסטגרם',
        format_reason:   'וידאו קצר ממיר טוב לקהל הזה',
        funnel_reason:   'מחיר גבוה מצריך חימום לפני מכירה',
      },
      offer_stack: {
        components: ['ליווי אישי', 'קבוצת תמיכה'],
        strengths:  ['אחריות כפולה', 'ערך נתפס גבוה'],
        assessment: 'הצעה חזקה, כדאי לחזק את האחריות',
      },
      raw_text: RAW,
    });
  });

  it('passes the composed (system, user) prompt + max_tokens 2000 to run', async () => {
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
    expect(system).toContain('Problem-aware');     // Schwartz awareness level names present
    expect(user).toContain('"biz_name": "Bloom"'); // brief values serialized
    expect(maxTokens).toBe(2000);
  });

  it('grounds the offer section in a supplied offer stack', () => {
    const { user } = composeStrategyPrompt({ biz_name: 'X' }, 'he', '', {
      product_name: 'תוכנית פרימיום',
      guarantee: 'החזר כספי 30 יום',
    });
    expect(user).toContain('תוכנית פרימיום');
    expect(user).toContain('החזר כספי 30 יום');
  });

  it('composeBriefPrompt is a back-compat alias of composeStrategyPrompt', () => {
    expect(composeBriefPrompt).toBe(composeStrategyPrompt);
  });

  it('locale switches the output-language instruction', () => {
    expect(composeStrategyPrompt({}, 'en').system).toContain('in English');
    expect(composeStrategyPrompt({}, 'ar').system).toContain('بالعربية');
  });

  it('missing tags parse to safe empty defaults (never throws)', () => {
    expect(parseStrategyAnalysis('no tags here')).toEqual<StrategyAnalysis>({
      strategic_summary: { goal: '', core_offer: '', usp: '', constraints: [] },
      sub_audience:      { name: '', awareness_level: '', persona: '', explanation: '' },
      platform_funnel:   { platform: '', ad_format: '', funnel_type: '',
                           platform_reason: '', format_reason: '', funnel_reason: '' },
      offer_stack:       { components: [], strengths: [], assessment: '' },
      raw_text:          'no tags here',
    });
  });
});

describe('persistBusinessAnalysis', () => {
  const analysis = parseStrategyAnalysis(RAW);

  function fakeSupabase() {
    const calls: any = { table: undefined, upsert: undefined, onConflict: undefined };
    const builder: any = {
      upsert(payload: any, opts: any) {
        calls.upsert = payload;
        calls.onConflict = opts?.onConflict;
        return Promise.resolve({ error: null });
      },
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
    expect(calls.upsert).toBeUndefined();
  });

  it('upserts client_strategy.business_analysis on client_id (owner-scoped, no avatar/core clobber)', async () => {
    const { sb, calls } = fakeSupabase();
    await persistBusinessAnalysis(sb, { userId: 'u1', clientId: 'client-9', analysis });
    expect(calls.table).toBe('client_strategy');
    expect(calls.onConflict).toBe('client_id');
    expect(calls.upsert.client_id).toBe('client-9');
    expect(calls.upsert.owner_user_id).toBe('u1');
    expect(calls.upsert.business_analysis).toEqual(analysis);
    // must NOT touch avatar / core_generated_at
    expect('avatar' in calls.upsert).toBe(false);
    expect('core_generated_at' in calls.upsert).toBe(false);
  });

  it('swallows errors so the analysis flow is never broken', async () => {
    const sb: any = { from() { throw new Error('boom'); } };
    await expect(
      persistBusinessAnalysis(sb, { userId: 'u1', clientId: 'c1', analysis }),
    ).resolves.toBeUndefined();
  });
});
