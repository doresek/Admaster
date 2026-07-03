// lib/voc/ingest.ts
//
// The C-08 pipeline: one source document in → typed verbatim quotes → atom
// actions out, with the status flow the 036 schema enforces:
//
//   hash → dedupe → voc_documents('ingested') → PII-strip → LLM extract →
//   voc_quotes batch insert → 'extracted' → reconcile (lifecycle) → 'reconciled'
//
// Failure discipline: ANY stage failure persists status 'failed' + the error
// on the document and returns a TYPED result (never throws), while everything
// earlier stages stored is kept — a failed reconcile keeps its quotes, so the
// run is resumable/debuggable instead of vaporized.
//
// PII ordering: the text is stripped BEFORE the LLM call, so phones/emails/
// URLs/names never reach the model and every stored quote (a span of the
// stripped text) is clean by construction (voc-mining §4).

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VocDocumentRow } from '@/lib/capability-contracts';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { extractQuotes, type LlmComplete } from './extract';
import { stripPii } from './pii';
import { reconcileQuotes } from './reconcile';
import type { IngestInput, IngestResult, IngestStage, ReconcileQuoteInput } from './types';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Normalize before hashing so trivial paste differences don't defeat dedupe. */
const normalizeForHash = (text: string): string =>
  text.replace(/\r\n/g, '\n').replace(/\s+$/gm, '').trim();

export const hashRawText = (text: string): string =>
  createHash('sha256').update(normalizeForHash(text), 'utf8').digest('hex');

const DOC_COLUMNS = 'id, client_id, owner_user_id, source, source_meta, raw_text, raw_hash, quote_count, status, error, created_at, updated_at';

const isUniqueViolation = (error: { code?: string; message: string }): boolean =>
  error.code === '23505' || /duplicate key|unique constraint|unique violation/i.test(error.message);

