// ════════════════════════════════════════════
// Smart image pipeline — "best-of-N + LLM judge".
//
// For one user request we:
//   1. expandBrief            short prompt / ad copy + brand context → structured brief
//   2. generatePromptVariations brief → N diverse English image prompts
//   3. renderCandidates       render N prompts in parallel via Gemini/Vertex, upload each
//   4. judgeCandidates        Claude vision scores all N, picks the winner
//
// The route layer (app/api/images/route.ts) handles auth, credits, idempotency
// and persistence; this module is pure orchestration so each step is testable.
// ════════════════════════════════════════════
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callVertexImageGen, GEMINI_ASPECT } from '@/lib/vertex-ai';
import { uploadToStorage } from '@/lib/image-storage';
import { buildAiContext } from '@/lib/ai-context';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
// Judge needs a vision-capable model; defaults to the same model (sonnet-4-6 has vision).
const JUDGE_MODEL = process.env.IMAGE_JUDGE_MODEL || CLAUDE_MODEL;
export const DEFAULT_N = Number(process.env.IMAGE_PIPELINE_N) || 3;

// ─── Types ───────────────────────────────────────────────

export interface CreativeBrief {
  subject:      string;        // the core visual subject
  keyMessage:   string;        // the marketing message the image must convey
  audience:     string;        // who it targets
  mood:         string;        // emotional tone / vibe
  mustHaves:    string[];      // required elements (product, brand color, etc.)
  mustAvoids:   string[];      // things to avoid (garbled text, clichés…)
  brandColors?: string[];      // hints from Brand DNA if present
  textOnImage?: string | null; // verbatim text that MUST appear, else null
  aspectRatio:  string;        // ASPECT_* token, passed through
}

export interface PromptVariation {
  concept: string;  // 1-line label of the creative angle
  prompt:  string;  // full English image-gen prompt
}

export interface RenderedCandidate {
  index:    number;
  prompt:   string;
  concept:  string;
  base64:   string;   // kept in-memory for the judge; NOT persisted
  mimeType: string;
  url:      string;   // Supabase public URL after upload
}

export interface CandidateScore {
  index:            number;
  intentMatch:      number; // 0-10
  marketingQuality: number; // 0-10 (CTR potential)
  brandFit:         number; // 0-10
  aesthetics:       number; // 0-10
  textLegibility:   number; // 0-10 (penalize garbled Hebrew)
  total:            number; // weighted 0-10
  notes:            string;
}

export interface JudgeResult {
  winnerIndex: number;
  scores:      CandidateScore[];
  rationale:   string; // one-line Hebrew, why the winner won
}

export type PipelineSource =
  | { kind: 'prompt';  text: string }
  | { kind: 'adCopy'; text: string };

export interface PipelineInput {
  supabase:    SupabaseClient;
  userId:      string;
  source:      PipelineSource;
  aspectRatio: string;
  style:       string;
  clientId?:   string | null;
  briefId?:    string | null;
  n?:          number;
}

export interface PipelineResult {
  winner:     RenderedCandidate;
  candidates: RenderedCandidate[]; // all rendered, in render order
  judge:      JudgeResult;
  brief:      CreativeBrief;
  partial:    boolean;             // true if fewer than n rendered
}

// ─── JSON parsing helper ─────────────────────────────────

/** Strip ```json fences / stray prose and parse. Throws on hard failure. */
function parseJsonLoose<T>(text: string): T {
  let t = text.trim();
  // Remove leading ```json / ``` and trailing ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // If there's surrounding prose, grab the first {...} or [...] block.
  if (t[0] !== '{' && t[0] !== '[') {
    const m = t.match(/[{[][\s\S]*[}\]]/);
    if (m) t = m[0];
  }
  return JSON.parse(t) as T;
}

async function claudeText(opts: {
  model?: string;
  system: string;
  content: Anthropic.MessageParam['content'];
  maxTokens: number;
}): Promise<string> {
  const msg = await anthropic.messages.create({
    model:      opts.model || CLAUDE_MODEL,
    max_tokens: opts.maxTokens,
    system:     opts.system,
    messages:   [{ role: 'user', content: opts.content }],
  });
  return msg.content.find(b => b.type === 'text')?.text ?? '';
}

// ─── 1. Expand brief ─────────────────────────────────────

const BRIEF_SYSTEM = `You are a senior advertising art director. Turn the user's input
into a STRUCTURED CREATIVE BRIEF for generating a marketing image (Meta/Instagram, Israeli market).

Distill the essential visual idea — do NOT translate literally. Identify the subject, the core
marketing message, the target audience, and the emotional mood. List concrete must-have elements
and things to avoid. If — and only if — short text MUST appear in the image (e.g. a price, phone,
or a 1-3 word tagline the brief explicitly demands), put it verbatim in "textOnImage"; otherwise
set "textOnImage" to null (most performance images are stronger with no embedded text).

Respond with STRICT JSON only, no prose, no code fences, matching exactly:
{"subject":"","keyMessage":"","audience":"","mood":"","mustHaves":[],"mustAvoids":[],"brandColors":[],"textOnImage":null}`;

