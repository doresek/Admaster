// lib/episodic/ingest.ts
//
// Turns a client's resolved experience (resolved hypotheses + diagnoses) into
// embedded episodes. Incremental and idempotent: existing (source_kind,
// source_id) pairs are skipped via ONE lookup query, all new episode texts are
// embedded in ONE batched embedder call (never per-episode — the N+1 trap),
// and the write is ONE bulk upsert. Conventions per lib/intelligence: DI'd
// SupabaseClient first, explicit owner/client scoping, every error checked.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMBEDDING_DIMS, type Embedder } from '@/lib/capability-contracts';
import {
  DIAGNOSIS_SOURCE_COLUMNS,
  HYPOTHESIS_SOURCE_COLUMNS,
  isDiagnosisFailedLink,
  isRecord,
  isStringArray,
  type ComposedEpisode,
  type DiagnosisSourceRow,
  type HypothesisEpisodeSource,
  type IngestCounts,
} from './types';
import {
  EpisodeCompositionError,
  RESOLVED_HYPOTHESIS_STATUSES,
  abstractEpisode,
  composeFromDiagnosis,
  composeFromHypothesis,
} from './compose';
import { upsertEpisodes, type UpsertEpisodeInput } from './store';

// ── Row parsing (PostgREST rows arrive untyped; validate, never cast) ────────

function parseDiagnosisRow(value: unknown): DiagnosisSourceRow {
  if (!isRecord(value)) throw new Error('[ingest] diagnoses row is not an object');
  const {
    id, client_id, owner_user_id, scope_artifact_id, scope_campaign_id, scope_item_id,
    failed_link, rationale, evidence, target_insight_ids, recommended_action,
    applied, applied_item_id, created_at,
  } = value;
  if (
    typeof id !== 'string' ||
    typeof client_id !== 'string' ||
    typeof owner_user_id !== 'string' ||
    !isDiagnosisFailedLink(failed_link) ||
    typeof rationale !== 'string' ||
    !isStringArray(target_insight_ids)
  ) {
    throw new Error(`[ingest] diagnoses row ${typeof id === 'string' ? id : '<no id>'} has an unexpected shape`);
  }
  return {
    id,
    client_id,
    owner_user_id,
    scope_artifact_id:  typeof scope_artifact_id === 'string' ? scope_artifact_id : null,
    scope_campaign_id:  typeof scope_campaign_id === 'string' ? scope_campaign_id : null,
    scope_item_id:      typeof scope_item_id === 'string' ? scope_item_id : null,
    failed_link,
    rationale,
    evidence:           isRecord(evidence) ? evidence : null,
    target_insight_ids,
    recommended_action: isRecord(recommended_action) ? recommended_action : null,
    applied:            applied === true,
    applied_item_id:    typeof applied_item_id === 'string' ? applied_item_id : null,
    created_at:         typeof created_at === 'string' ? created_at : '',
  };
}

const HYPOTHESIS_STATUSES = new Set<string>([
  'open', 'supported', 'refuted', 'inconclusive', 'killed', 'superseded',
]);
const HYPOTHESIS_DOMAINS = new Set<string>([
  'angle', 'audience', 'offer', 'creative', 'funnel', 'timing', 'channel', 'other',
]);
const PREDICTION_COMPARATORS = new Set<string>(['gte', 'lte', 'ratio_gte', 'ratio_lte']);
const RESOLVED_BY = new Set<string>([
  'floor_met', 'horizon_forced', 'killed_mercy', 'killed_catastrophic', 'manual',
]);

function isHypothesisStatus(v: unknown): v is HypothesisEpisodeSource['status'] {
  return typeof v === 'string' && HYPOTHESIS_STATUSES.has(v);
}
function isHypothesisDomain(v: unknown): v is HypothesisEpisodeSource['domain'] {
  return typeof v === 'string' && HYPOTHESIS_DOMAINS.has(v);
}
function isPrediction(v: unknown): v is HypothesisEpisodeSource['prediction'] {
  return isRecord(v)
    && typeof v.metric === 'string'
    && typeof v.comparator === 'string' && PREDICTION_COMPARATORS.has(v.comparator)
    && typeof v.value === 'number'
    && typeof v.arm === 'string'
    && typeof v.confidence === 'number';
}
function isResolution(v: unknown): v is NonNullable<HypothesisEpisodeSource['resolution']> {
  return isRecord(v)
    && isRecord(v.observed)
    && typeof v.verdict_reason === 'string'
    && typeof v.resolved_by === 'string' && RESOLVED_BY.has(v.resolved_by);
}

function parseHypothesisRow(value: unknown): HypothesisEpisodeSource {
  if (!isRecord(value)) throw new Error('[ingest] hypotheses row is not an object');
  const { id, client_id, owner_user_id, claim, prediction, domain, status, resolution, insight_ids, resolved_at } = value;
  if (
    typeof id !== 'string' ||
    typeof client_id !== 'string' ||
    typeof owner_user_id !== 'string' ||
    typeof claim !== 'string' ||
    !isPrediction(prediction) ||
    !isHypothesisDomain(domain) ||
    !isHypothesisStatus(status) ||
    !isStringArray(insight_ids)
  ) {
    throw new Error(`[ingest] hypotheses row ${typeof id === 'string' ? id : '<no id>'} has an unexpected shape`);
  }
  return {
    id,
    client_id,
    owner_user_id,
    claim,
    prediction,
    domain,
    status,
    resolution:  isResolution(resolution) ? resolution : null,
    insight_ids,
    resolved_at: typeof resolved_at === 'string' ? resolved_at : null,
  };
}

// ── Ingest ────────────────────────────────────────────────────────────────────

