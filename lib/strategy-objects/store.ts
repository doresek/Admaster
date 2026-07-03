// lib/strategy-objects/store.ts
//
// Persistence for C-10's strategy objects (tables `message_architectures` and
// `funnels`, migration 037), following the lib/intelligence/insights.ts /
// lib/hypotheses/store.ts conventions: every function takes a SupabaseClient
// first (dependency injection — mockable in tests), every query is EXPLICITLY
// owner/client scoped even under the service-role client, and every DB error
// is checked. SupabaseClient is taken DIRECTLY (the proven pattern) — a
// structural DB-seam assignment blows TS2589 under Next's build type pass
// (see lib/calibration/store.ts for the full pathology write-up).
//
// Append-only doctrine: message_architectures rows are NEVER updated — a
// re-synthesis inserts the next version (unique (client_id, version) enforces
// it). Funnels update only via the status state machine draft→active→archived.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FunnelRow, MessageArchitectureRow } from '@/lib/capability-contracts';
import type { ArchitectureDraft, CoverageReport, FunnelDraft, PillarCoverage } from './types';

const ARCHITECTURE_COLUMNS =
  'id, client_id, owner_user_id, version, core_promise, pillars, proof_map, ' +
  'unassigned, grounded_in, synth_meta, created_at';

const FUNNEL_COLUMNS =
  'id, client_id, owner_user_id, campaign_id, name, awareness_entry, nodes, ' +
  'edges, grounded_in, status, created_at, updated_at';

// ── message architectures ─────────────────────────────────────────────────────

export interface SaveArchitectureInput {
  clientId:    string;
  ownerUserId: string;
  draft:       ArchitectureDraft;
}

/**
 * Persist a new architecture VERSION: next version = current max + 1.
 *
 * Race note ("atomically-ish"): read-max-then-insert is not atomic — two
 * concurrent synthesizers can both read max=N and both try to insert N+1.
 * The unique (client_id, version) constraint makes the loser fail cleanly;
 * on that specific violation we re-read max and retry ONCE. Acceptable
 * because (a) synthesis is triggered per-client by a single orchestrator or
 * an explicit owner action — true concurrency is rare; (b) the constraint
 * guarantees correctness (no silent double-version) either way; a retry loop
 * or an RPC would buy nothing but complexity here.
 */
export async function saveArchitecture(
  supabase: SupabaseClient,
  input:    SaveArchitectureInput,
): Promise<MessageArchitectureRow> {
  const attempt = async (): Promise<
    { row: MessageArchitectureRow } | { uniqueViolation: string }
  > => {
    const version = (await maxVersion(supabase, input.clientId, input.ownerUserId)) + 1;
    const { data, error } = await supabase
      .from('message_architectures')
      .insert({
        client_id:     input.clientId,
        owner_user_id: input.ownerUserId,
        version,
        core_promise:  input.draft.core_promise,
        pillars:       input.draft.pillars,
        proof_map:     input.draft.proof_map,
        unassigned:    input.draft.unassigned,
        grounded_in:   input.draft.grounded_in,
        synth_meta:    input.draft.synth_meta,
      })
      .select(ARCHITECTURE_COLUMNS)
      .single()
      .overrideTypes<MessageArchitectureRow, { merge: false }>();

    if (error) {
      if (isUniqueViolation(error)) return { uniqueViolation: error.message };
      throw new Error(`saveArchitecture: ${error.message}`);
    }
    return { row: data };
  };

  const first = await attempt();
  if ('row' in first) return first.row;

  const second = await attempt();
  if ('row' in second) return second.row;
  throw new Error(
    `saveArchitecture: version conflict persisted after retry (${second.uniqueViolation})`,
  );
}

/** Postgres unique_violation is SQLSTATE 23505 (surfaced by PostgREST). */
const isUniqueViolation = (error: { code?: string; message: string }): boolean =>
  error.code === '23505' || /duplicate key|unique constraint/i.test(error.message);

async function maxVersion(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('message_architectures')
    .select('version')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
    .overrideTypes<{ version: number }, { merge: false }>();

  if (error) throw new Error(`saveArchitecture: version read failed: ${error.message}`);
  return data?.version ?? 0;
}

