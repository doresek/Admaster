// lib/articles/video-script.ts — P3-4: the video-script generator.
//
// Topic → 30–60s script {hook (≤10 words, scroll-stop), beats: [{t, line}]
// (3–5 beats), cta} via ONE StageRunner call with a tagged parse (retry once
// on malformed, then fail cleanly), plus a DETERMINISTIC quality check: hook
// word count, beat count, and estimated duration (total words / 2.5 wps must
// land within 25–70s). Persisted as an `articles` row kind 'video_script'
// (body_md = formatted script) or an update to an existing row.
//
// No route this wave — lib + tests only (per the wave plan).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StageRunner } from '@/lib/master-studio/pipeline';
import type { ClientInsight } from '@/lib/intelligence/types';
import type { VocQuoteRow } from '@/lib/capability-contracts';
import { formatQuotesForPrompt } from '@/lib/voc';
import type { VideoScript, VideoScriptBeat } from './types';
import { countWords } from './geo-rules';
import { xt, xtAll } from './tags';
import { topicSlug } from './store';
import { buildFactsBlock, SIMPLE_HEBREW_RULE } from './generate';

// ── Deterministic quality constants (tunable, not gospel) ─────────────────────

/** Spoken-Hebrew pace used for the duration estimate. */
export const WORDS_PER_SECOND = 2.5;
/** Target script window: a "30–60s" script, with tolerance at both ends. */
export const VIDEO_MIN_SECONDS = 25;
export const VIDEO_MAX_SECONDS = 70;
export const HOOK_MAX_WORDS    = 10;
export const MIN_BEATS         = 3;
export const MAX_BEATS         = 5;

export const SCRIPT_MAX_TOKENS = 1200;

// ── Quality check (pure) ──────────────────────────────────────────────────────

export type VideoCheckRule = 'hook_word_count' | 'beat_count' | 'duration';

export interface VideoScriptCheck {
  ok:               boolean;
  failures:         { rule: VideoCheckRule; message_he: string }[];
  estimatedSeconds: number;
}

/** Estimated spoken duration: all script words at WORDS_PER_SECOND. */
export function estimateSeconds(script: VideoScript): number {
  const words =
    countWords(script.hook) +
    script.beats.reduce((n, b) => n + countWords(b.line), 0) +
    countWords(script.cta);
  return words / WORDS_PER_SECOND;
}

export function checkVideoScript(script: VideoScript): VideoScriptCheck {
  const failures: VideoScriptCheck['failures'] = [];

  const hookWords = countWords(script.hook);
  if (hookWords === 0 || hookWords > HOOK_MAX_WORDS) {
    failures.push({
      rule:       'hook_word_count',
      message_he: `ההוק חייב להיות 1–${HOOK_MAX_WORDS} מילים עוצרות-גלילה (בפועל: ${hookWords})`,
    });
  }

  if (script.beats.length < MIN_BEATS || script.beats.length > MAX_BEATS) {
    failures.push({
      rule:       'beat_count',
      message_he: `נדרשים ${MIN_BEATS}–${MAX_BEATS} ביטים (בפועל: ${script.beats.length})`,
    });
  }

  const estimatedSeconds = estimateSeconds(script);
  if (estimatedSeconds < VIDEO_MIN_SECONDS || estimatedSeconds > VIDEO_MAX_SECONDS) {
    failures.push({
      rule:       'duration',
      message_he: `אורך משוער ${Math.round(estimatedSeconds)} שניות — חייב להיות ${VIDEO_MIN_SECONDS}–${VIDEO_MAX_SECONDS} (לפי ${WORDS_PER_SECOND} מילים/שנייה)`,
    });
  }

  return { ok: failures.length === 0, failures, estimatedSeconds };
}

// ── Generation (one tagged runner call, retry once) ──────────────────────────

export interface GenerateVideoScriptInput {
  /** The topic/article title the script is derived from. */
  title:      string;
  keywords?:  string[];
  rationale?: string | null;
  atoms?:     ClientInsight[];
  quotes?:    VocQuoteRow[];
  run:        StageRunner;
}

export type GenerateVideoScriptResult =
  | { ok: true; script: VideoScript; check: VideoScriptCheck }
  | { ok: false; error: string };

