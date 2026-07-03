// lib/competitor-watch/run-watch.ts
//
// Composition root for one watch run (skill §6 cadence: monthly light pass /
// quarterly rebuild / on-demand — the caller decides when; this function is
// one full pass): fetch per active entity → upsert observations (longevity
// tracker) → decode undecoded ads + own angle atoms (batched LLM) → pure
// analysis (classify / coverage map / flags / delta) → emit atom actions.
//
// FAILURE DOCTRINE: stage failures are typed and ISOLATED — a fetch failure
// on one entity, or one bad decode batch, is collected into `errors` while
// every other entity's progress persists. Partial intelligence beats none;
// the errors list keeps the degradation visible, never silent.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompetitorAdRow } from '@/lib/capability-contracts';
import { listActiveInsights } from '@/lib/intelligence/insights';
import type { ClientInsight } from '@/lib/intelligence/types';
import { buildCoverageMap, computeDelta, strategicFlags } from './analyze';
import { DECODE_BATCH_SIZE, decodeAngles, type DecodeItem, type LlmComplete } from './decode';
import { MAX_ADS_PER_RUN, type AdSourceFetcher } from './fetcher';
import { emitAtomActions, listAds, listEntities, updateAdDecoded, upsertObservedAds } from './store';
import {
  isCompetitorAngle,
  type AtomAction,
  type DecodeBatchResult,
  type DecodeDrop,
  type FetchResult,
  type OwnAngle,
  type RunWatchResult,
  type WatchError,
} from './types';

export interface RunWatchOptions {
  clientId:    string;
  ownerUserId: string;
  /** Injectable clock — analysis thresholds are age-based (defaults to new Date()). */
  now?: Date;
}

/** Prefix distinguishing own-angle-atom decode items from ad decode items in
 *  the shared LLM batch (atom ids are UUIDs, so the prefix cannot collide). */
