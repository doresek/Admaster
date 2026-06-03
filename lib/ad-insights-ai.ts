// AI analysis of a launched ad's performance → actionable Hebrew recommendations.
// parseAnalysis is pure (unit-tested); analyzeAdPerformance wraps the Claude call.
import Anthropic from '@anthropic-ai/sdk';
import type { AdInsights, AdAnalysis, AdRecommendation } from '@/types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const VALID_ACTIONS: AdRecommendation['action'][] = ['scale', 'pause', 'change_creative', 'adjust_targeting', 'adjust_budget', 'keep'];
const VALID_SEV = ['high', 'medium', 'low'];
const VALID_VERDICTS: AdAnalysis['verdict'][] = ['winning', 'promising', 'underperforming', 'too_early'];

const SYSTEM = `You are a senior Meta performance-marketing analyst for the Israeli market.
You receive an ad's objective, creative summary, daily budget, and its performance metrics.
Judge it and give concrete next actions. Be decisive but honest: if there's too little data
(very low impressions/spend), say "too_early" and recommend keeping it running.

Respond with STRICT JSON only, no prose, no code fences:
{"verdict":"winning|promising|underperforming|too_early",
 "summary":"<one paragraph, Hebrew>",
 "recommendations":[{"action":"scale|pause|change_creative|adjust_targeting|adjust_budget|keep","severity":"high|medium|low","title":"<short Hebrew>","why":"<Hebrew, grounded in the numbers>"}]}`;

function parseJsonLoose(text: string): any {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (t[0] !== '{' && t[0] !== '[') { const m = t.match(/[{[][\s\S]*[}\]]/); if (m) t = m[0]; }
  return JSON.parse(t);
}

/** Validate/coerce a raw model response into a safe AdAnalysis. Pure. */
export function parseAnalysis(raw: string): AdAnalysis {
  let p: any;
  try { p = parseJsonLoose(raw); } catch { p = {}; }

  const verdict: AdAnalysis['verdict'] = VALID_VERDICTS.includes(p.verdict) ? p.verdict : 'too_early';
  const recommendations: AdRecommendation[] = Array.isArray(p.recommendations)
    ? p.recommendations
        .filter((r: any) => r && VALID_ACTIONS.includes(r.action))
        .map((r: any) => ({
          action:   r.action,
          severity: VALID_SEV.includes(r.severity) ? r.severity : 'medium',
          title:    String(r.title || '').slice(0, 200),
          why:      String(r.why || '').slice(0, 600),
        }))
    : [];

  return {
    verdict,
    summary: String(p.summary || 'אין מספיק נתונים לניתוח עדיין.').slice(0, 1200),
    recommendations,
  };
}

export interface AnalyzeContext {
  objective:   string | null;
  headline:    string | null;
  primaryText: string | null;
  dailyBudget: number | null;   // account minor units
  status:      string;
}

export async function analyzeAdPerformance(insights: AdInsights, ctx: AnalyzeContext): Promise<AdAnalysis> {
  const userMsg = [
    `Objective: ${ctx.objective || 'unknown'}`,
    `Status: ${ctx.status}`,
    `Daily budget (minor units): ${ctx.dailyBudget ?? 'unknown'}`,
    `Headline: ${ctx.headline || ''}`,
    `Primary text: ${ctx.primaryText || ''}`,
    '',
    'Metrics:',
    JSON.stringify(insights, null, 2),
  ].join('\n');

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });
  const raw = msg.content.find(b => b.type === 'text')?.text ?? '';
  return parseAnalysis(raw);
}
