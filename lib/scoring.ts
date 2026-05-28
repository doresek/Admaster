// ════════════════════════════════════════════
// Performance Score — prompt composition & parsing
// ════════════════════════════════════════════

import type { BrandDNA } from '@/types';

export type ScoreChannel =
  | 'meta_feed' | 'meta_story' | 'meta_reel'
  | 'google_search' | 'google_display'
  | 'email' | 'sms' | 'landing' | 'tiktok';

export type ScoreBand = 'low' | 'mid' | 'high';

export interface ScoreInput {
  copy:     string;
  channel:  ScoreChannel;
  locale?:  'he' | 'en' | 'ar';
  brand?:   BrandDNA;
  audience_segment?: {
    age_range?: string;
    gender?:    'm' | 'f' | 'all';
    interests?: string[];
    custom_label?: string;
  };
}

export interface ScoreResult {
  score:         number;
  band:          ScoreBand;
  demographics:  { age: Record<string, number>; gender: { m: number; f: number } };
  emotions:      string[];
  extracts:      { offerings: string[]; features: string[]; pains: string[]; benefits: string[]; ctas: string[] };
  policy_flags:  Array<{ type: string; severity: 'info'|'warn'|'block'; issue: string }>;
  predicted_hook: 'question'|'callout'|'contrarian'|'stat'|'story'|'curiosity'|'urgency'|'social_proof'|'other';
}

const LANG_ANCHOR: Record<NonNullable<ScoreInput['locale']>, string> = {
  he: 'The copy is in Hebrew (עברית). Score using Hebrew-specific norms.',
  en: 'The copy is in English. Score using English-specific norms.',
  ar: 'The copy is in Arabic (العربية). Score using Arabic-specific norms.',
};

function brandBlock(brand?: BrandDNA): string {
  if (!brand) return '';
  const bits: string[] = [];
  if (brand.name)     bits.push(`Brand: ${brand.name}`);
  if (brand.audience) bits.push(`Audience: ${brand.audience}`);
  if (brand.tone)     bits.push(`Tone: ${brand.tone}`);
  if (brand.usp)      bits.push(`USP: ${brand.usp}`);
  if (brand.pains)    bits.push(`Audience pains: ${brand.pains}`);
  return bits.length ? `\n\n═══ BRAND CONTEXT ═══\n${bits.join('\n')}` : '';
}

export function composeScorePrompt(input: ScoreInput): { system: string; user: string } {
  const locale = input.locale ?? 'he';
  const langLine = LANG_ANCHOR[locale];

  const system = `You are a Hebrew-native performance copywriter who has graded 250,000 Israeli ads. Score each piece of ad copy on a 0-100 scale based on predicted CTR + conversion potential for the given channel and (if provided) audience.

${langLine}
${brandBlock(input.brand)}

═══ OUTPUT CONTRACT — return ONE valid JSON object, nothing else, no markdown, no commentary ═══
{
  "score": <int 0-100>,
  "band": "low" | "mid" | "high",
  "demographics": {
    "age":    { "18-24": <0..1>, "25-34": <0..1>, "35-44": <0..1>, "45-54": <0..1>, "55+": <0..1> },
    "gender": { "m": <0..1>, "f": <0..1> }
  },
  "emotions":       ["urgency","social_proof", ...],
  "extracts": {
    "offerings": [<string>, ...], "features": [<string>, ...],
    "pains":     [<string>, ...], "benefits": [<string>, ...],
    "ctas":      [<string>, ...]
  },
  "policy_flags": [
    { "type": "meta_ad_policy" | "google_ads_policy" | "brand_voice", "severity": "info"|"warn"|"block", "issue": "<one-sentence rationale>" }
  ],
  "predicted_hook": "question"|"callout"|"contrarian"|"stat"|"story"|"curiosity"|"urgency"|"social_proof"|"other"
}

All histogram fractions must sum to ~1.0 (±0.05). emotions/extracts arrays may be empty but must be present. policy_flags is empty when no issues are detected.`;

  const audienceLine = input.audience_segment
    ? `\nTarget audience: ${JSON.stringify(input.audience_segment)}`
    : '';

  const user = `Channel: ${input.channel}${audienceLine}\n\nCopy:\n${input.copy}`;

  return { system, user };
}

// ════════════════════════════════════════════
// Response parser
// ════════════════════════════════════════════

export type ParseOk  = { ok: true;  value: ScoreResult };
export type ParseErr = { ok: false; error: string };

function deriveBand(score: number): ScoreBand {
  if (score < 40) return 'low';
  if (score < 70) return 'mid';
  return 'high';
}

function stripFence(raw: string): string {
  return raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function parseScoreResponse(raw: string): ParseOk | ParseErr {
  let obj: any;
  try {
    obj = JSON.parse(stripFence(raw));
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (typeof obj !== 'object' || obj === null) return { ok: false, error: 'not_object' };

  const score = Number(obj.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return { ok: false, error: 'score_out_of_range' };
  }

  const value: ScoreResult = {
    score,
    band: deriveBand(score),
    demographics: {
      age:    obj.demographics?.age    ?? { '18-24':0,'25-34':0,'35-44':0,'45-54':0,'55+':0 },
      gender: obj.demographics?.gender ?? { m: 0.5, f: 0.5 },
    },
    emotions:      Array.isArray(obj.emotions) ? obj.emotions.slice(0, 5).map(String) : [],
    extracts: {
      offerings: Array.isArray(obj.extracts?.offerings) ? obj.extracts.offerings.map(String) : [],
      features:  Array.isArray(obj.extracts?.features)  ? obj.extracts.features.map(String)  : [],
      pains:     Array.isArray(obj.extracts?.pains)     ? obj.extracts.pains.map(String)     : [],
      benefits:  Array.isArray(obj.extracts?.benefits)  ? obj.extracts.benefits.map(String)  : [],
      ctas:      Array.isArray(obj.extracts?.ctas)      ? obj.extracts.ctas.map(String)      : [],
    },
    policy_flags: Array.isArray(obj.policy_flags)
      ? obj.policy_flags.filter((f: any) => f && typeof f === 'object' && typeof f.issue === 'string')
                        .map((f: any) => ({
                          type:     String(f.type ?? 'meta_ad_policy'),
                          severity: (['info','warn','block'].includes(f.severity) ? f.severity : 'info') as 'info'|'warn'|'block',
                          issue:    String(f.issue),
                        }))
      : [],
    predicted_hook: ['question','callout','contrarian','stat','story','curiosity','urgency','social_proof','other'].includes(obj.predicted_hook)
      ? obj.predicted_hook
      : 'other',
  };

  return { ok: true, value };
}