const ATOM_ITEM_PREFIX = 'atom:';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Project the client's active bridge-layer angle atoms into taxonomy space.
 * Atoms already stamped with a valid structured.taxonomy_angle (a previous
 * run's cache — see emitAtomActions) map for free; the rest are returned for
 * LLM decoding alongside the ads (one seam, one batch discipline).
 */
function splitOwnAngleAtoms(atoms: ClientInsight[]): {
  ready:    OwnAngle[];
  toDecode: ClientInsight[];
} {
  const ready: OwnAngle[] = [];
  const toDecode: ClientInsight[] = [];
  for (const atom of atoms) {
    const cached = atom.structured?.taxonomy_angle;
    if (isCompetitorAngle(cached)) {
      ready.push({ angle: cached, atomConfidence: atom.confidence, insightId: atom.id });
    } else if (atom.content.trim()) {
      toDecode.push(atom);
    }
  }
  return { ready, toDecode };
}

/**
 * One full watch pass. Returns the §6 output contract: delta report, coverage
 * map, strategic flags, atom actions — plus the error/drop ledgers.
 */
export async function runWatch(
  supabase: SupabaseClient,
  llm:      LlmComplete,
  fetcher:  AdSourceFetcher,
  opts:     RunWatchOptions,
): Promise<RunWatchResult> {
  const now = opts.now ?? new Date();
  const errors: WatchError[] = [];
  const decode_dropped: DecodeDrop[] = [];

  // Snapshot BEFORE ingestion — the delta's "previous state".
  const prevAds = await listAds(supabase, opts.clientId, opts.ownerUserId);

  // ── fetch + upsert, isolated per entity ─────────────────────────────────────
  const entities = await listEntities(supabase, opts.clientId, opts.ownerUserId, { activeOnly: true });
  for (const entity of entities) {
    let fetched: FetchResult;
    try {
      fetched = await fetcher.fetch(entity);
    } catch (e: unknown) {
      errors.push({ stage: 'fetch', entity_id: entity.id, error: errMessage(e) });
      continue;
    }
    try {
      await upsertObservedAds(supabase, entity, fetched.ads, now);
    } catch (e: unknown) {
      errors.push({ stage: 'upsert', entity_id: entity.id, error: errMessage(e) });
    }
  }

  // Re-read the full current state (survivors of any per-entity failures).
  const allAds = await listAds(supabase, opts.clientId, opts.ownerUserId);
  const activeEntityIds = new Set(entities.map((e) => e.id));
  // Ads of DEACTIVATED entities stay stored (history) but are excluded from
  // analysis — the cap exists because >5 tracked entities is noise (skill §1).
  const ads = allAds.filter((ad) => activeEntityIds.has(ad.entity_id));

  // ── decode: undecoded ads + un-projected own angle atoms, one batch seam ────
  const bridgeAtoms = await listActiveInsights(supabase, opts.clientId, 'bridge');
  const angleAtoms  = bridgeAtoms.filter((a) => a.kind === 'angle');
  const { ready: ownAngles, toDecode: atomsToDecode } = splitOwnAngleAtoms(angleAtoms);

  const allAdItems: DecodeItem[] = ads
    .filter((ad) => ad.decoded === null && typeof ad.creative.text === 'string' && ad.creative.text.trim() !== '')
    .map((ad) => ({ id: ad.id, text: String(ad.creative.text) }));

  // Cost/DoS guard (F1): decode at most MAX_ADS_PER_RUN ads per pass, so a
  // single POST can never fan out into an unbounded number of LLM calls
  // regardless of how many undecoded ads have accumulated. The excess stays
  // stored undecoded (a later run picks it up) — reported, never silently lost.
  let ads_capped = 0;
  let adItems = allAdItems;
  if (allAdItems.length > MAX_ADS_PER_RUN) {
    ads_capped = allAdItems.length - MAX_ADS_PER_RUN;
    adItems = allAdItems.slice(0, MAX_ADS_PER_RUN);
    console.warn(
      `[runWatch] ${allAdItems.length} undecoded ads exceed MAX_ADS_PER_RUN=${MAX_ADS_PER_RUN}; ` +
      `decoding the first ${MAX_ADS_PER_RUN}, deferring ${ads_capped} to a later run`,
    );
  }
  const atomItems: DecodeItem[] = atomsToDecode.map((a) => ({ id: `${ATOM_ITEM_PREFIX}${a.id}`, text: a.content }));

  const adsById = new Map(ads.map((ad) => [ad.id, ad]));
  const atomsById = new Map(atomsToDecode.map((a) => [a.id, a]));
  let decoded_count = 0;

  for (const batch of chunk([...adItems, ...atomItems], DECODE_BATCH_SIZE)) {
    let result: DecodeBatchResult;
    try {
      result = await decodeAngles(batch, llm);
    } catch (e: unknown) {
      errors.push({ stage: 'decode', error: errMessage(e) });
      continue;
    }
    if (!result.ok) {
      errors.push({ stage: 'decode', error: result.error });
      continue;
    }
    decode_dropped.push(...result.dropped);

    for (const [id, decoding] of Object.entries(result.decoded)) {
      if (id.startsWith(ATOM_ITEM_PREFIX)) {
        const atom = atomsById.get(id.slice(ATOM_ITEM_PREFIX.length));
        if (atom) {
          ownAngles.push({ angle: decoding.angle, atomConfidence: atom.confidence, insightId: atom.id });
        }
        continue;
      }
      const ad = adsById.get(id);
      if (!ad) continue;
      try {
        const updated = await updateAdDecoded(supabase, ad.id, decoding);
        adsById.set(id, updated);
        decoded_count++;
      } catch (e: unknown) {
        errors.push({ stage: 'decode', entity_id: ad.entity_id, error: errMessage(e) });
      }
    }
  }

  const currentAds: CompetitorAdRow[] = ads.map((ad) => adsById.get(ad.id) ?? ad);

  // ── pure analysis ───────────────────────────────────────────────────────────
  const map   = buildCoverageMap(entities, currentAds, ownAngles, now);
  const flags = strategicFlags(map, entities);
  const delta = computeDelta(prevAds, currentAds, { now });

  // ── atom actions (audited) ──────────────────────────────────────────────────
  let atomActions: AtomAction[] = [];
  try {
    atomActions = await emitAtomActions(supabase, opts.clientId, opts.ownerUserId, {
      entities,
      ads: currentAds,
      map,
      ownAngles,
      now,
    });
  } catch (e: unknown) {
    errors.push({ stage: 'emit', error: errMessage(e) });
  }

  return { delta, map, flags, atomActions, errors, decoded_count, decode_dropped, ads_capped };
}
