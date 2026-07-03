// lib/competitor-watch/store.ts
//
// Persistence for C-09 (tables competitor_entities / competitor_ads,
// migration 042), following the lib/intelligence/insights.ts conventions:
// every function takes a SupabaseClient first (dependency injection —
// mockable), every query is EXPLICITLY owner/client scoped even under the
// service-role client, typed selects via .overrideTypes (the
// lib/hypotheses/store.ts pattern — never structurally assign SupabaseClient
// to a seam interface), and every DB error is checked.
//
// The LONGEVITY tracker lives in upsertObservedAds: first_seen is written
// once and never touched; re-observation only moves last_seen/active. Ad age
// — the entire §2 inference engine — depends on that invariant.
//
// Atom emission (emitAtomActions) goes through lib/intelligence: new
// `alternative` atoms via createInsight; structured updates (competitor
// evidence refresh, contested stamps) are written directly WITH an
// insight_events audit row via logInsightEvent — audit everything.
// NOTE: the learning_signals CHECK now includes 'competitor_evidence' (migration
// 048), so competitor findings CAN emit an honest learning_signal. Today they still
// write `alternative` atoms + insight_events directly (which is sufficient for
// grounding); routing competitor corroboration through the lifecycle engine as a
// 'competitor_evidence' signal is now unblocked as a follow-up enhancement.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompetitorAdRow, CompetitorEntityRow, CompetitorRing } from '@/lib/capability-contracts';
import { INSIGHT_COLUMNS, type ClientInsight } from '@/lib/intelligence/types';
import { createInsight, listActiveInsights, logInsightEvent } from '@/lib/intelligence/insights';
import { classifyAds } from './analyze';
import { manualRef } from './fetcher';
import type { AngleDecoding, AtomAction, CoverageMap, OwnAngle, RawObservedAd } from './types';

export const COMPETITOR_ENTITY_COLUMNS =
  'id, client_id, owner_user_id, name, page_ref, ring, active, created_at, updated_at';

export const COMPETITOR_AD_COLUMNS =
  'id, entity_id, client_id, owner_user_id, platform_ad_ref, first_seen, last_seen, active, creative, decoded, created_at';

/**
 * The tracking cap (skill §1: "Cap active tracking at ~3–5 entities; more is
 * noise"). 5 is the hard ceiling: a sixth active entity is a typed rejection
 * that names the current five so the owner deactivates deliberately.
 */
export const MAX_ACTIVE_ENTITIES = 5;

/** New-alternative-atom starting confidence: competitor presence is directly
 *  OBSERVED market behavior — stronger than a single VoC anecdote (0.35), but
 *  the decoded angles are still inference (skill §2: "everything is inference
 *  — label the confidence accordingly"), so above baseline, not by much. */
export const COMPETITOR_ATOM_CONFIDENCE = 0.6;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

// ── entities ──────────────────────────────────────────────────────────────────

export interface UpsertEntityInput {
  clientId:    string;
  ownerUserId: string;
  name:        string;
  pageRef?:    string | null;
  ring?:       CompetitorRing;
  active?:     boolean;
}

export type EntityCapRejection = {
  ok:              false;
  reason:          'cap_exceeded';
  message:         string;
  /** The current active set — the owner must deactivate one of THESE. */
  active_entities: Array<{ id: string; name: string }>;
};

export type UpsertEntityResult =
  | { ok: true; entity: CompetitorEntityRow; created: boolean }
  | EntityCapRejection;

async function listActiveEntitySlots(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  excludeId?:  string,
): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase
    .from('competitor_entities')
    .select('id, name')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .eq('active', true)
    .overrideTypes<Array<{ id: string; name: string }>, { merge: false }>();
  if (error) throw new Error(`listActiveEntitySlots: ${error.message}`);
  return (data ?? []).filter((e) => e.id !== excludeId);
}

