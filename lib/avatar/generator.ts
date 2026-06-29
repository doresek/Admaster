/**
 * Avatar Quality v2 — multi-pass generator with research grounding.
 *
 * Ported from the divergent feat/avatar-quality-v2 branch (code only, no merge),
 * adapted to this repo's conventions:
 *   • Model comes from the CLAUDE_MODEL env var (same as lib/client-core/avatar.ts
 *     and lib/master-studio), not a hardcoded id.
 *   • The LLM call is an injectable runner (AvatarV2Runner) mirroring
 *     lib/master-studio's StageRunner, so tests need no API key / network. The
 *     default runner is a real Anthropic call, lazily constructed so importing
 *     this module never requires the API key.
 *
 * Flow:
 *   1. RESEARCH   — fetch up to 12 web snippets (skipped if no key)
 *   2. DRAFT      — LLM generates initial avatar using frameworks + research
 *   3. CRITIQUE   — separate LLM call scores draft on 5 dimensions
 *   4. REFINE     — rewrite if any score < 7
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  buildFrameworkSection,
  DEFAULT_FRAMEWORK_SET,
  type FrameworkKey,
} from './frameworks';
import {
  researchForAvatar,
  formatResearchForPrompt,
  type AvatarResearchInput,
  type ResearchSnippet,
} from './research';

/**
 * Calls the LLM with a (system, user) prompt and returns the raw text.
 * Same shape as lib/master-studio's StageRunner — injectable for tests.
 */
export type AvatarV2Runner = (system: string, user: string, maxTokens: number) => Promise<string>;

export interface AvatarInput {
  businessName?:    string | null;
  product?:         string | null;
  industry?:        string | null;
  productCategory?: string | null;
  brandTone?:       string | null;
  region?:          string | null;
  language?:        'he' | 'en';
  userNotes?:       string | null;
  frameworks?:      FrameworkKey[];
}

export type AwarenessLevel =
  | 'unaware'
  | 'problem_aware'
  | 'solution_aware'
  | 'product_aware'
  | 'most_aware';

export interface Avatar {
  name:                        string;
  age:                         string;
  occupation:                  string;
  location:                    string;
  income_range:                string;
  family_status:               string;

  demographics_summary:        string;
  psychographics_summary:      string;

  pains:                       string[]; // 5
  desires:                     string[]; // 5
  fears:                       string[]; // 3
  status_gains:                string[]; // 3

  voice_quotes:                string[]; // 8-12
  daily_routine:               string;

  jobs_to_be_done: {
    functional: string;
    emotional:  string;
    social:     string;
    old_hire:   string;
  };

  awareness_level:             AwarenessLevel;
  awareness_strategy:          string;

  market_sophistication_level: 1 | 2 | 3 | 4 | 5;
  recommended_angle:           string;

  objections:                  string[]; // 5
  buying_triggers:             string[]; // 3
  channels:                    string[];
  recommended_creative_angles: string[]; // 3
}

export interface CritiqueScores {
  specificity:  number;
  voice:        number;
  consistency:  number;
  usefulness:   number;
  originality:  number;
}

export interface AvatarMeta {
  model:                  string;
  language:               'he' | 'en';
  frameworks:             FrameworkKey[];
  research_snippet_count: number;
  refined:                boolean;
  scores:                 CritiqueScores | null;
  critique_summary:       string;
  total_time_ms:          number;
}

export interface AvatarGenerationResult {
  avatar: Avatar;
  meta:   AvatarMeta;
}

const SYSTEM_PROMPT_HE = `אתה אסטרטג שיווק בכיר עם 15 שנות ניסיון בבניית פרסונות לקוח עבור מותגים ישראליים.
המטרה: לבנות אווטאר לקוח אמיתי, חי, ספציפי — לא תיאור גנרי.

כללים מחייבים:
- תמיד תוצא JSON תקין בלבד (ללא markdown, ללא הסברים, ללא backticks)
- שמות פרטיים אמיתיים בעברית (לא "יוסי הממוצע")
- ציטוטים בשפת דיבור אותנטית — סלנג, שברי משפט, רגש
- כאבים ספציפיים עם פרטים חושיים, לא הצהרות שיווקיות
- אל תמציא נתונים סטטיסטיים`;

