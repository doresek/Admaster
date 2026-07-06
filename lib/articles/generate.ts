// lib/articles/generate.ts — P3-3: the article generator (ORGANIC-TASKS P3-3,
// built to docs/ORGANIC-DEEP-RESEARCH.md §3.1 GEO content rules — BINDING).
//
// Multi-call pipeline behind the master-studio StageRunner seam (deterministic
// stub in tests, Anthropic in the route):
//   1. Outline call        → {h1, opening_answer, sections[{h2,points}], faq[{q}]}
//   2. Per-section calls   → section markdown (simple Hebrew, [FACT]-tagged injections)
//   3. FAQ-answers call    → one answer per outline question
//   4. Deterministic assembly + one edit pass (fail-open back to the assembly)
//   5. runGeoGate (geo-rules.ts) — the anti-thin-page gate. Pass → 'draft';
//      fail → row STAYS 'outline' with seo.gate_failures[] recorded.
//   6. Brand-lint (flag-only) on the final body → verdict in seo.lint.
//
// §3.1 rules encoded in the prompts + enforced by the gate:
//   answer-first 40–150-word opening · question-form H2s · statistics/quotes
//   injection from atoms/VoC ([FACT]-tagged) · simple-Hebrew constraint ·
//   current-year commercial titles · ≥3 information-gain facts · FAQ as
//   question-H2s (no FAQ schema — content value only).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StageRunner } from '@/lib/master-studio/pipeline';
import type { ClientInsight } from '@/lib/intelligence/types';
import type { VocQuoteRow } from '@/lib/capability-contracts';
import { formatQuotesForPrompt } from '@/lib/voc';
import { lintArtifact, type LintResult, type RegisterJudge } from '@/lib/brand-lint';
import type { ArticleOutline, ArticleTopic, OutlineSection, TopicIntent } from './types';
import {
  runGeoGate, type GateFailure,
  OPENING_MIN_WORDS, OPENING_MAX_WORDS, MIN_INFO_GAIN_FACTS, HEBREW_QUESTION_WORDS,
} from './geo-rules';
import { xt, xtAll } from './tags';

// ── Token budgets per stage ───────────────────────────────────────────────────

export const OUTLINE_MAX_TOKENS = 1500;
export const SECTION_MAX_TOKENS = 1200;
export const FAQ_MAX_TOKENS     = 1500;
export const EDIT_MAX_TOKENS    = 4000;

// ── Shared prompt fragments (§3.1) ────────────────────────────────────────────

/** §3.1(5): simple Hebrew — engines struggle with complex Hebrew morphology. */
export const SIMPLE_HEBREW_RULE =
  'כתוב בעברית פשוטה: משפטים קצרים והצהרתיים (עד ~15 מילים), מילים יומיומיות, ' +
  'בלי מליצות ובלי תחביר מסובך — מנועי חיפוש ו-AI מתקשים במורפולוגיה עברית מורכבת.';

/** §3.1(2): Princeton GEO levers — every injected concrete fact gets tagged so
    the deterministic gate can count information gain. */
export const FACT_TAG_RULE =
  'כשאתה משלב נתון קונקרטי מתוך העובדות או הציטוטים (מחיר בש"ח, מספר, אחוז, שם ספציפי, ' +
  'ציטוט לקוח) — עטוף אותו בדיוק כך: [FACT]הנתון[/FACT]. אסור להמציא עובדות: ' +
  'תייג רק נתונים שמופיעים בחומר שסופק.';

// ── Inputs / results ──────────────────────────────────────────────────────────

/** The articles row fields the generator needs (status 'idea' or 'outline'). */
export interface ArticleRowForGenerate {
  id:           string;
  title:        string;
  kind:         string;
  keywords:     string[];
  topic_source: Record<string, unknown> | null;
  grounded_in:  string[];
  rationale:    string | null;
}

export interface GenerateArticleInput {
  article:        ArticleRowForGenerate;
  atoms:          ClientInsight[];
  quotes:         VocQuoteRow[];
  run:            StageRunner;
  admin:          SupabaseClient;
  /** Injected — geo-rules is pure; the impure boundary (route) supplies the year. */
  currentYear:    number;
  /** Optional LLM register judge for brand-lint; deterministic rules always run. */
  registerJudge?: RegisterJudge;
}