export async function expandBrief(
  supabase: SupabaseClient,
  args: {
    userId:      string;
    clientId?:   string | null;
    briefId?:    string | null;
    source:      PipelineSource;
    aspectRatio: string;
  },
): Promise<CreativeBrief> {
  const ctx = await buildAiContext(supabase, {
    userId:   args.userId,
    clientId: args.clientId ?? null,
    briefId:  args.briefId ?? null,
  });

  const system = ctx.combined
    ? `${ctx.combined}\n\n═══ TASK ═══\n${BRIEF_SYSTEM}`
    : BRIEF_SYSTEM;

  const userMsg = args.source.kind === 'adCopy'
    ? `Derive the brief from this AD COPY:\n\n${args.source.text}`
    : `Expand this SHORT IMAGE PROMPT into a full brief:\n\n${args.source.text}`;

  const raw = await claudeText({ system, content: userMsg, maxTokens: 700 });

  let parsed: Partial<CreativeBrief>;
  try {
    parsed = parseJsonLoose<Partial<CreativeBrief>>(raw);
  } catch {
    // Fallback: treat the raw input as the subject so the pipeline still runs.
    parsed = { subject: args.source.text.slice(0, 200) };
  }

  // Prefer brand colors detected by Claude; else any color-ish hint from Brand DNA.
  const brandColors = (parsed.brandColors && parsed.brandColors.length)
    ? parsed.brandColors
    : extractBrandColors(ctx.brand);

  return {
    subject:     parsed.subject || args.source.text.slice(0, 200),
    keyMessage:  parsed.keyMessage || '',
    audience:    parsed.audience || '',
    mood:        parsed.mood || '',
    mustHaves:   Array.isArray(parsed.mustHaves) ? parsed.mustHaves : [],
    mustAvoids:  Array.isArray(parsed.mustAvoids) ? parsed.mustAvoids : [],
    brandColors,
    textOnImage: typeof parsed.textOnImage === 'string' && parsed.textOnImage.trim()
      ? parsed.textOnImage.trim()
      : null,
    aspectRatio: args.aspectRatio,
  };
}

