// lib/voc/ingest — the full pipeline over the in-memory supabase + MockLlm:
// status flow, content-hash idempotency, ONE batch insert for quotes, PII
// never reaching the model, and per-stage failure persistence with earlier
// stages' data preserved (resumability).

import { describe, expect, it } from 'vitest';
import { hashRawText, ingestDocument } from '../ingest';
import { stripPii } from '../pii';
import type { IngestInput } from '../types';
import {
  DENTAL_EXTRACTION_JSON,
  EMPTY_EXTRACTION_JSON,
  FABRICATED_EXTRACTION_JSON,
  GOOGLE_REVIEWS_DENTAL,
  MockLlm,
  ThrowingLlm,
} from './fixtures';
import { mockSupabase, type MockRow } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';

function makeInput(overrides: Partial<IngestInput> = {}): IngestInput {
  return {
    clientId: CLIENT,
    ownerUserId: OWNER,
    source: 'own_reviews',
    sourceMeta: { platform: 'google' },
    rawText: GOOGLE_REVIEWS_DENTAL,
    piiNames: ['ד"ר לוי'],
    ...overrides,
  };
}

function harness(atoms: MockRow[] = []) {
  const sb = mockSupabase();
  sb.seed('voc_documents', []);
  sb.seed('voc_quotes', []);
  sb.seed('client_insights', atoms);
  sb.seed('learning_signals', []);
  sb.seed('insight_events', []);
  return sb;
}

const objectionAtom: MockRow = {
  id: 'atom-objection', client_id: CLIENT, owner_user_id: OWNER,
  layer: 'customers', kind: 'objection', content: 'פחד שהטיפול יכאב',
  structured: null, source: 'brief', source_ref: null,
  confidence: 0.5, evidence_count: 1, status: 'active',
  superseded_by: null, superseded_reason: null,
  first_seen_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

describe('ingestDocument — happy path', () => {
  it('flows ingested → extracted → reconciled with a full atom-action summary', async () => {
    const sb = harness([objectionAtom]);
    const llm = new MockLlm(DENTAL_EXTRACTION_JSON);

    const result = await ingestDocument(sb.client, llm, makeInput());

    if (!result.ok || result.deduped) throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.status).toBe('reconciled');
    expect(result.quote_count).toBe(4);
    expect(result.fabricated_rejected).toBe(0);
    // objection→corroborated (target_hint onto the seeded atom); pain +
    // alternative→created; proof with no business atom→skipped.
    expect(result.atom_actions_summary).toEqual({ corroborated: 1, created: 2, contradicted: 0, skipped: 1 });

    const doc = sb.rows('voc_documents')[0];
    // Dedup hash is still computed over the ORIGINAL (idempotency unchanged)…
    expect(doc).toMatchObject({ status: 'reconciled', quote_count: 4, raw_hash: hashRawText(GOOGLE_REVIEWS_DENTAL) });
    // …but the AT-REST raw_text is the STRIPPED copy — no PII persists (PII-1).
    expect(doc.raw_text).toBe(stripPii(GOOGLE_REVIEWS_DENTAL, { names: ['ד"ר לוי'] }));
    expect(doc.raw_text).not.toContain('050-1234567');
    expect(doc.raw_text).not.toBe(GOOGLE_REVIEWS_DENTAL);
    expect(String(doc.raw_text)).toContain('{phone}');

    // Every stored quote is stamped with its outcome.
    const quotes = sb.rows('voc_quotes');
    expect(quotes).toHaveLength(4);
    for (const q of quotes) expect(q.atom_action).toBeTruthy();
  });

  it('batch-inserts the quotes in ONE call, not N', async () => {
    const sb = harness();
    await ingestDocument(sb.client, new MockLlm(DENTAL_EXTRACTION_JSON), makeInput());

    const quoteInserts = sb.log.filter((l) => l.startsWith('insert:voc_quotes'));
    expect(quoteInserts).toEqual(['insert:voc_quotes(4)']);
  });

  it('strips PII BEFORE the LLM call — the model never sees phones or supplied names', async () => {
    const sb = harness();
    const llm = new MockLlm(DENTAL_EXTRACTION_JSON);
    await ingestDocument(sb.client, llm, makeInput());

    expect(llm.prompts).toHaveLength(1);
    expect(llm.prompts[0]).not.toContain('050-1234567');
    expect(llm.prompts[0]).toContain('{phone}');
    expect(llm.prompts[0]).toContain('{name}'); // ד"ר לוי from piiNames
  });

  it('counts fabricated quotes rejected by the gate and stores only real ones', async () => {
    const sb = harness();
    const result = await ingestDocument(sb.client, new MockLlm(FABRICATED_EXTRACTION_JSON), makeInput());

    if (!result.ok || result.deduped) throw new Error('unexpected');
    expect(result.fabricated_rejected).toBe(1);
    expect(result.quote_count).toBe(1);
    expect(sb.rows('voc_quotes')).toHaveLength(1);
  });

  it('a valid-but-empty extraction reconciles with zero quotes', async () => {
    const sb = harness();
    const result = await ingestDocument(sb.client, new MockLlm(EMPTY_EXTRACTION_JSON), makeInput());

    if (!result.ok || result.deduped) throw new Error('unexpected');
    expect(result.quote_count).toBe(0);
    expect(result.status).toBe('reconciled');
    expect(sb.rows('voc_documents')[0].status).toBe('reconciled');
    expect(sb.log.some((l) => l.startsWith('insert:voc_quotes'))).toBe(false);
  });
});