export interface ArticleGateSummary {
  passed:    boolean;
  failures:  GateFailure[];
  factCount: number;
}

export type GenerateArticleResult =
  | {
      ok:         true;
      article_id: string;
      /** 'draft' iff the §3.1 gate passed; gate failure keeps 'outline'. */
      status:     'draft' | 'outline';
      outline:    ArticleOutline;
      body_md:    string;
      gate:       ArticleGateSummary;
      lint:       LintResult;
      seo:        { title: string; description: string };
    }
  | {
      ok:         false;
      article_id: string;
      stage:      'outline' | 'section' | 'faq' | 'persist';
      error:      string;
    };

// ── Grounding blocks ──────────────────────────────────────────────────────────

const MAX_ATOMS_IN_PROMPT = 20;

/** Atom facts for injection — injection atoms (topic_source.injectionAtomIds) first. */
export function buildFactsBlock(atoms: ClientInsight[], injectionAtomIds: string[] = []): string {
  const inj = new Set(injectionAtomIds);
  const ordered = [...atoms].sort((a, b) => Number(inj.has(b.id)) - Number(inj.has(a.id)));
  return ordered
    .slice(0, MAX_ATOMS_IN_PROMPT)
    .map((a) => `- (${a.layer}/${a.kind}) ${a.content}`)
    .join('\n');
}

// ── Stage 1: outline ──────────────────────────────────────────────────────────

export interface ParsedOutline extends ArticleOutline {
  seoTitle:       string;
  seoDescription: string;
}

