// lib/episodic/store.ts
//
// Persistence layer for episode_embeddings (migration 035), following the
// lib/intelligence/insights.ts conventions: DI'd SupabaseClient first param,
// explicit owner/client scoping on every write, and every PostgREST error
// checked and rethrown with context — never swallowed.
//
// RLS is owner-only via owner_user_id; the background paths use the
// service-role admin client which bypasses RLS, but rows still carry explicit
// owner_user_id/client_id so the layer is correct under either client.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EMBEDDING_DIMS,
  type Embedder,
  type EpisodeMatch,
  type EpisodeOutcome,
  type EpisodeSourceKind,
} from '@/lib/capability-contracts';
import {
  isEpisodeOutcome,
  isEpisodeSourceKind,
  isRecord,
  isStringArray,
  type RecallQuery,
  type RecallResult,
  type RecalledPrecedent,
} from './types';

// ── Upsert ────────────────────────────────────────────────────────────────────

export interface UpsertEpisodeInput {
  clientId:       string;
  ownerUserId:    string;
  sourceKind:     EpisodeSourceKind;
  sourceId:       string;
  episodeText:    string;
  /** Null = not fleet-safe; the 035 RPC excludes such rows from fleet recall. */
  abstractedText: string | null;
  outcome:        EpisodeOutcome;
  insightIds:     string[];
  /** Should include { embedder, dims } — ingest stamps them (035 comment). */
  metadata:       Record<string, unknown>;
  embedding:      number[];
}

function assertEmbeddingDims(embedding: number[], sourceId: string): void {
  if (embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `[upsertEpisode] embedding for source ${sourceId} has ${embedding.length} dims, ` +
      `expected ${EMBEDDING_DIMS} (035 vector column)`,
    );
  }
}

function parseInsertedIds(data: unknown): string[] {
  if (!Array.isArray(data)) {
    throw new Error('[upsertEpisodes] unexpected upsert response shape (not an array)');
  }
  return data.map((row) => {
    if (!isRecord(row) || typeof row.id !== 'string') {
      throw new Error('[upsertEpisodes] upsert row missing string id');
    }
    return row.id;
  });
}

/**
 * Idempotently upsert a batch of episodes in ONE round-trip. Conflict target
 * is the 035 unique index (source_kind, source_id) — re-ingesting the same
 * source row overwrites its episode instead of duplicating it. Returns the
 * episode ids in input order.
 */
export async function upsertEpisodes(
  supabase: SupabaseClient,
  inputs:   UpsertEpisodeInput[],
): Promise<string[]> {
  if (inputs.length === 0) return [];
  for (const input of inputs) assertEmbeddingDims(input.embedding, input.sourceId);

  const rows = inputs.map((input) => ({
    client_id:       input.clientId,
    owner_user_id:   input.ownerUserId,
    source_kind:     input.sourceKind,
    source_id:       input.sourceId,
    episode_text:    input.episodeText,
    abstracted_text: input.abstractedText,
    outcome:         input.outcome,
    insight_ids:     input.insightIds,
    metadata:        input.metadata,
    embedding:       input.embedding,
  }));

  const { data, error } = await supabase
    .from('episode_embeddings')
    .upsert(rows, { onConflict: 'source_kind,source_id' })
    .select('id');

  if (error) throw new Error(`[upsertEpisodes] upsert failed: ${error.message}`);
  return parseInsertedIds(data);
}

/** Idempotently upsert one episode; returns its id. */
export async function upsertEpisode(
  supabase: SupabaseClient,
  input:    UpsertEpisodeInput,
): Promise<string> {
  const [id] = await upsertEpisodes(supabase, [input]);
  if (!id) throw new Error(`[upsertEpisode] no id returned for source ${input.sourceId}`);
  return id;
}

// ── Recall ────────────────────────────────────────────────────────────────────

function parseMatchRow(value: unknown, index: number): EpisodeMatch {
  if (!isRecord(value)) {
    throw new Error(`[recallSimilar] match row #${index} is not an object`);
  }
  const { id, source_kind, source_id, episode, outcome, insight_ids, metadata, similarity } = value;
  if (
    typeof id !== 'string' ||
    typeof source_id !== 'string' ||
    typeof episode !== 'string' ||
    typeof similarity !== 'number' ||
    !isEpisodeSourceKind(source_kind) ||
    !isEpisodeOutcome(outcome) ||
    !isStringArray(insight_ids) ||
    !isRecord(metadata)
  ) {
    throw new Error(`[recallSimilar] match row #${index} has an unexpected shape`);
  }
  return { id, source_kind, source_id, episode, outcome, insight_ids, metadata, similarity };
}

/**
 * One-line, prompt-injectable summary of a recalled episode, e.g.
 * `[win] hypothesis: emotional-safety angle beats price-led for parents → supported`.
 * The essence is the episode's "Lesson:" line (the composers always emit one);
 * verdict-prefixed lessons are flipped to "<claim> → <verdict>" for readability.
 */
export function precedentSummary(match: EpisodeMatch): string {
  const lessonLine = /Lesson:\s*(.+)/.exec(match.episode);
  const lesson = (lessonLine?.[1] ?? match.episode.split('\n')[0] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const verdictPrefix = /^(supported|refuted|inconclusive|killed(?:\s*\([^)]*\))?):\s*(.+)$/.exec(lesson);
  const body = verdictPrefix ? `${verdictPrefix[2]} → ${verdictPrefix[1]}` : lesson;
  const capped = body.length <= 160 ? body : `${body.slice(0, 159)}…`;
  return `[${match.outcome}] ${match.source_kind}: ${capped}`;
}

/**
 * k-NN recall over episode_embeddings via the 035 `match_episodes` RPC.
 * Scope 'client' returns this client's episodes verbatim; scope 'fleet'
 * returns OTHER clients' episodes and the RPC serves abstracted_text only
 * (rows without one are excluded server-side — fleet safety is enforced in
 * SQL, not here). Embeds the context text with the provided embedder (one
 * call), and attaches a precedent_summary per match, ready for prompt
 * injection.
 */
export async function recallSimilar(
  supabase: SupabaseClient,
  embedder: Embedder,
  query:    RecallQuery,
): Promise<RecallResult> {
  const scope = query.scope ?? 'client';
  const k = query.k ?? 5;
  if (!query.contextText.trim()) {
    throw new Error('[recallSimilar] contextText is empty — nothing to match against');
  }

  const [vector] = await embedder.embed([query.contextText]);
  if (!vector || vector.length !== EMBEDDING_DIMS) {
    throw new Error(
      `[recallSimilar] embedder "${embedder.id}" returned ${vector?.length ?? 0} dims, expected ${EMBEDDING_DIMS}`,
    );
  }

  const { data, error } = await supabase.rpc('match_episodes', {
    p_client_id: query.clientId,
    p_query:     vector,
    p_scope:     scope,
    p_k:         k,
  });

  if (error) throw new Error(`[recallSimilar] match_episodes failed: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error('[recallSimilar] match_episodes returned a non-array result');
  }

  const matches: RecalledPrecedent[] = data.map((row: unknown, i: number) => {
    const match = parseMatchRow(row, i);
    return { ...match, precedent_summary: precedentSummary(match) };
  });

  return { scope, k, matches };
}