const SYSTEM_PROMPT_EN = `You are a senior marketing strategist with 15+ years building real customer personas for brands.
Goal: build a living, specific avatar — not a generic description.

Rules:
- Always output valid JSON only (no markdown, no explanations, no backticks)
- Real first names, not "Average Joe"
- Quotes in authentic spoken voice — slang, sentence fragments, emotion
- Specific sensory pains, not marketing slogans
- Never invent statistics`;

const CRITIQUE_SYSTEM =
  'You are a brutally honest creative director reviewing customer avatars. Output JSON only — no markdown, no backticks, no prose.';

export async function generateAvatarV2(
  input: AvatarInput,
  run: AvatarV2Runner = defaultRun,
): Promise<AvatarGenerationResult> {
  const t0         = Date.now();
  const lang       = input.language   ?? 'he';
  const frameworks = input.frameworks ?? DEFAULT_FRAMEWORK_SET;
  const sysPrompt  = lang === 'he' ? SYSTEM_PROMPT_HE : SYSTEM_PROMPT_EN;

  // 1. Research (silent skip when no key)
  const researchInput: AvatarResearchInput = {
    businessName:    input.businessName,
    industry:        input.industry,
    productCategory: input.productCategory,
    region:          input.region,
    language:        lang,
  };
  const snippets = await researchForAvatar(researchInput);

  // 2. Draft
  const draftText = await run(sysPrompt, buildDraftPrompt(input, frameworks, snippets, lang), 3000);
  let avatar = safeParseAvatar(draftText);

  // 3. Critique
  const critiqueText = await run(CRITIQUE_SYSTEM, buildCritiquePrompt(avatar, lang), 1500);
  const critique = safeParseCritique(critiqueText);

  // 4. Refine (only if needed)
  let refined = false;
  if (critique.needs_refinement) {
    const refineText = await run(sysPrompt, buildRefinePrompt(avatar, critique, lang), 3000);
    avatar  = safeParseAvatar(refineText);
    refined = true;
  }

  const meta: AvatarMeta = {
    model:                  resolveModel(),
    language:               lang,
    frameworks,
    research_snippet_count: snippets.length,
    refined,
    scores:                 critique.scores ?? null,
    critique_summary:       critique.summary,
    total_time_ms:          Date.now() - t0,
  };

  return { avatar, meta };
}

// ── prompt builders ───────────────────────────────────────────

function buildDraftPrompt(
  input:      AvatarInput,
  frameworks: FrameworkKey[],
  snippets:   ResearchSnippet[],
  lang:       'he' | 'en',
): string {
  const intro =
    lang === 'he'
      ? 'בנה אווטאר לקוח מפורט עבור העסק הבא:'
      : 'Build a detailed customer avatar for the following business:';

  const ctx = [
    input.businessName    && `Business: ${input.businessName}`,
    input.product         && `Product: ${input.product}`,
    input.industry        && `Industry: ${input.industry}`,
    input.productCategory && `Category: ${input.productCategory}`,
    input.brandTone       && `Brand tone: ${input.brandTone}`,
    input.region          && `Region: ${input.region}`,
    input.userNotes       && `Additional notes: ${input.userNotes}`,
  ].filter(Boolean).join('\n');

  const frameworkSection = buildFrameworkSection(frameworks);
  const researchSection  = formatResearchForPrompt(snippets);

  const schemaLine =
    `\nOutput a single JSON object matching this TypeScript type:\n\`\`\`\n${AVATAR_TS_SCHEMA}\n\`\`\`\n\nReturn ONLY the JSON object. No prose, no markdown.`;

  return `${intro}\n\n${ctx}\n${frameworkSection}\n${researchSection}\n${schemaLine}`;
}

function buildCritiquePrompt(avatar: Avatar, lang: 'he' | 'en'): string {
  const langName = lang === 'he' ? 'Hebrew' : 'English';
  return `Review this customer avatar and identify problems.

Avatar:
\`\`\`json
${JSON.stringify(avatar, null, 2)}
\`\`\`

Score on these dimensions (1-10):
1. Specificity      — concrete sensory details vs. generic adjectives
2. Voice            — do the quotes sound like real spoken ${langName}?
3. Consistency      — do age, occupation, income, fears, desires all fit one real person?
4. Usefulness       — could you actually write an ad from this?
5. Originality      — does it feel generic AI-written?

Output JSON ONLY (no markdown, no backticks):
{
  "scores": { "specificity": N, "voice": N, "consistency": N, "usefulness": N, "originality": N },
  "needs_refinement": boolean,
  "summary": "1-2 sentences",
  "top_3_issues": ["issue 1", "issue 2", "issue 3"]
}

Mark needs_refinement=true if ANY score is below 7.`;
}

