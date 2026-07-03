// Behavior tests for the Embedder seam. DeterministicEmbedder is proven
// stable/unit-norm/distinct; GoogleEmbedder is tested against a mocked fetch
// (request building, chunking, response validation) — NO live API calls.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMS } from '@/lib/capability-contracts';
import { DeterministicEmbedder, GoogleEmbedder, defaultEmbedder } from '../embedder';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DeterministicEmbedder', () => {
  const embedder = new DeterministicEmbedder();

  it('returns exactly EMBEDDING_DIMS finite numbers per text', async () => {
    const [v] = await embedder.embed(['some episode text']);
    expect(v).toHaveLength(EMBEDDING_DIMS);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });

  it('produces unit-norm vectors', async () => {
    const [v] = await embedder.embed(['normalize me']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('is stable across calls and across instances', async () => {
    const [a] = await embedder.embed(['stable text']);
    const [b] = await new DeterministicEmbedder().embed(['stable text']);
    expect(a).toEqual(b);
  });

  it('gives different vectors for different texts', async () => {
    const [a, b] = await embedder.embed(['text one', 'text two']);
    expect(a).not.toEqual(b);
  });

  it('does NOT make similar-prefix texts artificially similar (documented limitation)', async () => {
    const prefix = 'Situation: campaign item underperformed — funnel stage MOFU; ';
    const [a, b] = await embedder.embed([`${prefix}variant A`, `${prefix}variant B`]);
    const cosine = a.reduce((s, x, i) => s + x * b[i], 0);
    // Unrelated seeds → near-orthogonal vectors, NOT high similarity.
    expect(Math.abs(cosine)).toBeLessThan(0.2);
  });

  it('identifies itself for episode metadata', () => {
    expect(embedder.id).toBe('deterministic-test');
  });
});

type FetchCall = { url: string; body: unknown };

/** A canned-response fetch double that records every call. */
function fakeFetch(responder: (call: FetchCall, index: number) => Response) {
  const calls: FetchCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const call = { url, body };
    calls.push(call);
    return responder(call, calls.length - 1);
  };
  return { impl, calls };
}

function googleOk(count: number, dims = EMBEDDING_DIMS): Response {
  return new Response(
    JSON.stringify({
      embeddings: Array.from({ length: count }, (_, i) => ({
        values: Array.from({ length: dims }, (_, j) => (i + j + 1) / dims),
      })),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function requestCount(body: unknown): number {
  if (typeof body === 'object' && body !== null && 'requests' in body) {
    const { requests } = body;
    if (Array.isArray(requests)) return requests.length;
  }
  return -1;
}

describe('GoogleEmbedder (mocked fetch — no live calls)', () => {
  it('builds a batchEmbedContents request with the key and model', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    const { impl, calls } = fakeFetch(({ body }) => googleOk(requestCount(body)));

    const vectors = await new GoogleEmbedder(impl).embed(['אחת', 'two']);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('models/gemini-embedding-001:batchEmbedContents');
    expect(calls[0].url).toContain('key=test-key-123');
    expect(calls[0].body).toMatchObject({
      requests: [
        { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'אחת' }] }, outputDimensionality: EMBEDDING_DIMS },
        { model: 'models/gemini-embedding-001', content: { parts: [{ text: 'two' }] }, outputDimensionality: EMBEDDING_DIMS },
      ],
    });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMS);
  });

  it('chunks inputs to the ~100-per-batch API limit', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    const { impl, calls } = fakeFetch(({ body }) => googleOk(requestCount(body)));

    const texts = Array.from({ length: 150 }, (_, i) => `episode ${i}`);
    const vectors = await new GoogleEmbedder(impl).embed(texts);

    expect(calls).toHaveLength(2);
    expect(requestCount(calls[0].body)).toBe(100);
    expect(requestCount(calls[1].body)).toBe(50);
    expect(vectors).toHaveLength(150);
  });

  it('makes no network call for empty input', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    const { impl, calls } = fakeFetch(() => googleOk(0));
    expect(await new GoogleEmbedder(impl).embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('throws on non-200 with the status and body excerpt', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    const { impl } = fakeFetch(() => new Response('quota exceeded for project', { status: 429 }));
    await expect(new GoogleEmbedder(impl).embed(['x']))
      .rejects.toThrow(/HTTP 429.*quota exceeded/s);
  });

  it('throws when a returned vector has the wrong dimension', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    const { impl } = fakeFetch(({ body }) => googleOk(requestCount(body), 1536));
    await expect(new GoogleEmbedder(impl).embed(['x']))
      .rejects.toThrow(/1536 dims, expected 768/);
  });

  it('throws when the embedding count does not match the input count', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    const { impl } = fakeFetch(() => googleOk(1));
    await expect(new GoogleEmbedder(impl).embed(['a', 'b']))
      .rejects.toThrow(/sent 2 texts, got 1/);
  });

  it('throws a clear error when GOOGLE_AI_API_KEY is missing (read at call time)', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', '');
    const { impl, calls } = fakeFetch(() => googleOk(1));
    await expect(new GoogleEmbedder(impl).embed(['x'])).rejects.toThrow(/GOOGLE_AI_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe('defaultEmbedder', () => {
  it('returns the Google embedder when the key is configured', () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key-123');
    expect(defaultEmbedder().id).toBe('gemini-embedding-001');
  });

  it('throws a config error (never a silent fallback) when the key is absent', () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', '');
    expect(() => defaultEmbedder()).toThrow(/GOOGLE_AI_API_KEY/);
  });
});
