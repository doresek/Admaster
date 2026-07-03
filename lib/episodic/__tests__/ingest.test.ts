// Behavior tests for ingestForClient: ONE batched embed call for N episodes
// (the N+1 trap), incremental skip of already-ingested sources, the upsert
// payload shape (metadata stamped with embedder id + dims, abstracted text
// fleet-safe), malformed-row skipping that is loud but non-fatal, and hard
// propagation of infrastructure errors.
import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMS, type Embedder } from '@/lib/capability-contracts';
import { DeterministicEmbedder } from '../embedder';
import { ingestForClient } from '../ingest';
import { isRecord } from '../types';
import { fakePostgrest, type CapturedRequest, type RouteResult } from './postgrest-fake';

const CLIENT_ID = 'c1000000-0000-0000-0000-000000000001';
const OWNER_ID  = 'u1000000-0000-0000-0000-000000000001';
const CLIENT_NAME = 'מרפאת שיניים ד"ר כהן';

const HYP_SUPPORTED_ID = 'h1000000-0000-0000-0000-000000000001';
const HYP_REFUTED_ID   = 'h1000000-0000-0000-0000-000000000002';
const DIAG_NEW_ID      = 'd1000000-0000-0000-0000-000000000001';
const DIAG_EXISTING_ID = 'd1000000-0000-0000-0000-000000000002';

const hypothesis = (id: string, status: 'supported' | 'refuted') => ({
  id,
  client_id:     CLIENT_ID,
  owner_user_id: OWNER_ID,
  claim:         `emotional-safety angle beats price-led (${status} run)`,
  prediction: {
    metric: 'ctr', comparator: 'ratio_gte', value: 1.3,
    arm: 'arm-emotional', baseline_arm: 'arm-price', confidence: 0.7,
  },
  domain: 'angle',
  status,
  resolution: {
    observed:       { 'arm-emotional': { ctr: 0.024 } },
    verdict_reason: 'floor met',
    resolved_by:    'floor_met',
  },
  insight_ids: ['a1000000-0000-0000-0000-000000000012'],
  resolved_at: '2026-06-10T00:00:00Z',
});

const diagnosis = (id: string, rationale: string) => ({
  id,
  client_id:          CLIENT_ID,
  owner_user_id:      OWNER_ID,
  scope_artifact_id:  null,
  scope_campaign_id:  null,
  scope_item_id:      null,
  failed_link:        'funnel',
  rationale,
  evidence:           { funnel_stage: 'MOFU', metrics: { ctr: 0.021, cvr: 0.0095 } },
  target_insight_ids: ['a1000000-0000-0000-0000-000000000007'],
  recommended_action: { action: 'swap_landing_headline' },
  applied:            false,
  applied_item_id:    null,
  created_at:         '2026-06-01T00:00:00Z',
});

const DIAG_RATIONALE =
  `דף הנחיתה של ${CLIENT_NAME} מכר הנחה בעוד המודעה מכרה ביטחון רגשי — שבירת ריח בין המודעה לדף הנחיתה`;

interface Fixtures {
  existing?:   Array<{ source_kind: string; source_id: string }>;
  clients?:    unknown[];
  hypotheses?: unknown[] | { status: number; message: string };
  diagnoses?:  unknown[];
}