export function parseOutline(raw: string): ParsedOutline | null {
  const h1      = xt(raw, 'H1');
  const opening = xt(raw, 'OPENING');
  const sections: OutlineSection[] = [];
  for (const block of xtAll(raw, 'SECTION')) {
    const h2 = block.match(/^\s*h2\s*:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const points = [...block.matchAll(/^\s*-\s+(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
    if (h2) sections.push({ h2, points });
  }
  const faq = xtAll(raw, 'FAQ_Q').map((q) => ({ q }));
  if (!h1 || !opening || sections.length < 2 || faq.length < 1) return null;
  return {
    h1,
    opening_answer: opening,
    sections,
    faq,
    seoTitle:       xt(raw, 'SEO_TITLE') || h1,
    seoDescription: xt(raw, 'SEO_DESCRIPTION'),
  };
}

function outlinePrompts(
  article: ArticleRowForGenerate, topic: Partial<ArticleTopic>,
  factsBlock: string, quotesBlock: string, currentYear: number,
): { system: string; user: string } {
  const intent = (topic.intent ?? 'informational') as TopicIntent;
  const yearRule = intent === 'commercial'
    ? `- הנושא מסחרי: חובה לכלול את השנה ${currentYear} ב-H1 וב-SEO_TITLE (למשל "… ${currentYear}").`
    : `- אין חובת שנה בכותרת (הנושא אינו מסחרי).`;

  const system = `אתה אסטרטג תוכן GEO (אופטימיזציה למנועי AI) לעסקים ישראליים. בנה מתאר (outline) למאמר בעברית.

═══ כללי §3.1 (מחייבים) ═══
- OPENING = תשובה עצמאית ומלאה של ${OPENING_MIN_WORDS}–${OPENING_MAX_WORDS} מילים שמזכירה את העסק, השירות והעיר (כשידועים) — הקורא מקבל את התשובה כבר בפתיח.
- כל H2 חייב להיות בצורת שאלה: מסתיים ב-'?' או פותח במילת שאלה (${HEBREW_QUESTION_WORDS.join('/')}).
- 3–5 סקשנים, כל אחד עם 2–4 נקודות תוכן שנשענות על העובדות והציטוטים שסופקו.
- FAQ: 3–5 שאלות אמיתיות של לקוחות (ינותבו לכותרות H2 בגוף — ללא סכמת FAQ).
${yearRule}
- ${SIMPLE_HEBREW_RULE}

═══ OUTPUT CONTRACT (החזר אך ורק את התגיות, בסדר הזה) ═══
[H1]כותרת המאמר[/H1]
[OPENING]הפתיח המלא (${OPENING_MIN_WORDS}–${OPENING_MAX_WORDS} מילים)[/OPENING]
[SECTION]h2: שאלת הסקשן?
- נקודה
- נקודה[/SECTION]
(חזור על [SECTION] לכל סקשן)
[FAQ_Q]שאלה?[/FAQ_Q]
(חזור על [FAQ_Q] לכל שאלה)
[SEO_TITLE]כותרת SEO עד 60 תווים[/SEO_TITLE]
[SEO_DESCRIPTION]תיאור מטא עד 155 תווים[/SEO_DESCRIPTION]`;

  const user = `נושא: ${article.title}
סוג תוכן: ${article.kind} | כוונת חיפוש: ${intent}
שאילתות יעד: ${article.keywords.join(' · ') || '—'}
רציונל: ${article.rationale ?? topic.rationale_he ?? '—'}

═══ עובדות העסק (חומר ההזרקה — statistics per §3.1) ═══
${factsBlock || '— אין —'}

═══ ציטוטי לקוחות (VoC — quotations per §3.1) ═══
${quotesBlock || '— אין —'}`;

  return { system, user };
}

// ── Stage 2: per-section markdown ─────────────────────────────────────────────

function sectionPrompts(
  h1: string, section: OutlineSection, factsBlock: string, quotesBlock: string,
): { system: string; user: string } {
  const system = `אתה כותב תוכן GEO בעברית. כתוב סקשן אחד של מאמר.

═══ כללים ═══
- ${SIMPLE_HEBREW_RULE}
- הסקשן חייב לשרוד חילוץ עצמאי (passage-level RAG): פתח במשפט שעונה ישירות על שאלת הסקשן.
- ${FACT_TAG_RULE}
- המאמר כולו חייב לכלול לפחות ${MIN_INFO_GAIN_FACTS} עובדות מתויגות — שלב לפחות עובדה אחת בסקשן הזה כשיש חומר רלוונטי.
- 80–180 מילים. אל תכלול את הכותרת עצמה — רק את גוף הסקשן.

═══ OUTPUT CONTRACT ═══
[SECTION_MD]גוף הסקשן במרקדאון (ללא כותרת)[/SECTION_MD]`;

  const user = `מאמר: ${h1}
שאלת הסקשן: ${section.h2}
נקודות לכיסוי:
${section.points.map((p) => `- ${p}`).join('\n') || '- לפי שיקולך'}

═══ עובדות העסק ═══
${factsBlock || '— אין —'}

═══ ציטוטי לקוחות ═══
${quotesBlock || '— אין —'}`;

  return { system, user };
}

// ── Stage 3: FAQ answers ──────────────────────────────────────────────────────

function faqPrompts(
  h1: string, questions: string[], factsBlock: string, quotesBlock: string,
): { system: string; user: string } {
  const system = `אתה כותב תוכן GEO בעברית. ענה על שאלות נפוצות של לקוחות.

═══ כללים ═══
- ${SIMPLE_HEBREW_RULE}
- כל תשובה: 2–4 משפטים, עונה ישירות ובמלואה (התשובה תופיע תחת כותרת H2 של השאלה).
- ${FACT_TAG_RULE}

═══ OUTPUT CONTRACT — תגית [FAQ_A] אחת לכל שאלה, באותו סדר ═══
[FAQ_A]תשובה לשאלה 1[/FAQ_A]
[FAQ_A]תשובה לשאלה 2[/FAQ_A]`;

  const user = `מאמר: ${h1}
השאלות (ענה לפי הסדר, תגית אחת לכל שאלה):
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

═══ עובדות העסק ═══
${factsBlock || '— אין —'}

═══ ציטוטי לקוחות ═══
${quotesBlock || '— אין —'}`;

  return { system, user };
}

// ── Stage 4: assembly + edit pass ─────────────────────────────────────────────

/** Deterministic assembly: H1 → opening → question-H2 sections → FAQ as `## question` H2s. */
export function assembleBody(
  outline: ArticleOutline, sectionMds: string[], faqAnswers: string[],
): string {
  const parts: string[] = [`# ${outline.h1}`, '', outline.opening_answer, ''];
  outline.sections.forEach((s, i) => {
    parts.push(`## ${s.h2}`, '', sectionMds[i] ?? '', '');
  });
  outline.faq.forEach((f, i) => {
    parts.push(`## ${f.q}`, '', faqAnswers[i] ?? '', '');
  });
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function editPrompts(assembled: string): { system: string; user: string } {
  const system = `אתה עורך לשוני של תוכן GEO בעברית. החלק מעברים בין סקשנים ואכוף עברית פשוטה.

═══ כללים (מחייבים) ═══
- ${SIMPLE_HEBREW_RULE}
- שמור על כל הכותרות (# ו-##) בדיוק כפי שהן — אל תשנה, תוסיף או תמחק כותרות.
- שמור על כל תגיות [FACT]…[/FACT] בדיוק כפי שהן — אל תסיר ואל תוסיף תגיות.
- אל תקצר את הפתיח מתחת ל-${OPENING_MIN_WORDS} מילים ואל תאריך אותו מעל ${OPENING_MAX_WORDS}.

═══ OUTPUT CONTRACT ═══
[BODY_MD]המאמר המלא הערוך[/BODY_MD]`;

  return { system, user: assembled };
}

// ── Retry-once tagged call ────────────────────────────────────────────────────

const RETRY_NUDGE =
  '\n\nהתשובה הקודמת לא עמדה בחוזה הפלט. החזר אך ורק את התגיות המבוקשות, במבנה המדויק שהוגדר.';

async function callTagged<T>(
  run: StageRunner, system: string, user: string, maxTokens: number,
  parse: (raw: string) => T | null,
): Promise<T | null> {
  const first = parse(await run(system, user, maxTokens));
  if (first !== null) return first;
  return parse(await run(system, user + RETRY_NUDGE, maxTokens));
}

// ── The pipeline ──────────────────────────────────────────────────────────────

/**
 * Run the full P3-3 pipeline over an articles row in status 'idea'/'outline'.
 * Persists: outline → status 'outline' (after stage 1); body_md + seo →
 * status 'draft' ONLY when the §3.1 gate passes (failure keeps 'outline' with
 * seo.gate_failures[] recorded — never published-eligible). Never throws on
 * runner/parse failures — returns ok:false so the route can refund.
 */
export async function generateArticle(input: GenerateArticleInput): Promise<GenerateArticleResult> {
  const { article, atoms, quotes, run, admin, currentYear } = input;
  const topic = (article.topic_source ?? {}) as Partial<ArticleTopic>;
  const intent = (topic.intent ?? 'informational') as TopicIntent;
  const factsBlock  = buildFactsBlock(atoms, topic.injectionAtomIds ?? []);
  const quotesBlock = formatQuotesForPrompt(quotes);

  // ── 1. Outline (retry once on malformed, then fail cleanly) ──
  let parsed: ParsedOutline | null;
  try {
    const p = outlinePrompts(article, topic, factsBlock, quotesBlock, currentYear);
    parsed = await callTagged(run, p.system, p.user, OUTLINE_MAX_TOKENS, parseOutline);
  } catch (err) {
    return { ok: false, article_id: article.id, stage: 'outline', error: errMsg(err) };
  }
  if (!parsed) {
    return { ok: false, article_id: article.id, stage: 'outline', error: 'מתאר לא תקין גם אחרי ניסיון חוזר' };
  }
  const outline: ArticleOutline = {
    h1:             parsed.h1,
    opening_answer: parsed.opening_answer,
    sections:       parsed.sections,
    faq:            parsed.faq,
  };
  const seo = { title: parsed.seoTitle, description: parsed.seoDescription };

  // Persist the outline → status 'outline'.
  {
    const { error } = await admin.from('articles')
      .update({ outline, seo, status: 'outline', updated_at: new Date().toISOString() })
      .eq('id', article.id);
    if (error) return { ok: false, article_id: article.id, stage: 'persist', error: error.message };
  }

  // ── 2. Per-section calls ──
  const sectionMds: string[] = [];
  for (const section of outline.sections) {
    try {
      const p = sectionPrompts(outline.h1, section, factsBlock, quotesBlock);
      const md = await callTagged(run, p.system, p.user, SECTION_MAX_TOKENS,
        (raw) => xt(raw, 'SECTION_MD') || null);
      if (!md) {
        return { ok: false, article_id: article.id, stage: 'section', error: `סקשן "${section.h2}" לא תקין גם אחרי ניסיון חוזר` };
      }
      sectionMds.push(md);
    } catch (err) {
      return { ok: false, article_id: article.id, stage: 'section', error: errMsg(err) };
    }
  }

  // ── 3. FAQ answers (one call for all questions) ──
  let faqAnswers: string[];
  try {
    const questions = outline.faq.map((f) => f.q);
    const p = faqPrompts(outline.h1, questions, factsBlock, quotesBlock);
    const answers = await callTagged(run, p.system, p.user, FAQ_MAX_TOKENS, (raw) => {
      const a = xtAll(raw, 'FAQ_A');
      return a.length === questions.length ? a : null;
    });
    if (!answers) {
      return { ok: false, article_id: article.id, stage: 'faq', error: 'תשובות FAQ לא תואמות את מספר השאלות גם אחרי ניסיון חוזר' };
    }
    faqAnswers = answers;
  } catch (err) {
    return { ok: false, article_id: article.id, stage: 'faq', error: errMsg(err) };
  }

  // ── 4. Deterministic assembly + fail-open edit pass ──
  const assembled = assembleBody(outline, sectionMds, faqAnswers);
  let finalTagged = assembled;
  try {
    const p = editPrompts(assembled);
    const edited = xt(await run(p.system, p.user, EDIT_MAX_TOKENS), 'BODY_MD');
    // Fail-open guards: the edit pass only smooths — if it dropped facts or
    // changed the heading structure, the deterministic assembly wins.
    if (edited && sameStructure(assembled, edited)) finalTagged = edited;
  } catch {
    // Edit pass is optional polish — the assembly is already complete.
  }

  // ── 5. The §3.1 gate (deterministic, geo-rules.ts) ──
  const gate = runGeoGate({
    bodyMd: finalTagged, title: outline.h1, intent, currentYear,
  });

  // ── 6. Brand-lint (flag-only) on the reader-facing body ──
  const lint = await lintArtifact(gate.bodyMd, atoms, input.registerJudge);

  const status: 'draft' | 'outline' = gate.ok ? 'draft' : 'outline';
  const seoFinal = {
    ...seo,
    lint: {
      score:      lint.score,
      passed:     lint.passed,
      violations: lint.violations.slice(0, 8).map((v) => ({ rule: v.rule, severity: v.severity, message: v.message })),
    },
    gate: { passed: gate.ok, fact_count: gate.factCount },
    ...(gate.ok ? {} : { gate_failures: gate.failures }),
  };

  // body_md is persisted either way (work is never lost) — but the status only
  // becomes 'draft' (publish-eligible lifecycle) when the gate passes.
  {
    const { error } = await admin.from('articles')
      .update({ body_md: gate.bodyMd, seo: seoFinal, status, updated_at: new Date().toISOString() })
      .eq('id', article.id);
    if (error) return { ok: false, article_id: article.id, stage: 'persist', error: error.message };
  }

  return {
    ok:         true,
    article_id: article.id,
    status,
    outline,
    body_md:    gate.bodyMd,
    gate:       { passed: gate.ok, failures: gate.failures, factCount: gate.factCount },
    lint,
    seo,
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Edit-pass acceptance: same H2 skeleton and no information-gain loss. */
function sameStructure(assembled: string, edited: string): boolean {
  const h2Count = (s: string) => (s.match(/^##\s+/gm) ?? []).length;
  const factCount = (s: string) => (s.match(/\[FACT\]/g) ?? []).length;
  return h2Count(edited) === h2Count(assembled) && factCount(edited) >= factCount(assembled);
}
