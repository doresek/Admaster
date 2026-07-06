// lib/articles/geo-rules.ts — P3-3: the deterministic GEO gate.
//
// Encodes docs/ORGANIC-DEEP-RESEARCH.md §3.1 as a PURE, structural check (the
// anti-thin-page gate — doctrine: "no generated page ships without ≥3
// business-specific facts"). The generator tags every injected concrete fact
// as [FACT]…[/FACT] during generation; this gate counts UNIQUE facts, verifies
// the §3.1 shape rules, and strips the tags for the persisted body.
//
// Pure by construction: the current year is passed IN (no Date.now()), no I/O.
// Gate failure ⇒ the article is NEVER published-eligible — the caller keeps it
// in 'outline' status and records `seo.gate_failures[]`.

import type { TopicIntent } from './types';

// ── §3.1 tunable constants ("encode as tunable constants, not gospel" — §6) ──

/** §3.1(1): the answer-first opening must be a self-contained 40–150-word answer. */
export const OPENING_MIN_WORDS = 40;
export const OPENING_MAX_WORDS = 150;

/** Information-gain doctrine: ≥3 unique business-specific facts per page. */
export const MIN_INFO_GAIN_FACTS = 3;

/** §3.1: question-form H2s — ends with '?' or starts with a Hebrew question word. */
export const HEBREW_QUESTION_WORDS = ['איך', 'מה', 'כמה', 'למה', 'האם', 'מתי', 'איפה'] as const;

const FACT_RE = /\[FACT\]([\s\S]*?)\[\/FACT\]/g;

// ── Types ─────────────────────────────────────────────────────────────────────

export type GateRule =
  | 'opening_word_count'   // §3.1(1) 40–150-word answer-first opening
  | 'question_h2'          // §3.1(1) query-matched (question-form) H2s
  | 'information_gain'     // doctrine: ≥3 unique [FACT]-tagged facts
  | 'current_year_title';  // §3.1(3) commercial titles carry the current year

export interface GateFailure {
  rule:       GateRule;
  message_he: string;
}

export interface GateInput {
  /** Final assembled markdown, WITH the [FACT] tags still in place. */
  bodyMd:      string;
  /** The page title checked for the current-year rule (H1 in the body wins when present). */
  title:       string;
  /** Topic intent — the year rule applies to commercial intent only. */
  intent:      TopicIntent;
  /** Injected — pure code never calls Date.now(). */
  currentYear: number;
  /** Tunable fact floor (defaults to MIN_INFO_GAIN_FACTS). */
  minFacts?:   number;
}

export interface GateResult {
  ok:        boolean;
  failures:  GateFailure[];
  /** Unique [FACT]-tagged facts found. */
  factCount: number;
  /** bodyMd with the [FACT] tags stripped (content kept) — the persistable body. */
  bodyMd:    string;
}

// ── Pure helpers (exported for tests + generator prompts) ─────────────────────

/** Whitespace word count (Hebrew-safe: tokens, not characters). */
export function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** §3.1 question-form H2: ends with '?' or first word is a question word. */
export function isQuestionH2(h2: string): boolean {
  const t = h2.trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  const first = t.split(/\s+/)[0] ?? '';
  return (HEBREW_QUESTION_WORDS as readonly string[]).includes(first);
}

/** Unique non-empty [FACT] payloads (repetition doesn't game the gate). */
export function countFacts(bodyMd: string): number {
  const seen = new Set<string>();
  for (const m of bodyMd.matchAll(FACT_RE)) {
    const v = m[1].trim();
    if (v) seen.add(v);
  }
  return seen.size;
}

/** Remove the [FACT] tags, keep their content — the reader-facing body. */
export function stripFactTags(bodyMd: string): string {
  return bodyMd.replace(FACT_RE, (_m, inner: string) => inner.trim());
}

/** All `## ` headings in the markdown (H2 level exactly). */
export function extractH2s(bodyMd: string): string[] {
  const out: string[] = [];
  for (const m of bodyMd.matchAll(/^##\s+(.+?)\s*$/gm)) out.push(m[1].trim());
  return out;
}

/** The answer-first opening: text between the H1 line and the first H2. */
export function extractOpening(bodyMd: string): string {
  const lines = bodyMd.split('\n');
  const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
  const start = h1Idx >= 0 ? h1Idx + 1 : 0;
  const opening: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    opening.push(lines[i]);
  }
  return opening.join('\n').trim();
}

// ── The gate ──────────────────────────────────────────────────────────────────

/**
 * Deterministic §3.1 gate over the assembled article. Structural, not
 * advisory: `ok:false` means the caller MUST NOT promote the row to 'draft'.
 */
export function runGeoGate(input: GateInput): GateResult {
  const failures: GateFailure[] = [];
  const minFacts = input.minFacts ?? MIN_INFO_GAIN_FACTS;

  // 1. Answer-first opening 40–150 words (§3.1(1)). Facts inside the opening
  //    count as their content, not their tags.
  const openingWords = countWords(stripFactTags(extractOpening(input.bodyMd)));
  if (openingWords < OPENING_MIN_WORDS || openingWords > OPENING_MAX_WORDS) {
    failures.push({
      rule:       'opening_word_count',
      message_he: `הפתיח חייב להיות תשובה עצמאית של ${OPENING_MIN_WORDS}–${OPENING_MAX_WORDS} מילים (בפועל: ${openingWords})`,
    });
  }

  // 2. Every H2 question-form (§3.1(1) query-matched headings, incl. FAQ H2s).
  const badH2s = extractH2s(input.bodyMd).filter((h2) => !isQuestionH2(stripFactTags(h2)));
  if (badH2s.length > 0) {
    failures.push({
      rule:       'question_h2',
      message_he: `כל כותרות ה-H2 חייבות להיות בצורת שאלה ('?' או מילת שאלה) — חורגות: ${badH2s.slice(0, 3).join(' | ')}`,
    });
  }

  // 3. ≥3 unique information-gain facts (the anti-thin-page doctrine).
  const factCount = countFacts(input.bodyMd);
  if (factCount < minFacts) {
    failures.push({
      rule:       'information_gain',
      message_he: `נדרשות לפחות ${minFacts} עובדות עסקיות ייחודיות ([FACT]) — נמצאו ${factCount}`,
    });
  }

  // 4. Commercial titles carry the current year (§3.1(3): 92% of cited
  //    listicles carry it). The body H1 wins when present; else input.title.
  if (input.intent === 'commercial') {
    const h1 = input.bodyMd.match(/^#\s+(.+?)\s*$/m)?.[1] ?? '';
    const title = h1 || input.title;
    if (!title.includes(String(input.currentYear))) {
      failures.push({
        rule:       'current_year_title',
        message_he: `נושא מסחרי — הכותרת חייבת לכלול את השנה הנוכחית (${input.currentYear})`,
      });
    }
  }

  return {
    ok:        failures.length === 0,
    failures,
    factCount,
    bodyMd:    stripFactTags(input.bodyMd),
  };
}