describe('ingestDocument — idempotency (content hash)', () => {
  it('re-ingesting identical content returns the existing document with no new work', async () => {
    const sb = harness();
    const first = await ingestDocument(sb.client, new MockLlm(DENTAL_EXTRACTION_JSON), makeInput());
    if (!first.ok) throw new Error('first ingest failed');

    const llm2 = new MockLlm(DENTAL_EXTRACTION_JSON);
    const second = await ingestDocument(sb.client, llm2, makeInput());

    if (!second.ok || !second.deduped) throw new Error(`expected dedupe: ${JSON.stringify(second)}`);
    expect(second.document_id).toBe(first.document_id);
    expect(second.quote_count).toBe(4);
    expect(llm2.prompts).toHaveLength(0); // no second extraction
    expect(sb.rows('voc_documents')).toHaveLength(1);
  });

  it('whitespace-only paste differences hash identically', () => {
    expect(hashRawText('שלום  \r\nעולם  ')).toBe(hashRawText('שלום\nעולם'));
  });
});

describe('ingestDocument — stage failures (typed, persisted, resumable)', () => {
  it('document insert failure → typed failure, no document', async () => {
    const sb = harness();
    sb.failOn.add('insert:voc_documents');

    const result = await ingestDocument(sb.client, new MockLlm(DENTAL_EXTRACTION_JSON), makeInput());
    expect(result).toMatchObject({ ok: false, stage: 'insert_document', document_id: null });
  });

  it('unparseable model output → failed + error persisted, document KEPT', async () => {
    const sb = harness();
    const result = await ingestDocument(sb.client, new MockLlm('אני לא JSON'), makeInput());

    expect(result).toMatchObject({ ok: false, stage: 'extract', status: 'failed' });
    const doc = sb.rows('voc_documents')[0];
    expect(doc.status).toBe('failed');
    expect(String(doc.error)).toContain('extract:');
  });

  it('llm throw (network) → failed + error persisted', async () => {
    const sb = harness();
    const result = await ingestDocument(sb.client, new ThrowingLlm(), makeInput());

    expect(result).toMatchObject({ ok: false, stage: 'extract', error: 'llm unavailable' });
    expect(sb.rows('voc_documents')[0].status).toBe('failed');
  });

  it('quotes insert failure → failed at store_quotes, document kept', async () => {
    const sb = harness();
    sb.failOn.add('insert:voc_quotes');

    const result = await ingestDocument(sb.client, new MockLlm(DENTAL_EXTRACTION_JSON), makeInput());
    expect(result).toMatchObject({ ok: false, stage: 'store_quotes' });
    expect(sb.rows('voc_documents')[0].status).toBe('failed');
  });

  it('reconcile failure → failed, but the extracted QUOTES are preserved (resumable)', async () => {
    const sb = harness();
    sb.failOn.add('select:voc_quotes'); // fetchPriorQuotes blows up inside reconcile

    const result = await ingestDocument(sb.client, new MockLlm(DENTAL_EXTRACTION_JSON), makeInput());
    expect(result).toMatchObject({ ok: false, stage: 'reconcile' });

    const doc = sb.rows('voc_documents')[0];
    expect(doc.status).toBe('failed');
    expect(doc.quote_count).toBe(4);          // 'extracted' progress persisted
    expect(sb.rows('voc_quotes')).toHaveLength(4); // quotes survive the failure
    expect(String(doc.error)).toContain('reconcile:');
  });
});