const capRejection = (active: Array<{ id: string; name: string }>): EntityCapRejection => ({
  ok:      false,
  reason:  'cap_exceeded',
  message:
    `כבר במעקב ${active.length} מתחרים פעילים — המקסימום הוא ${MAX_ACTIVE_ENTITIES} (יותר מזה = רעש, לא מודיעין). ` +
    `כדי להוסיף, יש להשבית אחד מ: ${active.map((e) => e.name).join(', ')}`,
  active_entities: active,
});

/**
 * Create-or-update a tracked entity by (client_id, name) — the table's
 * natural key. ENFORCES the cap: activating (or creating active) when
 * MAX_ACTIVE_ENTITIES others are already active returns a typed rejection
 * naming which entities occupy the slots. Deactivation always succeeds.
 */
export async function upsertEntity(
  supabase: SupabaseClient,
  input:    UpsertEntityInput,
): Promise<UpsertEntityResult> {
  const { data: existingData, error: findErr } = await supabase
    .from('competitor_entities')
    .select(COMPETITOR_ENTITY_COLUMNS)
    .eq('client_id', input.clientId)
    .eq('owner_user_id', input.ownerUserId)
    .eq('name', input.name)
    .maybeSingle()
    .overrideTypes<CompetitorEntityRow, { merge: false }>();
  if (findErr) throw new Error(`upsertEntity: ${findErr.message}`);
  const existing: CompetitorEntityRow | null = existingData;

  const wantActive = input.active ?? true;
  if (wantActive && !(existing?.active === true)) {
    const slots = await listActiveEntitySlots(supabase, input.clientId, input.ownerUserId, existing?.id);
    if (slots.length >= MAX_ACTIVE_ENTITIES) return capRejection(slots);
  }

  if (existing) {
    const { data, error } = await supabase
      .from('competitor_entities')
      .update({
        page_ref:   input.pageRef ?? existing.page_ref,
        ring:       input.ring ?? existing.ring,
        active:     wantActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(COMPETITOR_ENTITY_COLUMNS)
      .single()
      .overrideTypes<CompetitorEntityRow, { merge: false }>();
    if (error) throw new Error(`upsertEntity(update): ${error.message}`);
    return { ok: true, entity: data, created: false };
  }

  const { data, error } = await supabase
    .from('competitor_entities')
    .insert({
      client_id:     input.clientId,
      owner_user_id: input.ownerUserId,
      name:          input.name,
      page_ref:      input.pageRef ?? null,
      ring:          input.ring ?? 'direct',
      active:        wantActive,
    })
    .select(COMPETITOR_ENTITY_COLUMNS)
    .single()
    .overrideTypes<CompetitorEntityRow, { merge: false }>();
  if (error) throw new Error(`upsertEntity(insert): ${error.message}`);
  return { ok: true, entity: data, created: true };
}

export type SetEntityActiveResult =
  | { ok: true; entity: CompetitorEntityRow }
  | EntityCapRejection
  | { ok: false; reason: 'not_found'; message: string };

/** Flip one entity's active flag by id (cap-checked on activation). */
export async function setEntityActive(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  entityId:    string,
  active:      boolean,
): Promise<SetEntityActiveResult> {
  if (active) {
    const slots = await listActiveEntitySlots(supabase, clientId, ownerUserId, entityId);
    if (slots.length >= MAX_ACTIVE_ENTITIES) return capRejection(slots);
  }

  const { data, error } = await supabase
    .from('competitor_entities')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', entityId)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .select(COMPETITOR_ENTITY_COLUMNS)
    .maybeSingle()
    .overrideTypes<CompetitorEntityRow, { merge: false }>();
  if (error) throw new Error(`setEntityActive: ${error.message}`);
  if (!data) return { ok: false, reason: 'not_found', message: `entity ${entityId} not found for this client/owner` };
  return { ok: true, entity: data };
}

/** List a client's tracked entities (optionally active only), stable order. */
export async function listEntities(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  opts:        { activeOnly?: boolean } = {},
): Promise<CompetitorEntityRow[]> {
  let q = supabase
    .from('competitor_entities')
    .select(COMPETITOR_ENTITY_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (opts.activeOnly) q = q.eq('active', true);

  const { data, error } = await q
    .order('created_at', { ascending: true })
    .overrideTypes<CompetitorEntityRow[], { merge: false }>();
  if (error) throw new Error(`listEntities: ${error.message}`);
  return data ?? [];
}

// ── observed ads (the longevity tracker) ──────────────────────────────────────

export interface UpsertAdsResult {
  inserted: number;
  updated:  number;
  rows:     CompetitorAdRow[];
}

/**
 * Idempotent batch upsert on (entity_id, platform_ad_ref):
 *  • NEW ref → insert with first_seen = observed first_seen ?? today,
 *    last_seen = today when active (an inactive paste defaults last_seen =
 *    first_seen — conservatively short lifespan, documented in fetcher.ts).
 *  • EXISTING ref → first_seen NEVER touched (the longevity invariant);
 *    active flips to the observation; last_seen moves to today only when the
 *    ad was observed STILL RUNNING (an inactive observation is "I no longer
 *    see it", not a sighting).
 * Observations without a ref get the deterministic manual ref of their text,
 * so a re-paste is a pure no-op set of last_seen bumps — never duplicates.
 */
export async function upsertObservedAds(
  supabase: SupabaseClient,
  entity:   CompetitorEntityRow,
  ads:      RawObservedAd[],
  now:      Date,
): Promise<UpsertAdsResult> {
  if (ads.length === 0) return { inserted: 0, updated: 0, rows: [] };
  const today = dateOnly(now);

  const { data: existingData, error: listErr } = await supabase
    .from('competitor_ads')
    .select(COMPETITOR_AD_COLUMNS)
    .eq('entity_id', entity.id)
    .eq('owner_user_id', entity.owner_user_id)
    .overrideTypes<CompetitorAdRow[], { merge: false }>();
  if (listErr) throw new Error(`upsertObservedAds(list): ${listErr.message}`);
  const byRef = new Map((existingData ?? []).map((row) => [row.platform_ad_ref, row]));

  const rows: CompetitorAdRow[] = [];
  const toInsert: Array<Record<string, unknown>> = [];
  let updated = 0;

  // Dedupe within the batch itself (same ad pasted twice in one block).
  const seenRefs = new Set<string>();

  for (const ad of ads) {
    const ref = ad.ref ?? manualRef(ad.text);
    if (seenRefs.has(ref)) continue;
    seenRefs.add(ref);

    const existing = byRef.get(ref);
    if (existing) {
      const { data, error } = await supabase
        .from('competitor_ads')
        .update({
          active:    ad.still_active,
          last_seen: ad.still_active ? today : existing.last_seen,
        })
        .eq('id', existing.id)
        .select(COMPETITOR_AD_COLUMNS)
        .single()
        .overrideTypes<CompetitorAdRow, { merge: false }>();
      if (error) throw new Error(`upsertObservedAds(update ${ref}): ${error.message}`);
      rows.push(data);
      updated++;
      continue;
    }

    const first = ad.first_seen ?? today;
    toInsert.push({
      entity_id:       entity.id,
      client_id:       entity.client_id,
      owner_user_id:   entity.owner_user_id,
      platform_ad_ref: ref,
      first_seen:      first,
      last_seen:       ad.still_active ? today : first,
      active:          ad.still_active,
      creative: {
        text: ad.text,
        ...(ad.format      !== undefined ? { format: ad.format } : {}),
        ...(ad.platforms   !== undefined ? { platforms: ad.platforms } : {}),
        ...(ad.landing_url !== undefined ? { landing_url: ad.landing_url } : {}),
      },
      decoded: null,
    });
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('competitor_ads')
      .insert(toInsert)
      .select(COMPETITOR_AD_COLUMNS)
      .overrideTypes<CompetitorAdRow[], { merge: false }>();
    if (error) throw new Error(`upsertObservedAds(insert): ${error.message}`);
    rows.push(...(data ?? []));
  }

  return { inserted: toInsert.length, updated, rows };
}

/** List a client's observed competitor ads (optionally one entity's). */
export async function listAds(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  opts:        { entityId?: string } = {},
): Promise<CompetitorAdRow[]> {
  let q = supabase
    .from('competitor_ads')
    .select(COMPETITOR_AD_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (opts.entityId) q = q.eq('entity_id', opts.entityId);

  const { data, error } = await q
    .order('first_seen', { ascending: true })
    .overrideTypes<CompetitorAdRow[], { merge: false }>();
  if (error) throw new Error(`listAds: ${error.message}`);
  return data ?? [];
}

/** Stamp one ad's decoded jsonb (angle/awareness/offer/confidence). */
export async function updateAdDecoded(
  supabase: SupabaseClient,
  adId:     string,
  decoded:  AngleDecoding,
): Promise<CompetitorAdRow> {
  const { data, error } = await supabase
    .from('competitor_ads')
    .update({ decoded })
    .eq('id', adId)
    .select(COMPETITOR_AD_COLUMNS)
    .single()
    .overrideTypes<CompetitorAdRow, { merge: false }>();
  if (error) throw new Error(`updateAdDecoded: ${error.message}`);
  return data;
}

// ── atom emission (skill §6.2 output contract) ────────────────────────────────

/**
 * Patch an atom's structured jsonb directly + append the audit event.
 * lib/intelligence/insights only exposes confidence/status patches, so the
 * structured write is done here — but NEVER silently: every call logs an
 * insight_events row ('corroborated' is the closest event the events CHECK
 * allows for "fresh external evidence attached"; deltaConfidence 0 makes the
 * no-confidence-change explicit in the audit trail).
 */
async function updateInsightStructured(
  admin:   SupabaseClient,
  insight: Pick<ClientInsight, 'id' | 'client_id' | 'owner_user_id'>,
  structured: Record<string, unknown>,
  reason:  string,
): Promise<void> {
  const { error } = await admin
    .from('client_insights')
    .update({ structured, updated_at: new Date().toISOString() })
    .eq('id', insight.id)
    .select(INSIGHT_COLUMNS)
    .single();
  if (error) throw new Error(`updateInsightStructured: ${error.message}`);

  await logInsightEvent(admin, {
    insightId:       insight.id,
    clientId:        insight.client_id,
    ownerUserId:     insight.owner_user_id,
    event:           'corroborated',
    deltaConfidence: 0,
    reason,
  });
}

const RING_HE: Record<CompetitorRing, string> = {
  direct:          'מתחרה ישיר',
  category:        'חלופה קטגוריאלית',
  non_consumption: 'חלופת אי-צריכה',
};

const uniqueAngles = (ads: CompetitorAdRow[]): string[] => {
  const set = new Set<string>();
  for (const ad of ads) {
    const a = ad.decoded?.angle;
    if (typeof a === 'string' && a) set.add(a);
  }
  return [...set].sort();
};

export interface EmitAtomActionsInput {
  entities:  CompetitorEntityRow[];
  ads:       CompetitorAdRow[];
  map:       CoverageMap;
  ownAngles: OwnAngle[];
  now:       Date;
}

/**
 * The §6.2 atom actions:
 *  1. Per active entity with decoded ads — create/refresh its `alternative`
 *     atom (layer customers, kind alternative; free-form kinds are tolerated
 *     by the lifecycle). structured carries validated_angles (veteran-proven
 *     strengths), churned_angles (tried-and-dropped — their weaknesses/hard
 *     sells), running_angles; source_ref carries {competitor_watch, entity_id,
 *     ad_ids} so every claim is traceable to observed ads.
 *  2. Per own angle atom on the map — stamp structured.contested (+ the
 *     taxonomy_angle cache so future runs skip re-decoding) with an audit row.
 * Matching an entity to its existing atom goes through source_ref.entity_id —
 * exact, not fuzzy: entity ids are ours.
 */
export async function emitAtomActions(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  input:       EmitAtomActionsInput,
): Promise<AtomAction[]> {
  const actions: AtomAction[] = [];
  const nowIso = input.now.toISOString();

  const customerAtoms = await listActiveInsights(supabase, clientId, 'customers');
  const alternativeAtoms = customerAtoms.filter((a) => a.kind === 'alternative');

  // ── 1. alternative atoms per entity ─────────────────────────────────────────
  for (const entity of input.entities.filter((e) => e.active)) {
    const entityAds = input.ads.filter((ad) => ad.entity_id === entity.id && ad.decoded !== null);
    if (entityAds.length === 0) continue;

    const classified = classifyAds(entityAds, input.now);
    const validated  = uniqueAngles(classified.veterans);
    const churned    = uniqueAngles(classified.churned);
    const running    = uniqueAngles(entityAds.filter((ad) => ad.active));
    const adIds      = entityAds.map((ad) => ad.id);

    const structured: Record<string, unknown> = {
      competitor_watch: true,
      entity_id:        entity.id,
      ring:             entity.ring,
      // strengths = what the market already paid to validate at this entity;
      // weaknesses = what they tried and could not make work (skill §2.2/§2.3).
      strengths:        validated.map((angle) => ({ angle, evidence: 'veteran_ad' })),
      weaknesses:       churned.map((angle) => ({ angle, evidence: 'churned_ad' })),
      running_angles:   running,
      ad_ids:           adIds,
      last_watch_at:    nowIso,
    };

    const existing = alternativeAtoms.find(
      (a) => a.source_ref !== null && a.source_ref.entity_id === entity.id,
    );

    if (existing) {
      await updateInsightStructured(
        supabase,
        existing,
        { ...(existing.structured ?? {}), ...structured },
        `competitor watch: refreshed evidence from ${entityAds.length} observed ads (${validated.length} veteran-validated angles)`,
      );
      actions.push({
        action:     'updated',
        insight_id: existing.id,
        entity_id:  entity.id,
        reason:     'alternative atom refreshed from observed ads',
      });
    } else {
      const created = await createInsight(supabase, {
        clientId,
        ownerUserId,
        layer:   'customers',
        kind:    'alternative',
        content:
          `${RING_HE[entity.ring]}: ${entity.name} — זוויות שהשוק כבר וידא אצלו: ` +
          `${validated.length ? validated.join(', ') : 'אין עדיין מודעות ותיקות'}`,
        structured,
        source:     'ai_synthesis',
        sourceRef:  { competitor_watch: true, entity_id: entity.id, ad_ids: adIds },
        confidence: COMPETITOR_ATOM_CONFIDENCE,
      });
      actions.push({
        action:     'created',
        insight_id: created.id,
        entity_id:  entity.id,
        reason:     'new alternative atom for tracked competitor',
      });
    }
  }

  // ── 2. contested stamps on own angle atoms ──────────────────────────────────
  const bridgeAtoms = await listActiveInsights(supabase, clientId, 'bridge');
  for (const lane of input.map.angles) {
    const insightId = lane.own?.insight_id;
    if (!lane.own || insightId === undefined) continue;
    const atom = bridgeAtoms.find((a) => a.id === insightId);
    if (!atom) continue;

    await updateInsightStructured(
      supabase,
      atom,
      {
        ...(atom.structured ?? {}),
        taxonomy_angle:            lane.angle,
        contested:                 lane.own.contested,
        market_weight:             lane.market_weight,
        competitor_watch_flagged_at: nowIso,
      },
      `competitor watch: lane '${lane.angle}' is ${lane.market_weight} (contested=${lane.own.contested})`,
    );
    actions.push({
      action:     'flagged',
      insight_id: atom.id,
      angle:      lane.angle,
      reason:     `structured.contested=${lane.own.contested} (${lane.market_weight} lane)`,
    });
  }

  return actions;
}