/** Latest architecture version for a client, or null when none synthesized yet. */
export async function getLatestArchitecture(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<MessageArchitectureRow | null> {
  const { data, error } = await supabase
    .from('message_architectures')
    .select(ARCHITECTURE_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
    .overrideTypes<MessageArchitectureRow, { merge: false }>();

  if (error) throw new Error(`getLatestArchitecture: ${error.message}`);
  return data;
}

/** Slim changelog row — full pillars are fetched per version when needed. */
export interface ArchitectureVersionSummary {
  id:         string;
  version:    number;
  synth_meta: Record<string, unknown>;
  created_at: string;
}

/** All versions for the changelog view, newest first. */
export async function listArchitectureVersions(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<ArchitectureVersionSummary[]> {
  const { data, error } = await supabase
    .from('message_architectures')
    .select('id, version, synth_meta, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .order('version', { ascending: false })
    .overrideTypes<ArchitectureVersionSummary[], { merge: false }>();

  if (error) throw new Error(`listArchitectureVersions: ${error.message}`);
  return data ?? [];
}

// ── funnels ──────────────────────────────────────────────────────────────────

export interface SaveFunnelInput {
  clientId:    string;
  ownerUserId: string;
  draft:       FunnelDraft;
  campaignId?: string | null;
}

/** Persist a designed funnel (always born 'draft' — activation is a transition). */
export async function saveFunnel(
  supabase: SupabaseClient,
  input:    SaveFunnelInput,
): Promise<FunnelRow> {
  const { data, error } = await supabase
    .from('funnels')
    .insert({
      client_id:       input.clientId,
      owner_user_id:   input.ownerUserId,
      campaign_id:     input.campaignId ?? null,
      name:            input.draft.name,
      awareness_entry: input.draft.awareness_entry,
      nodes:           input.draft.nodes,
      edges:           input.draft.edges,
      grounded_in:     input.draft.grounded_in,
      status:          'draft',
    })
    .select(FUNNEL_COLUMNS)
    .single()
    .overrideTypes<FunnelRow, { merge: false }>();

  if (error) throw new Error(`saveFunnel: ${error.message}`);
  return data;
}

export async function getFunnel(
  supabase:    SupabaseClient,
  id:          string,
  ownerUserId: string,
): Promise<FunnelRow | null> {
  const { data, error } = await supabase
    .from('funnels')
    .select(FUNNEL_COLUMNS)
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<FunnelRow, { merge: false }>();

  if (error) throw new Error(`getFunnel: ${error.message}`);
  return data;
}

export async function listFunnels(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  status?:     FunnelRow['status'],
): Promise<FunnelRow[]> {
  let q = supabase
    .from('funnels')
    .select(FUNNEL_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (status) q = q.eq('status', status);

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .overrideTypes<FunnelRow[], { merge: false }>();

  if (error) throw new Error(`listFunnels: ${error.message}`);
  return data ?? [];
}

/**
 * The ONLY legal funnel lifecycle moves. Strictly forward — an archived funnel
 * is history (design a new one), a draft can't be archived (it was never live,
 * delete-by-ignore), and nothing ever returns to draft.
 */
const FUNNEL_TRANSITIONS: Record<FunnelRow['status'], FunnelRow['status'][]> = {
  draft:    ['active'],
  active:   ['archived'],
  archived: [],
};

/**
 * Transition a funnel's status. The `.eq('status', from)` guard makes the
 * update a compare-and-set: a concurrent transition leaves exactly one winner;
 * the loser sees null and errors (same discipline as resolveHypothesis).
 */
export async function updateFunnelStatus(
  supabase:    SupabaseClient,
  id:          string,
  ownerUserId: string,
  next:        FunnelRow['status'],
): Promise<FunnelRow> {
  const current = await getFunnel(supabase, id, ownerUserId);
  if (!current) throw new Error(`updateFunnelStatus: funnel ${id} not found`);
  if (!FUNNEL_TRANSITIONS[current.status].includes(next)) {
    throw new Error(
      `updateFunnelStatus: illegal transition ${current.status}→${next} (allowed: draft→active→archived)`,
    );
  }

  const { data, error } = await supabase
    .from('funnels')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .eq('status', current.status)
    .select(FUNNEL_COLUMNS)
    .maybeSingle()
    .overrideTypes<FunnelRow, { merge: false }>();

  if (error) throw new Error(`updateFunnelStatus: ${error.message}`);
  if (!data) {
    throw new Error(`updateFunnelStatus: funnel ${id} changed concurrently — transition lost`);
  }
  return data;
}

// ── coverage report ──────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * Read an artifact's pillar tag. Artifacts carry `pillar_ref` inside the
 * `content` jsonb (030-schema convention — no migration needed) with
 * `generated_from` as a legacy/alternate location. jsonb is runtime-untrusted,
 * so this narrows with guards rather than assertions.
 */
const pillarRefOf = (artifact: {
  content: unknown;
  generated_from: unknown;
}): string | null => {
  for (const holder of [artifact.content, artifact.generated_from]) {
    if (isRecord(holder) && typeof holder.pillar_ref === 'string' && holder.pillar_ref) {
      return holder.pillar_ref;
    }
  }
  return null;
};

/**
 * Content-per-pillar over a rolling window — the skill §2 "coverage
 * discipline": a pillar with zero artifacts is `silent` ("a strategic
 * decision being made by accident"; §5: silence is a decision — make it on
 * purpose). Pillars come from the LATEST architecture; artifacts are scanned
 * with ONE query and grouped in memory (no per-pillar round-trips).
 */
export async function coverageReport(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  windowDays = 30,
): Promise<CoverageReport> {
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error(`coverageReport: windowDays must be a finite number > 0, got ${windowDays}`);
  }

  const latest = await getLatestArchitecture(supabase, clientId, ownerUserId);
  if (!latest) return { pillars: [], window_days: windowDays };

  const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('content_artifacts')
    .select('id, content, generated_from, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', since)
    .overrideTypes<
      Array<{ id: string; content: unknown; generated_from: unknown; created_at: string }>,
      { merge: false }
    >();

  if (error) throw new Error(`coverageReport: artifacts read failed: ${error.message}`);

  // Group in memory: count + latest timestamp per pillar key.
  const counts = new Map<string, { count: number; last: string | null }>();
  for (const artifact of data ?? []) {
    const key = pillarRefOf(artifact);
    if (!key) continue;
    const entry = counts.get(key) ?? { count: 0, last: null };
    entry.count += 1;
    if (entry.last === null || artifact.created_at > entry.last) entry.last = artifact.created_at;
    counts.set(key, entry);
  }

  const pillars: PillarCoverage[] = latest.pillars.map((p) => {
    const entry = counts.get(p.key);
    return {
      key:              p.key,
      title:            p.title,
      artifact_count:   entry?.count ?? 0,
      last_artifact_at: entry?.last ?? null,
      silent:           (entry?.count ?? 0) === 0,
    };
  });

  return { pillars, window_days: windowDays };
}
