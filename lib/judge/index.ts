// lib/judge/index.ts
// Phase-1 system-wide judge: a single Haiku call that scores an artifact on
// the operational / managerial / practical / design dimensions and returns a
// verdict. Phase 2 will replace ONLY the internals of evaluate() (e.g. a
// multi-agent fan-out via the Workflow tool) — the signature, JudgeVerdict
// shape, and journey_events payload stay identical.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAiContext } from '@/lib/ai-context';
import { safeJsonParse, isRecord } from '@/lib/validation';
import { composeJudgePrompt } from './prompt';
import {
  JUDGE_DIMENSIONS,
  type JudgeDimension,
  type JudgeInput,
  type JudgeVerdict,
} from './types';

export * from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const JUDGE_MODEL = process.env.CLAUDE_JUDGE_MODEL || process.env.CLAUDE_SCORE_MODEL || 'claude-haiku-4-5-20251001';

// Practical weighs most ("don't waste money"), then operational shipping
// readiness, then managerial fit, then design polish.
const WEIGHTS: Record<JudgeDimension, number> = {
  practical: 0.4,
  operational: 0.3,
  managerial: 0.2,
  design: 0.1,
};

const clamp = (n: unknown): number =>
  Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function stripToJson(raw: string): string {
  let s = raw.trim();
  // strip ```json ... ``` fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  return first >= 0 && last > first ? s.slice(first, last + 1) : s;
}

function weightedOverall(scores: Record<JudgeDimension, number>, dims: JudgeDimension[]): number {
  let sum = 0;
  let w = 0;
  for (const d of dims) {
    sum += scores[d] * WEIGHTS[d];
    w += WEIGHTS[d];
  }
  return w > 0 ? Math.round(sum / w) : 0;
}

/**
 * Evaluate an artifact across the requested dimensions. Never throws — on any
 * provider/parse failure it returns a safe "revise" verdict so the autopilot
 * gate degrades to "ask a human" rather than silently approving.
 */
export async function evaluate(
  supabase: SupabaseClient,
  input: JudgeInput,
): Promise<JudgeVerdict> {
  const dims = input.dimensions?.length ? input.dimensions : JUDGE_DIMENSIONS;
  const locale = input.locale ?? 'he';

  let contextBlock = '';
  try {
    const ctx = await buildAiContext(supabase, {
      userId: input.userId,
      clientId: input.clientId ?? null,
      briefId: input.briefId ?? null,
    });
    contextBlock = ctx.combined || '';
  } catch {
    // context is best-effort
  }

  const { system, user } = composeJudgePrompt({
    artifact: input.artifact,
    dimensions: dims,
    contextBlock,
    locale,
    practicalScore: input.practicalScore,
  });

  const fallback = (rationale: string): JudgeVerdict => {
    const scores = Object.fromEntries(dims.map((d) => [d, 50])) as Record<JudgeDimension, number>;
    return { scores, overall: 50, verdict: 'revise', rationale, flags: ['judge_unavailable'] };
  };

  let text = '';
  try {
    const message = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      system,
      messages: [{ role: 'user', content: user }],
    });
    text = message.content.find((b) => b.type === 'text')?.text ?? '';
  } catch (err) {
    console.error('[judge] provider error:', err);
    return fallback('ה-judge לא היה זמין; ממתין לבדיקה אנושית.');
  }

  // Validation boundary (H1): the model's reply is `unknown` until proven a
  // JSON object. safeJsonParse returns null on invalid JSON OR a non-object, so
  // a garbled reply degrades to the safe "revise" verdict instead of throwing.
  const parsed: any = safeJsonParse<Record<string, unknown>>(stripToJson(text), isRecord);
  if (parsed === null) {
    console.error('[judge] parse error; raw:', text.slice(0, 200));
    return fallback('לא ניתן לפענח את תשובת ה-judge; ממתין לבדיקה אנושית.');
  }

  const scores = Object.fromEntries(
    dims.map((d) => [d, clamp(parsed?.scores?.[d])]),
  ) as Record<JudgeDimension, number>;

  // If a practical score was supplied, trust it over the model's guess.
  if (input.practicalScore !== undefined && dims.includes('practical')) {
    scores.practical = clamp(input.practicalScore);
  }

  const verdict: JudgeVerdict['verdict'] =
    parsed?.verdict === 'approve' || parsed?.verdict === 'reject' ? parsed.verdict : 'revise';

  return {
    scores,
    overall: weightedOverall(scores, dims),
    verdict,
    rationale: typeof parsed?.rationale === 'string' ? parsed.rationale.slice(0, 600) : '',
    flags: Array.isArray(parsed?.flags) ? parsed.flags.filter((f: unknown) => typeof f === 'string').slice(0, 8) : [],
  };
}
