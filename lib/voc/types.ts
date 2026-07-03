// lib/voc/types.ts
//
// Internal vocabulary for C-08 voice-of-customer ingestion (MARKETING-
// CAPABILITIES-SPEC C-08; craft source: .claude/skills/voc-mining).
//
// The DB row shapes (VocDocumentRow, VocQuoteRow, VocAtomAction, the
// VocExtractable / VocSource unions) live in lib/capability-contracts and are
// imported, never redefined — this file holds only the pipeline-internal
// shapes: what extraction produces, what reconciliation decides, and what an
// ingest run reports.

import type {
  VocAtomAction,
  VocDocumentStatus,
  VocExtractable,
  VocSource,
} from '@/lib/capability-contracts';
import type { InsightLayer } from '@/lib/intelligence/types';

// ── extraction ────────────────────────────────────────────────────────────────

export type VocPolarity  = 'positive' | 'negative' | 'neutral';
export type VocFunnelFit = 'TOFU' | 'MOFU' | 'BOFU';

/**
 * One quote as the extraction model emits it — VERBATIM per voc-mining §3
 * ("quote first, abstraction second"): `quote` must be an exact span of the
 * source text (whitespace/punctuation tolerance only; fabrications are
 * rejected by the parser's containment gate).
 *
 * `target_hint` is the model's pointer at the existing-atom content this quote
 * seems to corroborate (the reconcile-never-blind-add discipline of §3): the
 * quote's own words often won't fuzzy-match the atom's abstraction, so the
 * model bridges them.
 */
export interface ExtractedQuote {
  quote:        string;
  extractable:  VocExtractable;
  polarity:     VocPolarity;
  segment_tags: Record<string, unknown>;
  funnel_fit:   VocFunnelFit | null;
  target_hint?: string;
}

export interface ExtractionResult {
  quotes: ExtractedQuote[];
}

/** One extraction item the parser refused, with the WHY (observability). */
export interface DroppedQuote {
  reason: 'fabricated' | 'invalid_extractable' | 'invalid_polarity' | 'empty_quote' | 'not_an_object';
  /** Short excerpt of the offending item for the report (never the full raw). */
  detail: string;
}

/**
 * Total result of parsing model output. `ok:false` means the OUTPUT SHAPE was
 * unusable (not JSON / no quotes array) — a per-item problem never fails the
 * batch, it lands in `dropped`. `fabricated` is broken out because it is the
 * anti-hallucination headline number.
 */
export type ParseExtractionResult =
  | { ok: true; quotes: ExtractedQuote[]; dropped: DroppedQuote[]; fabricated: number }
  | { ok: false; error: string };

// ── reconciliation ────────────────────────────────────────────────────────────

/** A stored quote (post-insert, with its row id) plus its extraction-time hint. */
export interface ReconcileQuoteInput {
  id:           string;
  document_id:  string;
  quote:        string;
  extractable:  VocExtractable;
  polarity:     VocPolarity;
  segment_tags: Record<string, unknown>;
  target_hint?: string;
}

/** Per-quote outcome, stamped back onto voc_quotes.atom_action. */
export interface ReconcileOutcome {
  quote_id: string;
  action:   VocAtomAction;
}

export interface ReconcileSummary {
  corroborated: number;
  created:      number;
  contradicted: number;
  skipped:      number;
}

/**
 * A brief-vs-customers contradiction worth the owner's eyes (voc-mining §3:
 * "VoC contradicting the brief is a feature … surface such contradictions to
 * the owner as insight, gently"; §6.5 owner surfacings).
 */
export interface OwnerSurfacing {
  kind:            'contradiction';
  insight_id:      string;
  insight_content: string;
  quote_id:        string;
  quote:           string;
  /** Atom confidence BEFORE the weakening signal was applied. */
  prior_confidence: number;
}

export interface ReconcileResult {
  outcomes:         ReconcileOutcome[];
  summary:          ReconcileSummary;
  owner_surfacings: OwnerSurfacing[];
}

// ── ingest ────────────────────────────────────────────────────────────────────

export interface IngestInput {
  clientId:    string;
  ownerUserId: string;
  source:      VocSource;
  sourceMeta?: Record<string, unknown>;
  rawText:     string;
  /**
   * Names to PII-strip from quotes before storage (client contact names, the
   * owner's name) — see lib/voc/pii stripPii `names` option.
   */
  piiNames?:   string[];
}