function buildRefinePrompt(
  avatar:   Avatar,
  critique: { top_3_issues: string[]; summary: string },
  lang:     'he' | 'en',
): string {
  const instr =
    lang === 'he'
      ? 'שכתב את האווטאר וטפל בבעיות הבאות. שמור על אותו מבנה JSON בדיוק.'
      : 'Rewrite the avatar fixing the following issues. Keep the exact same JSON structure.';

  return `${instr}

Original avatar:
\`\`\`json
${JSON.stringify(avatar, null, 2)}
\`\`\`

Issues to fix:
${critique.top_3_issues.map((i) => `- ${i}`).join('\n')}

Summary: ${critique.summary}

Return ONLY the improved JSON.`;
}

// ── default LLM runner (real Anthropic call) ──────────────────

function resolveModel(): string {
  return process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
}

let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('No LLM API key configured. Set ANTHROPIC_API_KEY.');
  }
  _anthropic ??= new Anthropic({ apiKey });
  return _anthropic;
}

const defaultRun: AvatarV2Runner = async (system, user, maxTokens) => {
  const message = await anthropicClient().messages.create({
    model:      resolveModel(),
    max_tokens: maxTokens,
    system,
    messages:   [{ role: 'user', content: user }],
  });
  const block = message.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
};

// ── safe parsers ──────────────────────────────────────────────

function safeParseAvatar(text: string): Avatar {
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as Avatar;
  } catch (err) {
    throw new Error(
      `Failed to parse avatar JSON: ${(err as Error).message}\n\nRaw (first 500 chars):\n${cleaned.slice(0, 500)}`,
    );
  }
}

interface CritiqueParsed {
  needs_refinement: boolean;
  summary:          string;
  top_3_issues:     string[];
  scores:           CritiqueScores | null;
}

function safeParseCritique(text: string): CritiqueParsed {
  const cleaned = extractJson(text);
  try {
    const raw = JSON.parse(cleaned);
    return {
      needs_refinement: !!raw.needs_refinement,
      summary:          typeof raw.summary === 'string' ? raw.summary : '',
      top_3_issues:     Array.isArray(raw.top_3_issues) ? raw.top_3_issues.slice(0, 5) : [],
      scores:           normalizeScores(raw.scores),
    };
  } catch {
    // Lenient: if we can't parse, refine as a precaution.
    return {
      needs_refinement: true,
      summary:          'Critique parsing failed, refining as precaution.',
      top_3_issues: [
        'Add more sensory specificity',
        'Use more authentic spoken voice',
        'Tighten internal consistency between age, occupation, income, and concerns',
      ],
      scores: null,
    };
  }
}

function normalizeScores(s: unknown): CritiqueScores | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    specificity: n(o.specificity),
    voice:       n(o.voice),
    consistency: n(o.consistency),
    usefulness:  n(o.usefulness),
    originality: n(o.originality),
  };
}

// Strip ```json fences and pull the first {...} block if the model added prose.
function extractJson(s: string): string {
  let t = s.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (t.startsWith('{')) return t;
  const first = t.indexOf('{');
  const last  = t.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    t = t.slice(first, last + 1);
  }
  return t;
}

const AVATAR_TS_SCHEMA = `interface Avatar {
  name: string;
  age: string;
  occupation: string;
  location: string;
  income_range: string;
  family_status: string;
  demographics_summary: string;
  psychographics_summary: string;
  pains: string[];                          // 5 items
  desires: string[];                        // 5 items
  fears: string[];                          // 3 items
  status_gains: string[];                   // 3 items
  voice_quotes: string[];                   // 8-12 items
  daily_routine: string;
  jobs_to_be_done: {
    functional: string;
    emotional: string;
    social: string;
    old_hire: string;
  };
  awareness_level: "unaware"|"problem_aware"|"solution_aware"|"product_aware"|"most_aware";
  awareness_strategy: string;
  market_sophistication_level: 1|2|3|4|5;
  recommended_angle: string;
  objections: string[];                     // 5 items
  buying_triggers: string[];                // 3 items
  channels: string[];
  recommended_creative_angles: string[];    // 3 items
}`;
