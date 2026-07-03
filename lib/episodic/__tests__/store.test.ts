// Behavior tests for the persistence layer (store.ts). recallSimilar is
// proven on the RIGHT CASE: four stubbed episodes with a known similarity
// ordering must come back in order, with fleet scope surfacing abstracted
// text and every match carrying a rendered precedent summary.
import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMS, type EpisodeMatch } from '@/lib/capability-contracts';
import { DeterministicEmbedder } from '../embedder';
import { precedentSummary, recallSimilar, upsertEpisode, upsertEpisodes, type UpsertEpisodeInput } from '../store';
import { fakePostgrest } from './postgrest-fake';
import { isRecord } from '../types';

const CLIENT_ID = 'c1000000-0000-0000-0000-000000000001';
const embedder = new DeterministicEmbedder();

/** The four stubbed episodes, in the KNOWN similarity order the RPC returns. */
const RPC_ROWS = [
  {
    id: 'e1', source_kind: 'hypothesis', source_id: 's1',
    episode: 'Situation: pre-registered hypothesis (domain: angle).\nAction: ran the test.\nOutcome: supported.\nLesson: supported: emotional-safety angle beats price-led for parents',
    outcome: 'win', insight_ids: ['a12'], metadata: { domain: 'angle' }, similarity: 0.92,
  },
  {
    id: 'e2', source_kind: 'diagnosis', source_id: 's2',
    episode: 'Situation: campaign item underperformed.\nAction: ran link-isolation diagnosis.\nOutcome: failed link = funnel.\nLesson: funnel link broke — landing contradicted the ad angle',
    outcome: 'loss', insight_ids: ['a12', 'a7'], metadata: { failed_link: 'funnel' }, similarity: 0.85,
  },
  {
    id: 'e3', source_kind: 'hypothesis', source_id: 's3',
    episode: 'Situation: pre-registered hypothesis (domain: audience).\nAction: ran the test.\nOutcome: refuted.\nLesson: refuted: lookalike audiences outperform interest stacks here',
    outcome: 'loss', insight_ids: [], metadata: {}, similarity: 0.71,
  },
  {
    id: 'e4', source_kind: 'diagnosis', source_id: 's4',
    episode: 'Situation: campaign item under review.\nAction: ran link-isolation diagnosis.\nOutcome: no failing link found (execution intact).\nLesson: no link failure — the dip tracked a fleet-wide CPM spike',
    outcome: 'inconclusive', insight_ids: [], metadata: {}, similarity: 0.66,
  },
];