/** Which pipeline stage failed (earlier stages' data is preserved — resumable). */
export type IngestStage = 'insert_document' | 'extract' | 'store_quotes' | 'reconcile';

export type IngestResult =
  | {
      ok:                   true;
      deduped:              false;
      document_id:          string;
      status:               'reconciled';
      quote_count:          number;
      atom_actions_summary: ReconcileSummary;
      owner_surfacings:     OwnerSurfacing[];
      dropped:              DroppedQuote[];
      /** Model-invented quotes rejected by the containment gate (headline). */
      fabricated_rejected:  number;
    }
  | {
      /** Same raw_hash already ingested for this client — idempotent return. */
      ok:          true;
      deduped:     true;
      document_id: string;
      status:      VocDocumentStatus;
      quote_count: number;
    }
  | {
      ok:          false;
      document_id: string | null;
      status:      'failed';
      stage:       IngestStage;
      error:       string;
    };

// ── policy constants (voc-mining §3 confidence math) ──────────────────────────

/**
 * Signal-weight policy per voc-mining §3 ("frequency = confidence fuel"):
 *  • SINGLE_QUOTE (0.25): one quote is an anecdote. Through the lifecycle's
 *    ±0.12*weight step this moves an atom by 0.03 — many quotes are needed to
 *    make an atom load-bearing, exactly the skill's intent.
 *  • CROSS_SOURCE (0.4): the same content recurring across ≥2 DISTINCT source
 *    documents ("recurrence across independent sources weighs more than
 *    recurrence within one"). Detected against both the current batch and the
 *    client's previously stored quotes.
 */
export const VOC_WEIGHTS = {
  SINGLE_QUOTE: 0.25,
  CROSS_SOURCE: 0.4,
} as const;

/** Starting confidence for a brand-new VoC-seeded atom (skill §3: ~0.3–0.4). */
export const VOC_NEW_ATOM_CONFIDENCE = 0.35;

/**
 * A negative quote against an atom at/above this confidence is surfaced to
 * the owner (the atom was considered established; customer reality disagrees).
 * Below it, the weakening still applies but silently — no drama over seedlings.
 */
export const CONTRADICTION_SURFACE_THRESHOLD = 0.6;

/**
 * Extractable → atom-matching targets (voc-mining §3 kind map):
 *  • pain / desire / objection / alternative are ATOM-WORTHY: no match =>
 *    create a new customers-layer atom (kind per `createKind`).
 *    NOTE: 'alternative' is NOT in lib/intelligence KINDS.customers — free-form
 *    kinds are explicitly tolerated by the lifecycle (types.ts §Kind taxonomy);
 *    it stores + corroborates fine, it just doesn't project into the strategy
 *    snapshot until the taxonomy grows.
 *  • trigger matches ANY customers-layer atom (kinds: null) and enriches its
 *    structured.triggers; unmatched triggers are skipped (a trigger is a
 *    property OF an atom, not an atom).
 *  • proof matches business-layer proof/value atoms only; unmatched proof is
 *    skipped, NOT auto-created — quotable praise needs an owner permission ask
 *    first (skill §6.5), so it stays in the quote bank until then.
 *  • identity enriches persona atoms (structured.identity_phrases); unmatched
 *    identity phrases are skipped (persona creation is the analyzer's job).
 */
export const EXTRACTABLE_TARGETS: Record<
  VocExtractable,
  { layer: InsightLayer; kinds: readonly string[] | null; createKind?: string; enrichField?: 'triggers' | 'identity_phrases' }
> = {
  pain:        { layer: 'customers', kinds: ['pain'],                                            createKind: 'pain' },
  desire:      { layer: 'customers', kinds: ['desire', 'aspiration', 'dream', 'unspoken_want'],  createKind: 'desire' },
  objection:   { layer: 'customers', kinds: ['objection'],                                       createKind: 'objection' },
  alternative: { layer: 'customers', kinds: ['alternative'],                                     createKind: 'alternative' },
  trigger:     { layer: 'customers', kinds: null,                                                enrichField: 'triggers' },
  proof:       { layer: 'business',  kinds: ['proof', 'true_value', 'pain_solved'] },
  identity:    { layer: 'customers', kinds: ['persona'],                                         enrichField: 'identity_phrases' },
} as const;

/** Extractables that justify creating a NEW atom when nothing matches. */
export const ATOM_WORTHY: ReadonlySet<VocExtractable> = new Set([
  'pain', 'desire', 'objection', 'alternative',
]);
