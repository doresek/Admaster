// lib/voc/reconcile.ts
//
// Quotes → atoms THROUGH THE LIFECYCLE (voc-mining §3: "reconcile, never
// blind-add"). This module owns zero confidence math — every atom movement is
// a learning_signals row (signal_type 'voc_evidence', widened by migration
// 034) claimed via claimSignal and applied via applyLearningSignal, exactly
// the lib/hypotheses/resolve-and-learn emission pattern. New atoms go through
// createInsight. Matching uses the lifecycle's own contentMatches — one fuzzy
// matcher for the whole brain, not a private reimplementation.
//
// Per-quote failures are recorded as typed outcomes ('skipped' with a reason),
// never thrown: the stored quotes are already durable and a partially-failed
// reconcile must not lose them (ingest keeps the document resumable).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VocAtomAction } from '@/lib/capability-contracts';
import { applyLearningSignal, claimSignal, contentMatches } from '@/lib/intelligence/lifecycle';
import { createInsight, listActiveInsights } from '@/lib/intelligence/insights';
import type { ClientInsight } from '@/lib/intelligence/types';
import {
  ATOM_WORTHY,
  CONTRADICTION_SURFACE_THRESHOLD,
  EXTRACTABLE_TARGETS,
  VOC_NEW_ATOM_CONFIDENCE,
  VOC_WEIGHTS,
  type OwnerSurfacing,
  type ReconcileOutcome,
  type ReconcileQuoteInput,
  type ReconcileResult,
  type ReconcileSummary,
} from './types';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** How many prior quotes to scan for cross-source recurrence (recency-capped). */
const PRIOR_QUOTE_SCAN_LIMIT = 500;

interface PriorQuote {
  id:          string;
  document_id: string;
  quote:       string;
  extractable: string;
}