/** Pull any explicit color hint from Brand DNA (defensive — field may not exist). */
function extractBrandColors(brand: Record<string, string> | null): string[] | undefined {
  if (!brand) return undefined;
  const raw = brand.colors || brand.color || brand.palette || '';
  if (!raw) return undefined;
  const parts = raw.split(/[,/|]/).map(s => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

// ─── 2. Prompt variations ────────────────────────────────

const VARIATIONS_SYSTEM = `You are a senior art director writing prompts for an AI image generator
(Gemini / Imagen) for Meta/Instagram ads in the Israeli market.

Given a CREATIVE BRIEF, produce N DISTINCT prompt variations — each a genuinely different creative
direction (different composition, camera angle, subject treatment, or concept), NOT the same idea
reworded. Every prompt must:
- be in fluent ENGLISH, detailed: subject, composition, lighting, mood, colors, camera angle, style.
- be professional, scroll-stopping, ad-grade.
- honor the brief's brandColors and mood when present.
- AVOID embedding any text in the image, UNLESS the brief's "textOnImage" is set — in that case
  include that exact text wrapped in straight double quotes (e.g. the sign reads "..."), and nothing else.
- respect mustHaves and mustAvoids.

Respond with STRICT JSON only, no prose, no code fences:
{"variations":[{"concept":"short label","prompt":"full english prompt"}]}`;

export async function generatePromptVariations(
  brief: CreativeBrief,
  n = DEFAULT_N,
): Promise<PromptVariation[]> {
  const briefJson = JSON.stringify({
    subject: brief.subject, keyMessage: brief.keyMessage, audience: brief.audience,
    mood: brief.mood, mustHaves: brief.mustHaves, mustAvoids: brief.mustAvoids,
    brandColors: brief.brandColors ?? [], textOnImage: brief.textOnImage,
  }, null, 2);

  const raw = await claudeText({
    system:  VARIATIONS_SYSTEM,
    content: `Produce exactly ${n} variations for this brief:\n\n${briefJson}`,
    maxTokens: 1100,
  });

  let variations: PromptVariation[] = [];
  try {
    const parsed = parseJsonLoose<{ variations: PromptVariation[] }>(raw);
    variations = (parsed.variations || [])
      .filter(v => v && typeof v.prompt === 'string' && v.prompt.trim())
      .map(v => ({ concept: v.concept || 'Variation', prompt: v.prompt.trim() }));
  } catch {
    variations = [];
  }

  // Fallback so the pipeline never dies on a bad LLM response: synthesize a prompt from the brief.
  if (variations.length === 0) {
    const fallback = [brief.subject, brief.mood, (brief.brandColors || []).join(', '),
      'professional advertising photography, high detail, studio lighting']
      .filter(Boolean).join(', ');
    variations = [{ concept: 'Direct', prompt: fallback }];
  }

  return variations.slice(0, n);
}

// ─── 3. Render candidates ────────────────────────────────

export async function renderCandidates(
  supabase: SupabaseClient,
  userId: string,
  variations: PromptVariation[],
  aspectRatio: string,
): Promise<RenderedCandidate[]> {
  const ratio = GEMINI_ASPECT[aspectRatio] || '1:1';

  const settled = await Promise.allSettled(
    variations.map(async (v): Promise<Omit<RenderedCandidate, 'index'>> => {
      const { base64, mimeType } = await callVertexImageGen({ prompt: v.prompt, aspectRatio: ratio });
      const url = await uploadToStorage(supabase, userId, base64, mimeType);
      return { prompt: v.prompt, concept: v.concept, base64, mimeType, url };
    }),
  );

  const ok = settled
    .filter((r): r is PromiseFulfilledResult<Omit<RenderedCandidate, 'index'>> => r.status === 'fulfilled')
    .map((r, i) => ({ ...r.value, index: i }));

  if (ok.length === 0) {
    const firstErr = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new Error(firstErr?.reason?.message || 'All image renders failed');
  }
  return ok;
}

// ─── 4. Judge ────────────────────────────────────────────

const JUDGE_SYSTEM = `You are a senior advertising art director and performance-marketing reviewer
for Meta/Instagram ads in the Israeli market. You receive a CREATIVE BRIEF and N candidate images
(Candidate 0..N-1). Judge each candidate ONLY against the brief.

Score each candidate 0-10 on:
- intentMatch: depicts the brief's subject & key message.
- marketingQuality: scroll-stopping power / likely CTR for the audience.
- brandFit: respects brand colors, tone, mood, mustHaves; no mustAvoids.
- aesthetics: composition, lighting, professionalism.
- textLegibility: if text appears, is it correct & legible? HEAVILY PENALIZE garbled, misspelled, or
  nonsensical text — ESPECIALLY broken Hebrew letters. If the brief wants no text, penalize any text.

Compute total = intentMatch*0.30 + marketingQuality*0.30 + brandFit*0.20 + aesthetics*0.15 + textLegibility*0.05
(stays on a 0-10 scale). Pick the single best as winnerIndex.

Respond with STRICT JSON only, no prose, no code fences:
{"winnerIndex":0,"scores":[{"index":0,"intentMatch":0,"marketingQuality":0,"brandFit":0,"aesthetics":0,"textLegibility":0,"total":0,"notes":""}],"rationale":"משפט אחד בעברית למה הזוכה ניצח"}`;

export async function judgeCandidates(
  brief: CreativeBrief,
  candidates: RenderedCandidate[],
): Promise<JudgeResult> {
  // Nothing to judge — single survivor wins by default.
  if (candidates.length === 1) {
    return {
      winnerIndex: candidates[0].index,
      scores: [{ index: candidates[0].index, intentMatch: 0, marketingQuality: 0, brandFit: 0,
        aesthetics: 0, textLegibility: 0, total: 0, notes: 'only candidate' }],
      rationale: 'נוצרה גרסה אחת בלבד',
    };
  }

  const content: Anthropic.MessageParam['content'] = [
    { type: 'text', text: `CREATIVE BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nCandidates follow.` },
  ];
  for (const c of candidates) {
    content.push({ type: 'text', text: `Candidate ${c.index} (concept: ${c.concept}):` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: c.mimeType as any, data: c.base64 },
    });
  }

  const raw = await claudeText({ model: JUDGE_MODEL, system: JUDGE_SYSTEM, content, maxTokens: 900 });

  const validIndexes = new Set(candidates.map(c => c.index));
  try {
    const parsed = parseJsonLoose<JudgeResult>(raw);
    if (!validIndexes.has(parsed.winnerIndex)) {
      parsed.winnerIndex = candidates[0].index;
    }
    if (!Array.isArray(parsed.scores)) parsed.scores = [];
    if (!parsed.rationale) parsed.rationale = 'נבחרה הגרסה החזקה ביותר';
    return parsed;
  } catch {
    // Judge JSON malformed — we still have valid images; default to the first.
    return {
      winnerIndex: candidates[0].index,
      scores: candidates.map(c => ({ index: c.index, intentMatch: 0, marketingQuality: 0,
        brandFit: 0, aesthetics: 0, textLegibility: 0, total: 0, notes: 'judge parse failed' })),
      rationale: 'נבחרה גרסה ברירת מחדל (השיפוט לא הוחזר תקין)',
    };
  }
}

// ─── Orchestrator ────────────────────────────────────────

export async function runImagePipeline(input: PipelineInput): Promise<PipelineResult> {
  const n = input.n ?? DEFAULT_N;

  const brief = await expandBrief(input.supabase, {
    userId:      input.userId,
    clientId:    input.clientId,
    briefId:     input.briefId,
    source:      input.source,
    aspectRatio: input.aspectRatio,
  });

  const variations = await generatePromptVariations(brief, n);
  const candidates = await renderCandidates(input.supabase, input.userId, variations, input.aspectRatio);
  const judge = await judgeCandidates(brief, candidates);

  const winner = candidates.find(c => c.index === judge.winnerIndex) || candidates[0];

  return {
    winner,
    candidates,
    judge,
    brief,
    partial: candidates.length < n,
  };
}