export function parseVideoScript(raw: string): VideoScript | null {
  const hook = xt(raw, 'HOOK');
  const cta  = xt(raw, 'CTA');
  const beats: VideoScriptBeat[] = [];
  for (const block of xtAll(raw, 'BEAT')) {
    const t    = block.match(/^\s*t\s*:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const line = block.match(/^\s*line\s*:\s*(.+)$/m)?.[1]?.trim() ?? '';
    if (line) beats.push({ t, line });
  }
  if (!hook || !cta || beats.length === 0) return null;
  return { hook, beats, cta };
}

function scriptPrompts(input: GenerateVideoScriptInput): { system: string; user: string } {
  // The word budget the duration check implies, surfaced to the model.
  const minWords = Math.ceil(VIDEO_MIN_SECONDS * WORDS_PER_SECOND);
  const maxWords = Math.floor(VIDEO_MAX_SECONDS * WORDS_PER_SECOND);

  const system = `אתה תסריטאי וידאו קצר (Reels/TikTok) לעסקים ישראליים. כתוב תסריט 30–60 שניות בעברית.

═══ כללים ═══
- HOOK: עד ${HOOK_MAX_WORDS} מילים, עוצר-גלילה — pattern-interrupt שנוגע בכאב/רצון אמיתי של הלקוח.
- ${MIN_BEATS}–${MAX_BEATS} ביטים; לכל ביט טווח זמן (למשל "0-5s") ושורה מדוברת אחת.
- CTA: קריאה לפעולה אחת, ברורה.
- סך המילים בתסריט (הוק+ביטים+CTA): ${minWords}–${maxWords} מילים (קצב דיבור ~${WORDS_PER_SECOND} מילים/שנייה).
- ${SIMPLE_HEBREW_RULE}
- אסור להמציא עובדות — השתמש רק בחומר שסופק.

═══ OUTPUT CONTRACT (החזר אך ורק את התגיות) ═══
[HOOK]ההוק[/HOOK]
[BEAT]t: 0-5s
line: השורה המדוברת[/BEAT]
(חזור על [BEAT] לכל ביט)
[CTA]הקריאה לפעולה[/CTA]`;

  const user = `נושא: ${input.title}
שאילתות יעד: ${(input.keywords ?? []).join(' · ') || '—'}
רציונל: ${input.rationale ?? '—'}

═══ עובדות העסק ═══
${input.atoms?.length ? buildFactsBlock(input.atoms) : '— אין —'}

═══ ציטוטי לקוחות ═══
${input.quotes?.length ? formatQuotesForPrompt(input.quotes) : '— אין —'}`;

  return { system, user };
}

const RETRY_NUDGE =
  '\n\nהתשובה הקודמת לא עמדה בחוזה הפלט. החזר אך ורק את התגיות המבוקשות, במבנה המדויק שהוגדר.';

/** One runner call (retry once on malformed) → script + deterministic check. Never throws on parse. */
export async function generateVideoScript(input: GenerateVideoScriptInput): Promise<GenerateVideoScriptResult> {
  const { system, user } = scriptPrompts(input);
  try {
    let script = parseVideoScript(await input.run(system, user, SCRIPT_MAX_TOKENS));
    if (!script) script = parseVideoScript(await input.run(system, user + RETRY_NUDGE, SCRIPT_MAX_TOKENS));
    if (!script) return { ok: false, error: 'תסריט לא תקין גם אחרי ניסיון חוזר' };
    return { ok: true, script, check: checkVideoScript(script) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Formatting + persistence ──────────────────────────────────────────────────

/** body_md for the articles row: readable, hand-off-able script. */
export function formatVideoScriptMd(title: string, script: VideoScript): string {
  const beats = script.beats.map((b) => `| ${b.t || '—'} | ${b.line} |`).join('\n');
  return `# ${title} — תסריט וידאו

**הוק (עצירת-גלילה):** ${script.hook}

| זמן | שורה |
|---|---|
${beats}

**CTA:** ${script.cta}
`.trim();
}

export interface SaveVideoScriptInput {
  admin:       SupabaseClient;
  clientId:    string;
  ownerUserId: string;
  title:       string;
  script:      VideoScript;
  check:       VideoScriptCheck;
  /** When present, update this row instead of inserting a new one. */
  articleId?:  string;
}

export type SaveVideoScriptResult =
  | { ok: true; article_id: string | null; status: 'draft' | 'outline' }
  | { ok: false; error: string };

/**
 * Persist as an articles row kind 'video_script' (or update an existing row).
 * Quality-check pass → 'draft'; fail → 'outline' with seo.script_check_failures
 * recorded (same never-publish-a-failing-artifact discipline as the geo gate).
 */
export async function saveVideoScript(input: SaveVideoScriptInput): Promise<SaveVideoScriptResult> {
  const { admin, script, check } = input;
  const status: 'draft' | 'outline' = check.ok ? 'draft' : 'outline';
  const body_md = formatVideoScriptMd(input.title, script);
  const seo = {
    title:             `${input.title} — תסריט וידאו`,
    description:       script.hook,
    script_check:      { passed: check.ok, estimated_seconds: Math.round(check.estimatedSeconds) },
    ...(check.ok ? {} : { script_check_failures: check.failures }),
  };
  // The structured script rides in `outline` (jsonb) so UIs can render beats
  // without re-parsing the markdown.
  const outline = { h1: `${input.title} — תסריט וידאו`, video: script };

  try {
    if (input.articleId) {
      const { error } = await admin.from('articles')
        .update({ body_md, seo, outline, status, updated_at: new Date().toISOString() })
        .eq('id', input.articleId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, article_id: input.articleId, status };
    }

    const { data, error } = await admin.from('articles')
      .insert({
        client_id:     input.clientId,
        owner_user_id: input.ownerUserId,
        slug:          topicSlug(`${input.title} תסריט וידאו`),
        title:         `${input.title} — תסריט וידאו`,
        kind:          'video_script',
        outline,
        body_md,
        seo,
        status,
      })
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, article_id: (data?.id as string | undefined) ?? null, status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
