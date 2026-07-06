// lib/articles/types.ts
//
// P3-2 topic engine vocabulary (ORGANIC-TASKS P3-2, built to
// docs/ORGANIC-DEEP-RESEARCH.md §1.1 — "Atom→query mapping").
//
// The customers-layer atoms ARE the keyword research (§1): each atom kind maps
// to a family of Hebrew query intents; the engine is fully deterministic (no
// LLM) so topics are reproducible, auditable, and free.

import type { ClientInsight } from '@/lib/intelligence/types';

/**
 * Search intent classes per §1.1 + the §1.1 priority rule
 * ("commercial/transactional/local-action topics first").
 *  - commercial:     price/cost/worth-it queries (objection atoms) — MOFU, still gets clicks
 *  - transactional:  outcome/service queries (desire/aspiration/dream) — service-page angle
 *  - comparison:     "X או Y" / "ההבדל בין" (alternative atoms) — the open lane
 *  - informational:  symptom/problem/private-question queries (pain/unspoken_want) —
 *                    KPI is AI citation, not clicks (§1.1 note)
 */
export type TopicIntent = 'commercial' | 'transactional' | 'comparison' | 'informational';

/** The §1.1 "Content type" column, as machine tags. */
export type TopicContentType =
  | 'tofu_article_faq'          // pain → TOFU article + FAQ section
  | 'mofu_pricing_comparison'   // objection → MOFU comparison/pricing page
  | 'service_page_angle'        // desire/aspiration → service page angle + proof gallery
  | 'geo_faq_article'           // unspoken_want / VoC question → answer-first FAQ/article
  | 'comparison_page'           // alternative → "X או Y" comparison content
  | 'eeat_asset';               // proof → before/after, testimonials, reviews

/** articles.kind (migration 054 CHECK constraint). */
export type ArticleKind = 'article' | 'listicle' | 'guide' | 'video_script';

/** One scored, grounded topic in the backlog. */
export interface ArticleTopic {
  title_he:         string;
  query_patterns:   string[];        // Hebrew-first target queries (incl. morphological variants)
  intent:           TopicIntent;
  content_type:     TopicContentType;
  kind:             ArticleKind;
  atomIds:          string[];        // the customers-layer atoms that generated the topic
  /** Business-layer atoms — §1.1 last row: "the information-gain injections every page needs". */
  injectionAtomIds: string[];
  score:            number;          // intent-weighted × confidence (+ VoC boost); sort key
  confidence:       number;          // source-atom confidence (0.5 for VoC-only topics)
  voc_backed:       boolean;         // backed by verbatim customer language (VoC quote bank)
  rationale_he:     string;          // plain-language WHY (Hebrew)
}

/** A real customer question (verbatim), typically derived from the VoC quote bank. */
export interface VocQuestionInput {
  text:     string;
  quoteId?: string;
}

export interface TopicEngineConfig {
  /** The service/offer term filling the X slot in §1.1 templates ("כמה עולה X").
      Defaults to the highest-confidence core_offer/real_solution business atom. */
  offer?: string;
  /** City for local-action queries ("כמה עולה X ב[עיר]"). Defaults to a
      business atom's structured.city when present. */
  city?: string;
  /** Cap on query_patterns per topic (morphological expansion is prolific). */
  maxPatternsPerTopic?: number;
  /** Cap on the backlog length. */
  maxTopics?: number;
}

export interface BuildTopicBacklogInput {
  atoms:         ClientInsight[];
  vocQuestions?: VocQuestionInput[];
  config?:       TopicEngineConfig;
}

export interface SaveTopicsResult {
  created: number;
  skipped: number;
}