/** Standard route table; individual tests override fixtures. */
function routes(fixtures: Fixtures = {}) {
  const upserted: unknown[] = [];
  const route = (req: CapturedRequest): RouteResult | undefined => {
    if (req.path === '/rest/v1/episode_embeddings' && req.method === 'GET') {
      return { json: fixtures.existing ?? [{ source_kind: 'diagnosis', source_id: DIAG_EXISTING_ID }] };
    }
    if (req.path === '/rest/v1/clients') {
      return { json: fixtures.clients ?? [{ id: CLIENT_ID, name: CLIENT_NAME, company: null }] };
    }
    if (req.path === '/rest/v1/hypotheses') {
      const fixture = fixtures.hypotheses;
      if (fixture && !Array.isArray(fixture)) {
        return { status: fixture.status, json: { message: fixture.message } };
      }
      return { json: fixture ?? [hypothesis(HYP_SUPPORTED_ID, 'supported'), hypothesis(HYP_REFUTED_ID, 'refuted')] };
    }
    if (req.path === '/rest/v1/diagnoses') {
      return { json: fixtures.diagnoses ?? [diagnosis(DIAG_NEW_ID, DIAG_RATIONALE), diagnosis(DIAG_EXISTING_ID, DIAG_RATIONALE)] };
    }
    if (req.path === '/rest/v1/episode_embeddings' && req.method === 'POST') {
      const body = req.body;
      if (Array.isArray(body)) upserted.push(...body);
      return { status: 201, json: Array.isArray(body) ? body.map((_, i) => ({ id: `ep-${i}` })) : [] };
    }
    return undefined;
  };
  return { route, upserted };
}

/** An embedder double that records batch boundaries. */
class CountingEmbedder implements Embedder {
  readonly id = 'deterministic-test';
  readonly calls: string[][] = [];
  private readonly inner = new DeterministicEmbedder();

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return this.inner.embed(texts);
  }
}