/**
 * Ingest all not-yet-ingested resolved experience for one client:
 * resolved hypotheses (supported/refuted/inconclusive/killed) + all diagnoses.
 *
 * Pipeline: one existing-pairs query → compose (pure) + abstract (client name
 * from the clients row) → ONE batched embed call → ONE bulk upsert. Malformed
 * source rows are skipped WITH a console.warn and counted in skippedMalformed
 * (a single bad prod row must not abort a backfill), but infrastructure errors
 * (query/embedder/upsert failures) always propagate.
 */
export async function ingestForClient(
  supabase:    SupabaseClient,
  embedder:    Embedder,
  clientId:    string,
  ownerUserId: string,
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    composed: 0, embedded: 0, upserted: 0, skippedExisting: 0, skippedMalformed: 0,
  };

  // 1) Existing episodes for this client — ONE query, then set-membership.
  const existingRes = await supabase
    .from('episode_embeddings')
    .select('source_kind, source_id')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (existingRes.error) {
    throw new Error(`[ingest] existing-episodes query failed: ${existingRes.error.message}`);
  }
  const existing = new Set<string>(
    (Array.isArray(existingRes.data) ? existingRes.data : []).map((row: unknown) => {
      if (!isRecord(row) || typeof row.source_kind !== 'string' || typeof row.source_id !== 'string') {
        throw new Error('[ingest] existing-episodes row has an unexpected shape');
      }
      return `${row.source_kind}:${row.source_id}`;
    }),
  );

  // 2) Client name — feeds the fleet-safe abstraction pass.
  const clientRes = await supabase
    .from('clients')
    .select('id, name, company')
    .eq('id', clientId)
    .eq('owner_user_id', ownerUserId)
    .limit(1);
  if (clientRes.error) {
    throw new Error(`[ingest] clients query failed: ${clientRes.error.message}`);
  }
  const clientRow: unknown = Array.isArray(clientRes.data) ? clientRes.data[0] : undefined;
  const clientName = isRecord(clientRow) && typeof clientRow.name === 'string' ? clientRow.name : null;
  const companyName = isRecord(clientRow) && typeof clientRow.company === 'string' ? clientRow.company : null;
  const businessTerms = companyName ? [companyName] : [];

  // 3) Sources: resolved hypotheses + all diagnoses for this client.
  const hypRes = await supabase
    .from('hypotheses')
    .select(HYPOTHESIS_SOURCE_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .in('status', [...RESOLVED_HYPOTHESIS_STATUSES]);
  if (hypRes.error) {
    throw new Error(`[ingest] hypotheses query failed: ${hypRes.error.message}`);
  }

  const diagRes = await supabase
    .from('diagnoses')
    .select(DIAGNOSIS_SOURCE_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (diagRes.error) {
    throw new Error(`[ingest] diagnoses query failed: ${diagRes.error.message}`);
  }

  // 4) Compose (pure). Incremental skip happens BEFORE composition.
  const composed: ComposedEpisode[] = [];
  const composeOne = (kind: 'hypothesis' | 'diagnosis', raw: unknown): void => {
    try {
      const episode = kind === 'hypothesis'
        ? composeFromHypothesis(parseHypothesisRow(raw))
        : composeFromDiagnosis(parseDiagnosisRow(raw));
      composed.push(episode);
      counts.composed += 1;
    } catch (e: unknown) {
      // Only COMPOSITION rejections are skippable — a malformed prod row must
      // not abort the whole ingest. Anything else is a real bug: rethrow.
      if (e instanceof EpisodeCompositionError || (e instanceof Error && e.message.startsWith('[ingest]'))) {
        counts.skippedMalformed += 1;
        console.warn(`[ingest] skipping malformed ${kind} row: ${e.message}`);
        return;
      }
      throw e;
    }
  };

  for (const raw of Array.isArray(hypRes.data) ? hypRes.data : []) {
    const sourceId = isRecord(raw) && typeof raw.id === 'string' ? raw.id : '';
    if (existing.has(`hypothesis:${sourceId}`)) { counts.skippedExisting += 1; continue; }
    composeOne('hypothesis', raw);
  }
  for (const raw of Array.isArray(diagRes.data) ? diagRes.data : []) {
    const sourceId = isRecord(raw) && typeof raw.id === 'string' ? raw.id : '';
    if (existing.has(`diagnosis:${sourceId}`)) { counts.skippedExisting += 1; continue; }
    composeOne('diagnosis', raw);
  }

  if (composed.length === 0) return counts;

  // 5) ONE batched embedder call for every new episode.
  const vectors = await embedder.embed(composed.map((e) => e.episode_text));
  if (vectors.length !== composed.length) {
    throw new Error(
      `[ingest] embedder "${embedder.id}" returned ${vectors.length} vectors for ${composed.length} texts`,
    );
  }
  counts.embedded = vectors.length;

  // 6) ONE bulk upsert, metadata stamped with embedder id + dims (035 comment).
  const inputs: UpsertEpisodeInput[] = composed.map((episode, i) => ({
    clientId,
    ownerUserId,
    sourceKind:     episode.source_kind,
    sourceId:       episode.source_id,
    episodeText:    episode.episode_text,
    abstractedText: abstractEpisode(episode.episode_text, { clientName, businessTerms }),
    outcome:        episode.outcome,
    insightIds:     episode.insight_ids,
    metadata:       { ...episode.metadata, embedder: embedder.id, dims: EMBEDDING_DIMS },
    embedding:      vectors[i],
  }));

  const ids = await upsertEpisodes(supabase, inputs);
  counts.upserted = ids.length;
  return counts;
}