/** Persist a stage failure on the document; best-effort (the typed result wins). */
async function markFailed(
  supabase:   SupabaseClient,
  documentId: string,
  stage:      IngestStage,
  message:    string,
): Promise<void> {
  const { error } = await supabase
    .from('voc_documents')
    .update({
      status:     'failed',
      error:      `${stage}: ${message}`.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId);
  if (error) console.error(`[voc/ingest] failed to persist failure on ${documentId}:`, error.message);
}

/**
 * Ingest one VoC document end-to-end. Idempotent on content: re-pasting the
 * same text (same client) returns the existing document instead of
 * re-extracting — the unique (client_id, raw_hash) is the gate, with a
 * select-first fast path and a 23505 fallback for the insert race.
 */
export async function ingestDocument(
  supabase: SupabaseClient,
  llm:      LlmComplete,
  input:    IngestInput,
): Promise<IngestResult> {
  const rawHash = hashRawText(input.rawText);

  // ── dedupe (fast path) ──────────────────────────────────────────────────────
  const { data: existing, error: dedupeError } = await supabase
    .from('voc_documents')
    .select(DOC_COLUMNS)
    .eq('client_id', input.clientId)
    .eq('raw_hash', rawHash)
    .maybeSingle()
    .overrideTypes<VocDocumentRow, { merge: false }>();
  if (dedupeError) {
    return { ok: false, document_id: null, status: 'failed', stage: 'insert_document', error: dedupeError.message };
  }
  if (existing) {
    return { ok: true, deduped: true, document_id: existing.id, status: existing.status, quote_count: existing.quote_count };
  }

  // ── insert the document (status 'ingested') ─────────────────────────────────
  const { data: docData, error: insertError } = await supabase
    .from('voc_documents')
    .insert({
      client_id:     input.clientId,
      owner_user_id: input.ownerUserId,
      source:        input.source,
      source_meta:   input.sourceMeta ?? {},
      raw_text:      input.rawText,
      raw_hash:      rawHash,
      status:        'ingested',
    })
    .select(DOC_COLUMNS)
    .single()
    .overrideTypes<VocDocumentRow, { merge: false }>();

  if (insertError || !docData) {
    // Race with a concurrent ingest of the same content → idempotent return.
    if (insertError && isUniqueViolation(insertError)) {
      const { data: raced } = await supabase
        .from('voc_documents')
        .select(DOC_COLUMNS)
        .eq('client_id', input.clientId)
        .eq('raw_hash', rawHash)
        .maybeSingle()
        .overrideTypes<VocDocumentRow, { merge: false }>();
      if (raced) {
        return { ok: true, deduped: true, document_id: raced.id, status: raced.status, quote_count: raced.quote_count };
      }
    }
    return {
      ok: false, document_id: null, status: 'failed', stage: 'insert_document',
      error: insertError?.message ?? 'insert returned no row',
    };
  }
  const doc = docData;

  // ── PII-strip, then extract (the model never sees the PII) ──────────────────
  const strippedText = stripPii(input.rawText, { names: input.piiNames });

  let extraction;
  try {
    const existingAtoms = await listActiveInsights(supabase, input.clientId);
    extraction = await extractQuotes(strippedText, input.source, existingAtoms, llm);
  } catch (e: unknown) {
    const msg = errMessage(e);
    await markFailed(supabase, doc.id, 'extract', msg);
    return { ok: false, document_id: doc.id, status: 'failed', stage: 'extract', error: msg };
  }
  if (!extraction.ok) {
    await markFailed(supabase, doc.id, 'extract', extraction.error);
    return { ok: false, document_id: doc.id, status: 'failed', stage: 'extract', error: extraction.error };
  }

  // A valid extraction with zero usable quotes is a legitimate (empty) run.
  if (extraction.quotes.length === 0) {
    const { error } = await supabase
      .from('voc_documents')
      .update({ status: 'reconciled', quote_count: 0, updated_at: new Date().toISOString() })
      .eq('id', doc.id);
    if (error) console.error('[voc/ingest] empty-run status update failed:', error.message);
    return {
      ok: true, deduped: false, document_id: doc.id, status: 'reconciled', quote_count: 0,
      atom_actions_summary: { corroborated: 0, created: 0, contradicted: 0, skipped: 0 },
      owner_surfacings: [], dropped: extraction.dropped, fabricated_rejected: extraction.fabricated,
    };
  }

  // ── store quotes: ONE batch insert, rows returned in input order ────────────
  const { data: quoteRows, error: quotesError } = await supabase
    .from('voc_quotes')
    .insert(
      extraction.quotes.map((q) => ({
        document_id:   doc.id,
        client_id:     input.clientId,
        owner_user_id: input.ownerUserId,
        quote:         q.quote,
        extractable:   q.extractable,
        polarity:      q.polarity,
        segment_tags:  q.segment_tags,
        funnel_fit:    q.funnel_fit,
      })),
    )
    .select('id')
    .overrideTypes<Array<{ id: string }>, { merge: false }>();

  if (quotesError || !quoteRows || quoteRows.length !== extraction.quotes.length) {
    const msg = quotesError?.message ?? `expected ${extraction.quotes.length} inserted quotes, got ${quoteRows?.length ?? 0}`;
    await markFailed(supabase, doc.id, 'store_quotes', msg);
    return { ok: false, document_id: doc.id, status: 'failed', stage: 'store_quotes', error: msg };
  }

  const { error: extractedError } = await supabase
    .from('voc_documents')
    .update({ status: 'extracted', quote_count: quoteRows.length, updated_at: new Date().toISOString() })
    .eq('id', doc.id);
  if (extractedError) console.error('[voc/ingest] extracted status update failed:', extractedError.message);

  // ── reconcile through the lifecycle ─────────────────────────────────────────
  const reconcileInput: ReconcileQuoteInput[] = extraction.quotes.map((q, i) => ({
    id:          quoteRows[i].id,
    document_id: doc.id,
    quote:       q.quote,
    extractable: q.extractable,
    polarity:    q.polarity,
    segment_tags: q.segment_tags,
    ...(q.target_hint !== undefined ? { target_hint: q.target_hint } : {}),
  }));

  let reconciled;
  try {
    reconciled = await reconcileQuotes(supabase, {
      clientId:    input.clientId,
      ownerUserId: input.ownerUserId,
      quotes:      reconcileInput,
    });
  } catch (e: unknown) {
    // The quotes are durable ('extracted'); only the atom pass failed.
    const msg = errMessage(e);
    await markFailed(supabase, doc.id, 'reconcile', msg);
    return { ok: false, document_id: doc.id, status: 'failed', stage: 'reconcile', error: msg };
  }

  const { error: doneError } = await supabase
    .from('voc_documents')
    .update({ status: 'reconciled', updated_at: new Date().toISOString() })
    .eq('id', doc.id);
  if (doneError) console.error('[voc/ingest] reconciled status update failed:', doneError.message);

  return {
    ok: true,
    deduped: false,
    document_id: doc.id,
    status: 'reconciled',
    quote_count: quoteRows.length,
    atom_actions_summary: reconciled.summary,
    owner_surfacings: reconciled.owner_surfacings,
    dropped: extraction.dropped,
    fabricated_rejected: extraction.fabricated,
  };
}
