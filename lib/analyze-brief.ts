// lib/analyze-brief.ts
//
// Shared brief-analysis logic, extracted from the `analyze_brief` branch of
// app/api/tools/route.ts so it can be reused and tested in isolation.
//
// `analyzeBrief` composes the prompt, runs it through Claude (injectable for
// tests via `run`, mirroring lib/master-studio's StageRunner), and parses the
// tagged response into a BriefAnalysis. `persistBusinessAnalysis` is a separate
// best-effort helper that writes the analysis onto the client's core
// (meta_clients.business_analysis) when a client is resolvable.
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BriefAnalysis {
  completeness_score: number;
  strengths:   string[];
  gaps:        string[];
  questions:   string[];
  refinements: string[];
  raw_text:    string;
}

/** Calls Claude with a (system, user) prompt and returns the raw text. */
export type BriefRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

function parseList(s: string): string[] {
  return s.split('\n')
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

/**
 * Build the exact (system, user) prompt the tools route has always used.
 * `contextPrefix` is the Brand DNA + active-client + brief context block that
 * the caller prepends; `locale` selects the output language instruction.
 */
export function composeBriefPrompt(
  briefValues: Record<string, string>,
  locale: 'he' | 'en' | 'ar' = 'he',
  contextPrefix = '',
): { system: string; user: string } {
  const lang = locale === 'he' ? 'בעברית' : locale === 'ar' ? 'بالعربية' : 'in English';
  const system = `${contextPrefix}אתה אסטרטג שיווק בכיר. תפקידך לנתח בריף לקוח ולזהות חוזקות, פערים, שאלות חשובות שלא נשאלו, וצעדים קונקרטיים לחיזוק. כתוב ${lang}.

החזר בפורמט הזה בלבד:
[SCORE]ציון שלמות מ-0 עד 100 (רק מספר)[/SCORE]
[STRENGTHS]
- חוזקה 1
- חוזקה 2
- חוזקה 3
[/STRENGTHS]
[GAPS]
- פער 1 — מה חסר ולמה זה חשוב
- פער 2
- פער 3
[/GAPS]
[QUESTIONS]
- שאלה 1 שכדאי לחזור ולשאול את הלקוח
- שאלה 2
- שאלה 3
- שאלה 4
[/QUESTIONS]
[REFINEMENTS]
- שינוי קונקרטי 1
- שינוי קונקרטי 2
- שינוי קונקרטי 3
[/REFINEMENTS]`;

  const user = `הבריף:\n${JSON.stringify(briefValues, null, 2)}`;
  return { system, user };
}

/** Parse Claude's tagged response into a BriefAnalysis (identical to the route). */
export function parseBriefAnalysis(text: string): BriefAnalysis {
  return {
    completeness_score: parseInt(xt(text, 'SCORE')) || 0,
    strengths:   parseList(xt(text, 'STRENGTHS')),
    gaps:        parseList(xt(text, 'GAPS')),
    questions:   parseList(xt(text, 'QUESTIONS')),
    refinements: parseList(xt(text, 'REFINEMENTS')),
    raw_text:    text,
  };
}

// Default runner: a real Anthropic call using the same model env var the tools
// route uses. Lazily constructed so importing this module never requires the
// API key (tests inject their own `run`).
let _anthropic: Anthropic | null = null;
const defaultRun: BriefRunner = async (system, user, maxTokens) => {
  _anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const msg = await _anthropic.messages.create({
    model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
  });
  const block = msg.content.find(b => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
};

/**
 * Analyze a brief: compose → run → parse. `run` defaults to a real Anthropic
 * call (same model + max_tokens as the tools route) and is injectable for tests.
 */
export async function analyzeBrief(opts: {
  briefValues:    Record<string, string>;
  locale?:        'he' | 'en' | 'ar';
  contextPrefix?: string;
  run?:           BriefRunner;
}): Promise<BriefAnalysis> {
  const { briefValues, locale = 'he', contextPrefix = '', run = defaultRun } = opts;
  const { system, user } = composeBriefPrompt(briefValues, locale, contextPrefix);
  const text = await run(system, user, 1500);
  return parseBriefAnalysis(text);
}

/**
 * Best-effort: persist a brief analysis onto the client core
 * (meta_clients.business_analysis). No-op when `clientId` is falsy. Errors are
 * logged and swallowed so they never fail the surrounding analysis flow.
 */
export async function persistBusinessAnalysis(
  supabase: SupabaseClient,
  { userId, clientId, analysis }: {
    userId:   string;
    clientId: string | null | undefined;
    analysis: BriefAnalysis;
  },
): Promise<void> {
  if (!clientId) return;
  try {
    const { error } = await supabase
      .from('meta_clients')
      .update({ business_analysis: analysis })
      .eq('id', clientId)
      .eq('user_id', userId);
    if (error) console.error('[persistBusinessAnalysis] update failed:', error.message);
  } catch (e: any) {
    console.error('[persistBusinessAnalysis] exception:', e?.message);
  }
}