describe('recallSimilar — right-case proof', () => {
  it('preserves the RPC similarity ordering and maps every field', async () => {
    const { supabase, requests } = fakePostgrest((req) => {
      if (req.method === 'POST' && req.path === '/rest/v1/rpc/match_episodes') {
        return { json: RPC_ROWS };
      }
      return undefined;
    });

    const result = await recallSimilar(supabase, embedder, {
      clientId: CLIENT_ID,
      contextText: 'MOFU campaign for anxious parents, emotional-safety angle, CVR collapsed',
      k: 4,
    });

    expect(result.scope).toBe('client');
    expect(result.k).toBe(4);
    expect(result.matches.map((m) => m.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(result.matches.map((m) => m.similarity)).toEqual([0.92, 0.85, 0.71, 0.66]);
    expect(result.matches[1]).toMatchObject({
      source_kind: 'diagnosis',
      outcome:     'loss',
      insight_ids: ['a12', 'a7'],
      metadata:    { failed_link: 'funnel' },
    });

    // The RPC was invoked with the embedded context and the requested k/scope.
    expect(requests).toHaveLength(1);
    const rpcBody = requests[0].body;
    if (!isRecord(rpcBody)) throw new Error('rpc body not captured');
    expect(rpcBody.p_client_id).toBe(CLIENT_ID);
    expect(rpcBody.p_scope).toBe('client');
    expect(rpcBody.p_k).toBe(4);
    expect(Array.isArray(rpcBody.p_query) && rpcBody.p_query.length === EMBEDDING_DIMS).toBe(true);
  });

  it('respects k (passes it through and returns what the RPC limited to)', async () => {
    const { supabase, requests } = fakePostgrest((req) => {
      if (req.path !== '/rest/v1/rpc/match_episodes') return undefined;
      const body = req.body;
      const k = isRecord(body) && typeof body.p_k === 'number' ? body.p_k : 0;
      return { json: RPC_ROWS.slice(0, k) };
    });

    const result = await recallSimilar(supabase, embedder, {
      clientId: CLIENT_ID, contextText: 'context', k: 2,
    });

    expect(result.matches).toHaveLength(2);
    const body = requests[0].body;
    expect(isRecord(body) && body.p_k).toBe(2);
  });

  it('defaults to scope=client, k=5', async () => {
    const { supabase, requests } = fakePostgrest(() => ({ json: [] }));
    const result = await recallSimilar(supabase, embedder, { clientId: CLIENT_ID, contextText: 'context' });
    expect(result).toEqual({ scope: 'client', k: 5, matches: [] });
    const body = requests[0].body;
    expect(isRecord(body) && body.p_scope).toBe('client');
    expect(isRecord(body) && body.p_k).toBe(5);
  });

  it('fleet scope: passes p_scope=fleet and surfaces the abstracted episode text', async () => {
    const fleetRow = {
      ...RPC_ROWS[1],
      episode: 'Situation: campaign item underperformed.\nLesson: funnel link broke — {business} landing contradicted the ad angle for {business} parents.',
    };
    const { supabase, requests } = fakePostgrest((req) =>
      req.path === '/rest/v1/rpc/match_episodes' ? { json: [fleetRow] } : undefined,
    );

    const result = await recallSimilar(supabase, embedder, {
      clientId: CLIENT_ID, contextText: 'context', scope: 'fleet', k: 1,
    });

    const body = requests[0].body;
    expect(isRecord(body) && body.p_scope).toBe('fleet');
    expect(result.matches[0].episode).toContain('{business}');
    expect(result.matches[0].episode).not.toContain('ד"ר כהן');
  });

  it('renders a one-line precedent summary per match, ready for prompt injection', async () => {
    const { supabase } = fakePostgrest(() => ({ json: RPC_ROWS }));
    const { matches } = await recallSimilar(supabase, embedder, {
      clientId: CLIENT_ID, contextText: 'context', k: 4,
    });

    expect(matches[0].precedent_summary)
      .toBe('[win] hypothesis: emotional-safety angle beats price-led for parents → supported');
    expect(matches[1].precedent_summary)
      .toBe('[loss] diagnosis: funnel link broke — landing contradicted the ad angle');
    expect(matches[2].precedent_summary)
      .toBe('[loss] hypothesis: lookalike audiences outperform interest stacks here → refuted');
    for (const m of matches) expect(m.precedent_summary).not.toContain('\n');
  });

  it('throws on an RPC error (no silent empty result)', async () => {
    const { supabase } = fakePostgrest(() => ({ status: 400, json: { message: 'function match_episodes does not exist' } }));
    await expect(
      recallSimilar(supabase, embedder, { clientId: CLIENT_ID, contextText: 'context' }),
    ).rejects.toThrow(/match_episodes.*does not exist/);
  });

  it('throws on a malformed RPC row instead of surfacing a broken match', async () => {
    const { supabase } = fakePostgrest(() => ({ json: [{ id: 'e1', similarity: 'not-a-number' }] }));
    await expect(
      recallSimilar(supabase, embedder, { clientId: CLIENT_ID, contextText: 'context' }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it('rejects an empty context text before embedding anything', async () => {
    const { supabase, requests } = fakePostgrest(() => ({ json: [] }));
    await expect(
      recallSimilar(supabase, embedder, { clientId: CLIENT_ID, contextText: '   ' }),
    ).rejects.toThrow(/contextText is empty/);
    expect(requests).toHaveLength(0);
  });
});

describe('precedentSummary', () => {
  it('falls back to the first line when the episode has no Lesson line', () => {
    const match: EpisodeMatch = {
      id: 'e9', source_kind: 'artifact', source_id: 's9',
      episode: 'A free-form legacy episode without the canonical shape.\nMore detail here.',
      outcome: 'mixed', insight_ids: [], metadata: {}, similarity: 0.5,
    };
    expect(precedentSummary(match))
      .toBe('[mixed] artifact: A free-form legacy episode without the canonical shape.');
  });
});

const upsertInput = (patch: Partial<UpsertEpisodeInput> = {}): UpsertEpisodeInput => ({
  clientId:       CLIENT_ID,
  ownerUserId:    'u1000000-0000-0000-0000-000000000001',
  sourceKind:     'diagnosis',
  sourceId:       'd1000000-0000-0000-0000-000000000001',
  episodeText:    'Situation: …\nLesson: funnel link broke — scent break.',
  abstractedText: null,
  outcome:        'loss',
  insightIds:     ['a12'],
  metadata:       { embedder: 'deterministic-test', dims: EMBEDDING_DIMS },
  embedding:      Array.from({ length: EMBEDDING_DIMS }, () => 0.01),
  ...patch,
});

describe('upsertEpisode(s)', () => {
  it('upserts idempotently on (source_kind, source_id) and returns the id', async () => {
    const { supabase, requests } = fakePostgrest((req) => {
      if (req.method === 'POST' && req.path === '/rest/v1/episode_embeddings') {
        return { status: 201, json: [{ id: 'ep-1' }] };
      }
      return undefined;
    });

    const id = await upsertEpisode(supabase, upsertInput());
    expect(id).toBe('ep-1');

    // The conflict target is the 035 unique index — this is what makes
    // re-ingestion overwrite instead of duplicate.
    expect(requests[0].query.get('on_conflict')).toBe('source_kind,source_id');
    expect(requests[0].headers.prefer).toContain('resolution=merge-duplicates');

    const body = requests[0].body;
    if (!Array.isArray(body) || !isRecord(body[0])) throw new Error('upsert body not captured');
    expect(body[0]).toMatchObject({
      client_id:   CLIENT_ID,
      source_kind: 'diagnosis',
      outcome:     'loss',
      insight_ids: ['a12'],
      metadata:    { embedder: 'deterministic-test', dims: EMBEDDING_DIMS },
    });
    expect(Array.isArray(body[0].embedding) && body[0].embedding.length === EMBEDDING_DIMS).toBe(true);
  });

  it('refuses a wrong-dimension embedding BEFORE touching the DB', async () => {
    const { supabase, requests } = fakePostgrest(() => ({ json: [] }));
    await expect(
      upsertEpisode(supabase, upsertInput({ embedding: [0.1, 0.2] })),
    ).rejects.toThrow(/2 dims.*expected 768/);
    expect(requests).toHaveLength(0);
  });

  it('propagates upsert errors', async () => {
    const { supabase } = fakePostgrest(() => ({ status: 400, json: { message: 'permission denied' } }));
    await expect(upsertEpisodes(supabase, [upsertInput()])).rejects.toThrow(/permission denied/);
  });

  it('is a no-op (zero round-trips) for an empty batch', async () => {
    const { supabase, requests } = fakePostgrest(() => ({ json: [] }));
    expect(await upsertEpisodes(supabase, [])).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