describe('ingestForClient', () => {
  it('composes new sources, embeds them in ONE batched call, and bulk-upserts', async () => {
    const { route, upserted } = routes();
    const { supabase, requests } = fakePostgrest(route);
    const embedder = new CountingEmbedder();

    const counts = await ingestForClient(supabase, embedder, CLIENT_ID, OWNER_ID);

    // 2 resolved hypotheses + 1 new diagnosis; the other diagnosis pre-exists.
    expect(counts).toEqual({
      composed: 3, embedded: 3, upserted: 3, skippedExisting: 1, skippedMalformed: 0,
    });

    // THE batching proof: one embedder call carrying all three texts.
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]).toHaveLength(3);

    // And exactly one write round-trip.
    const posts = requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/episode_embeddings');
    expect(posts).toHaveLength(1);
    expect(upserted).toHaveLength(3);
  });

  it('stamps every upserted row with owner/client scope, embedder id + dims, and a 768-dim vector', async () => {
    const { route, upserted } = routes();
    const { supabase } = fakePostgrest(route);

    await ingestForClient(supabase, new CountingEmbedder(), CLIENT_ID, OWNER_ID);

    for (const row of upserted) {
      if (!isRecord(row) || !isRecord(row.metadata)) throw new Error('upsert row not captured');
      expect(row.client_id).toBe(CLIENT_ID);
      expect(row.owner_user_id).toBe(OWNER_ID);
      expect(row.metadata.embedder).toBe('deterministic-test');
      expect(row.metadata.dims).toBe(EMBEDDING_DIMS);
      expect(Array.isArray(row.embedding) && row.embedding.length === EMBEDDING_DIMS).toBe(true);
      expect(typeof row.episode_text === 'string' && row.episode_text.includes('Lesson:')).toBe(true);
    }
  });

  it('abstracts the client name out of abstracted_text (fleet safety)', async () => {
    const { route, upserted } = routes();
    const { supabase } = fakePostgrest(route);

    await ingestForClient(supabase, new CountingEmbedder(), CLIENT_ID, OWNER_ID);

    const diagRow = upserted.find((row) => isRecord(row) && row.source_id === DIAG_NEW_ID);
    if (!isRecord(diagRow)) throw new Error('diagnosis row not upserted');
    // Verbatim text keeps the name (client-scope recall)…
    expect(diagRow.episode_text).toContain('כהן');
    // …the abstraction never does (fleet-scope recall).
    expect(typeof diagRow.abstracted_text).toBe('string');
    expect(diagRow.abstracted_text).not.toContain('כהן');
    expect(diagRow.abstracted_text).toContain('{business}');
  });

  it('queries sources with explicit client/owner scoping and resolved-status filter', async () => {
    const { route } = routes();
    const { supabase, requests } = fakePostgrest(route);

    await ingestForClient(supabase, new CountingEmbedder(), CLIENT_ID, OWNER_ID);

    const hypReq = requests.find((r) => r.path === '/rest/v1/hypotheses');
    if (!hypReq) throw new Error('hypotheses never queried');
    expect(hypReq.query.get('client_id')).toBe(`eq.${CLIENT_ID}`);
    expect(hypReq.query.get('owner_user_id')).toBe(`eq.${OWNER_ID}`);
    expect(hypReq.query.get('status')).toContain('in.');
    expect(hypReq.query.get('status')).toContain('supported');
    expect(hypReq.query.get('status')).not.toContain('open');

    const diagReq = requests.find((r) => r.path === '/rest/v1/diagnoses');
    if (!diagReq) throw new Error('diagnoses never queried');
    expect(diagReq.query.get('client_id')).toBe(`eq.${CLIENT_ID}`);
    expect(diagReq.query.get('owner_user_id')).toBe(`eq.${OWNER_ID}`);
  });

  it('is incremental: fully-ingested clients cause zero embeds and zero writes', async () => {
    const { route } = routes({
      existing: [
        { source_kind: 'hypothesis', source_id: HYP_SUPPORTED_ID },
        { source_kind: 'hypothesis', source_id: HYP_REFUTED_ID },
        { source_kind: 'diagnosis',  source_id: DIAG_NEW_ID },
        { source_kind: 'diagnosis',  source_id: DIAG_EXISTING_ID },
      ],
    });
    const { supabase, requests } = fakePostgrest(route);
    const embedder = new CountingEmbedder();

    const counts = await ingestForClient(supabase, embedder, CLIENT_ID, OWNER_ID);

    expect(counts).toEqual({
      composed: 0, embedded: 0, upserted: 0, skippedExisting: 4, skippedMalformed: 0,
    });
    expect(embedder.calls).toHaveLength(0);
    expect(requests.some((r) => r.method === 'POST' && r.path === '/rest/v1/episode_embeddings')).toBe(false);
  });

  it('skips malformed source rows loudly (warn + counter) without aborting the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { route, upserted } = routes({
        diagnoses: [
          diagnosis(DIAG_NEW_ID, DIAG_RATIONALE),
          diagnosis('d1000000-0000-0000-0000-000000000003', '   '), // empty rationale → composition rejects
          { id: 'garbage', nope: true },                            // shape rejects
        ],
      });
      const { supabase } = fakePostgrest(route);

      const counts = await ingestForClient(supabase, new CountingEmbedder(), CLIENT_ID, OWNER_ID);

      expect(counts.skippedMalformed).toBe(2);
      expect(counts.composed).toBe(3); // 2 hypotheses + 1 good diagnosis
      expect(counts.upserted).toBe(3);
      expect(upserted).toHaveLength(3);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('propagates a source-query failure instead of silently ingesting nothing', async () => {
    const { route } = routes({ hypotheses: { status: 500, message: 'db down' } });
    const { supabase, requests } = fakePostgrest(route);
    const embedder = new CountingEmbedder();

    await expect(ingestForClient(supabase, embedder, CLIENT_ID, OWNER_ID))
      .rejects.toThrow(/hypotheses query failed.*db down/);
    expect(embedder.calls).toHaveLength(0);
    expect(requests.some((r) => r.method === 'POST' && r.path === '/rest/v1/episode_embeddings')).toBe(false);
  });

  it('propagates an embedder count mismatch (corrupt batch must never be written)', async () => {
    const badEmbedder: Embedder = {
      id: 'broken',
      embed: async () => [],
    };
    const { route } = routes();
    const { supabase, requests } = fakePostgrest(route);

    await expect(ingestForClient(supabase, badEmbedder, CLIENT_ID, OWNER_ID))
      .rejects.toThrow(/returned 0 vectors for 3 texts/);
    expect(requests.some((r) => r.method === 'POST' && r.path === '/rest/v1/episode_embeddings')).toBe(false);
  });
});