/** Fetch the client's previously stored quotes (for cross-source weighting). */
async function fetchPriorQuotes(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<PriorQuote[]> {
  const { data, error } = await supabase
    .from('voc_quotes')
    .select('id, document_id, quote, extractable')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .order('created_at', { ascending: false })
    .limit(PRIOR_QUOTE_SCAN_LIMIT)
    .overrideTypes<PriorQuote[], { merge: false }>();
  if (error) throw new Error(`fetchPriorQuotes: ${error.message}`);
  return data ?? [];
}

/**
 * Weight policy (VOC_WEIGHTS, voc-mining §3): a quote whose content recurs in
 * a DIFFERENT source document — elsewhere in this batch, or among the client's
 * previously stored quotes — carries the CROSS_SOURCE weight (0.4); a lone
 * quote is an anecdote (0.25). "Recurrence across independent sources weighs
 * more than recurrence within one."
 */
function weightFor(
  quote:  ReconcileQuoteInput,
  batch:  ReconcileQuoteInput[],
  priors: PriorQuote[],
): number {
  const inBatch = batch.some(
    (other) =>
      other.id !== quote.id &&
      other.document_id !== quote.document_id &&
      other.extractable === quote.extractable &&
      contentMatches(other.quote, quote.quote),
  );
  if (inBatch) return VOC_WEIGHTS.CROSS_SOURCE;

  const inPriors = priors.some(
    (p) =>
      p.document_id !== quote.document_id &&
      p.extractable === quote.extractable &&
      contentMatches(p.quote, quote.quote),
  );
  return inPriors ? VOC_WEIGHTS.CROSS_SOURCE : VOC_WEIGHTS.SINGLE_QUOTE;
}

/** Find the active atom this quote speaks to (target_hint first, then direct). */
function findMatch(quote: ReconcileQuoteInput, active: ClientInsight[]): ClientInsight | undefined {
  const target = EXTRACTABLE_TARGETS[quote.extractable];
  const candidates = active.filter(
    (a) =>
      a.status === 'active' &&
      a.layer === target.layer &&
      (target.kinds === null || target.kinds.includes(a.kind)),
  );
  if (quote.target_hint) {
    const hinted = candidates.find((a) => contentMatches(a.content, quote.target_hint ?? ''));
    if (hinted) return hinted;
  }
  return candidates.find((a) => contentMatches(a.content, quote.quote));
}

/**
 * Merge one quote into an atom's structured evidence list (triggers /
 * identity_phrases — voc-mining §3: trigger → `structured.trigger` on the
 * relevant atom; identity → persona enrichment). Deduplicated; best-effort:
 * a failed enrichment is logged and noted but never fails the corroboration —
 * the learning signal already moved the atom.
 */
async function enrichStructured(
  supabase: SupabaseClient,
  atom:     ClientInsight,
  field:    'triggers' | 'identity_phrases',
  quote:    string,
): Promise<string | null> {
  const structured = { ...(atom.structured ?? {}) };
  const existing = Array.isArray(structured[field])
    ? (structured[field] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  if (existing.includes(quote)) return null;
  structured[field] = [...existing, quote];

  const { error } = await supabase
    .from('client_insights')
    .update({ structured, updated_at: new Date().toISOString() })
    .eq('id', atom.id);
  if (error) {
    console.error(`[voc/reconcile] enrich ${field} failed for ${atom.id}:`, error.message);
    return `enrich_failed: ${error.message}`;
  }
  atom.structured = structured;
  return null;
}

export interface ReconcileQuotesInput {
  clientId:    string;
  ownerUserId: string;
  quotes:      ReconcileQuoteInput[];
}

/**
 * Reconcile a batch of stored quotes against the client's living atoms:
 *
 *   match found → learning_signals('voc_evidence') → claim → applyLearningSignal
 *     • positive/neutral quote → 'corroborated'
 *     • negative quote → 'contradicted' (a real weakening signal, NOT a silent
 *       skip — brief-vs-customers contradiction is a feature); when the atom
 *       was high-confidence (≥ CONTRADICTION_SURFACE_THRESHOLD) it is also
 *       collected into owner_surfacings (skill §6.5).
 *     • trigger/identity matches additionally enrich structured evidence.
 *   no match + atom-worthy (pain/desire/objection/alternative) → createInsight
 *     at VOC_NEW_ATOM_CONFIDENCE (0.35, skill §3 seed range), source 'voc'
 *     (first-class provenance since migration 038 widened the 028 CHECK) with
 *     source_ref {voc: true, voc_quote_id, document_id} kept for traceability.
 *   no match + not atom-worthy (trigger/proof/identity) → 'skipped' with
 *     reason (proof stays in the quote bank pending the owner permission ask).
 *
 * Every outcome is stamped onto voc_quotes.atom_action for quote→atom
 * traceability.
 */
export async function reconcileQuotes(
  supabase: SupabaseClient,
  input:    ReconcileQuotesInput,
): Promise<ReconcileResult> {
  const { clientId, ownerUserId, quotes } = input;

  // Local mutable views: created atoms join `active` so later quotes in the
  // same batch corroborate them instead of duplicating them.
  const active = await listActiveInsights(supabase, clientId);
  const priorsAll = await fetchPriorQuotes(supabase, clientId, ownerUserId);
  const batchIds = new Set(quotes.map((q) => q.id));
  // The batch's own rows are already in the table — exclude them from priors.
  const priors = priorsAll.filter((p) => !batchIds.has(p.id));

  const outcomes: ReconcileOutcome[] = [];
  const owner_surfacings: OwnerSurfacing[] = [];
  const summary: ReconcileSummary = { corroborated: 0, created: 0, contradicted: 0, skipped: 0 };

  for (const quote of quotes) {
    const action = await reconcileOne(supabase, quote, {
      clientId, ownerUserId, active, batch: quotes, priors, owner_surfacings,
    });
    summary[action.action === 'corroborated' ? 'corroborated'
      : action.action === 'created' ? 'created'
      : action.action === 'contradicted' ? 'contradicted'
      : 'skipped']++;
    outcomes.push({ quote_id: quote.id, action });

    // Stamp traceability onto the quote row. A failed stamp never loses the
    // outcome (it is returned to the caller) — log and continue.
    const { error: stampError } = await supabase
      .from('voc_quotes')
      .update({ atom_action: action })
      .eq('id', quote.id);
    if (stampError) {
      console.error(`[voc/reconcile] atom_action stamp failed for quote ${quote.id}:`, stampError.message);
    }
  }

  return { outcomes, summary, owner_surfacings };
}

interface ReconcileContext {
  clientId:         string;
  ownerUserId:      string;
  active:           ClientInsight[];
  batch:            ReconcileQuoteInput[];
  priors:           PriorQuote[];
  owner_surfacings: OwnerSurfacing[];
}

async function reconcileOne(
  supabase: SupabaseClient,
  quote:    ReconcileQuoteInput,
  ctx:      ReconcileContext,
): Promise<VocAtomAction> {
  const target = EXTRACTABLE_TARGETS[quote.extractable];
  const match = findMatch(quote, ctx.active);

  // ── matched: evidence flows through the lifecycle ───────────────────────────
  if (match) {
    const weight = weightFor(quote, ctx.batch, ctx.priors);
    // Neutral quotes still evidence the theme's EXISTENCE → positive signal.
    const polarity: 'positive' | 'negative' = quote.polarity === 'negative' ? 'negative' : 'positive';
    const priorConfidence = match.confidence;

    const { data: signalData, error: signalError } = await supabase
      .from('learning_signals')
      .insert({
        client_id:     ctx.clientId,
        owner_user_id: ctx.ownerUserId,
        insight_id:    match.id,
        signal_type:   'voc_evidence',
        polarity,
        weight,
        detail:        `voc ${quote.extractable}: "${quote.quote.slice(0, 200)}"`,
        metrics:       { voc_quote_id: quote.id, document_id: quote.document_id },
        processed:     false,
      })
      .select('id')
      .single();

    if (signalError || !signalData) {
      console.error('[voc/reconcile] learning_signals insert failed:', signalError?.message);
      return { action: 'skipped', insight_id: match.id, reason: `signal_insert_failed: ${signalError?.message ?? 'no row'}` };
    }
    const signal: { id: string } = signalData;

    // At-most-once per signal row (lifecycle C4 claim).
    const won = await claimSignal(supabase, signal.id);
    if (!won) {
      return { action: 'skipped', insight_id: match.id, signal_id: signal.id, reason: 'claim_lost' };
    }

    try {
      const updated = await applyLearningSignal(supabase, match, {
        polarity,
        weight,
        signalId: signal.id,
        reason:   `voc ${quote.extractable} quote ${quote.id}`,
      });

      if (updated === null) {
        // Decisive negative refuted the atom — remove it from the local view.
        const idx = ctx.active.findIndex((a) => a.id === match.id);
        if (idx >= 0) ctx.active.splice(idx, 1);
      } else {
        match.confidence     = updated.confidence;
        match.evidence_count = updated.evidence_count;
      }

      if (polarity === 'negative') {
        // Customer reality vs an established belief: surface, don't bury (§3).
        if (priorConfidence >= CONTRADICTION_SURFACE_THRESHOLD) {
          ctx.owner_surfacings.push({
            kind:             'contradiction',
            insight_id:       match.id,
            insight_content:  match.content,
            quote_id:         quote.id,
            quote:            quote.quote,
            prior_confidence: priorConfidence,
          });
        }
        return { action: 'contradicted', insight_id: match.id, signal_id: signal.id };
      }

      // Trigger/identity corroborations also enrich structured evidence.
      let note: string | null = null;
      if (target.enrichField && updated !== null) {
        note = await enrichStructured(supabase, match, target.enrichField, quote.quote);
      }
      return {
        action: 'corroborated',
        insight_id: match.id,
        signal_id: signal.id,
        ...(note ? { reason: note } : {}),
      };
    } catch (e: unknown) {
      // Signal row persisted + claimed; the atom move failed — typed, not thrown.
      console.error(`[voc/reconcile] applyLearningSignal failed for ${match.id}:`, errMessage(e));
      return { action: 'skipped', insight_id: match.id, signal_id: signal.id, reason: `apply_failed: ${errMessage(e)}` };
    }
  }

  // ── no match: create when atom-worthy, otherwise typed skip ─────────────────
  if (ATOM_WORTHY.has(quote.extractable) && target.createKind) {
    try {
      const created = await createInsight(supabase, {
        clientId:    ctx.clientId,
        ownerUserId: ctx.ownerUserId,
        layer:       target.layer,
        kind:        target.createKind,
        // The atom's content IS the customer's verbatim words — quote first,
        // abstraction second (§3). Abstraction can supersede it later.
        content:     quote.quote,
        structured: {
          rationale: `voc ${quote.extractable} quote (verbatim customer language)`,
          voc:       { extractable: quote.extractable, segment_tags: quote.segment_tags },
        },
        source:     'voc',
        sourceRef:  { voc: true, voc_quote_id: quote.id, document_id: quote.document_id },
        confidence: VOC_NEW_ATOM_CONFIDENCE,
      });
      ctx.active.push(created);
      return { action: 'created', insight_id: created.id };
    } catch (e: unknown) {
      console.error('[voc/reconcile] createInsight failed:', errMessage(e));
      return { action: 'skipped', reason: `create_failed: ${errMessage(e)}` };
    }
  }

  return {
    action: 'skipped',
    reason:
      quote.extractable === 'proof'
        ? 'proof without matching atom — kept in quote bank pending owner permission (skill §6.5)'
        : `${quote.extractable} without matching atom — not atom-worthy on its own`,
  };
}
