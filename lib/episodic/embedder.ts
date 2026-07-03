// lib/episodic/embedder.ts
//
// The Embedder seam (contract: lib/capability-contracts). Two implementations:
// GoogleEmbedder (runtime, text-embedding-004 — dims pinned to the 035
// migration's vector(768)) and DeterministicEmbedder (tests / dry-runs, no
// network). Nothing here touches the network or the environment at import
// time — env is read lazily inside embed(), so merely importing this module
// is always safe (build steps, tests, scripts).
import { EMBEDDING_DIMS, type Embedder } from '@/lib/capability-contracts';
import { isNumberArray, isRecord } from './types';

const GOOGLE_MODEL = 'text-embedding-004';
const GOOGLE_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:batchEmbedContents`;

/** The documented batchEmbedContents limit is 100 requests per call. */
const GOOGLE_BATCH_LIMIT = 100;

interface GoogleEmbedRequest {
  model:   string;
  content: { parts: Array<{ text: string }> };
}

/**
 * Validate one batch response: `embeddings` must be an array of exactly
 * `expected` entries, each with a finite-number `values` array of exactly
 * EMBEDDING_DIMS entries. Anything else throws — a silently wrong-dimension
 * vector would corrupt the pgvector index for every future recall.
 */
function parseGoogleEmbeddings(payload: unknown, expected: number): number[][] {
  if (!isRecord(payload) || !Array.isArray(payload.embeddings)) {
    throw new Error('[GoogleEmbedder] malformed response: missing "embeddings" array');
  }
  if (payload.embeddings.length !== expected) {
    throw new Error(
      `[GoogleEmbedder] response count mismatch: sent ${expected} texts, got ${payload.embeddings.length} embeddings`,
    );
  }
  return payload.embeddings.map((entry: unknown, i: number) => {
    if (!isRecord(entry) || !isNumberArray(entry.values)) {
      throw new Error(`[GoogleEmbedder] embedding #${i} has no numeric "values" array`);
    }
    if (entry.values.length !== EMBEDDING_DIMS) {
      throw new Error(
        `[GoogleEmbedder] embedding #${i} has ${entry.values.length} dims, expected ${EMBEDDING_DIMS}`,
      );
    }
    return entry.values;
  });
}

/**
 * Google Generative Language embeddings (text-embedding-004, 768 dims).
 * Reads GOOGLE_AI_API_KEY at CALL time (never at module load). Inputs are
 * chunked to the API's ~100-per-batch limit; output order matches input order.
 * `fetchImpl` is injectable for tests — no live calls in the test suite.
 */
export class GoogleEmbedder implements Embedder {
  readonly id = GOOGLE_MODEL;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('[GoogleEmbedder] GOOGLE_AI_API_KEY is not set — cannot embed');
    }

    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += GOOGLE_BATCH_LIMIT) {
      const chunk = texts.slice(offset, offset + GOOGLE_BATCH_LIMIT);
      const requests: GoogleEmbedRequest[] = chunk.map((text) => ({
        model:   `models/${GOOGLE_MODEL}`,
        content: { parts: [{ text }] },
      }));

      const response = await this.fetchImpl(
        `${GOOGLE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
        {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify({ requests }),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `[GoogleEmbedder] embed failed: HTTP ${response.status} — ${body.slice(0, 200)}`,
        );
      }

      const payload: unknown = await response.json();
      vectors.push(...parseGoogleEmbeddings(payload, chunk.length));
    }
    return vectors;
  }
}

// ── Deterministic embedder (tests / dry-runs) ────────────────────────────────

/** FNV-1a 32-bit hash — the whole text feeds the seed, not just a prefix. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32 PRNG — tiny, seedable, stable across platforms. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic, network-free Embedder for tests and dry-runs: a seeded hash
 * of the FULL text drives a PRNG that fills a unit-norm vector of
 * EMBEDDING_DIMS entries. Stable across runs and platforms; different texts
 * yield different (effectively orthogonal) vectors.
 *
 * LIMITATION (by design): there is NO semantic similarity — texts sharing a
 * long common prefix still hash to unrelated seeds, so their vectors are NOT
 * artificially similar. Only exact-text equality reproduces a vector. Tests
 * that need a specific similarity ORDERING must stub the RPC layer instead.
 */
export class DeterministicEmbedder implements Embedder {
  readonly id = 'deterministic-test';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const rand = mulberry32(fnv1a(text) || 0x9e3779b9);
      const raw = Array.from({ length: EMBEDDING_DIMS }, () => rand() * 2 - 1);
      const norm = Math.sqrt(raw.reduce((sum, x) => sum + x * x, 0));
      if (norm === 0) {
        raw[0] = 1;
        return raw;
      }
      return raw.map((x) => x / norm);
    });
  }
}

/**
 * The production default: GoogleEmbedder when GOOGLE_AI_API_KEY is configured,
 * otherwise a clear config error. Callers wanting the test embedder must ask
 * for it EXPLICITLY (new DeterministicEmbedder()) — a silent fallback would
 * write meaningless vectors into prod.
 */
export function defaultEmbedder(): Embedder {
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error(
      '[episodic] GOOGLE_AI_API_KEY is not configured — set it in the environment, ' +
      'or construct DeterministicEmbedder explicitly for tests/dry-runs',
    );
  }
  return new GoogleEmbedder();
}
