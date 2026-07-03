// Store behavior: the ~5-entity cap (skill §1 noise rule), the longevity
// invariant (first_seen stable, last_seen moves), idempotent re-paste, and
// AUDITED atom emission through lib/intelligence.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInsight } from '@/lib/intelligence/insights';
import { buildCoverageMap } from '../analyze';
import { parsePastedAds } from '../fetcher';
import {
  COMPETITOR_ATOM_CONFIDENCE,
  MAX_ACTIVE_ENTITIES,
  emitAtomActions,
  listAds,
  setEntityActive,
  upsertEntity,
  upsertObservedAds,
} from '../store';
import { CLIENT_ID, DENTAL_ADS, E1, NOW, OWNER_ID, makeAd, makeEntity } from './fixtures';
import { mockSupabase, type SupabaseMock } from './mock-supabase';

// Spy on createInsight while KEEPING the real implementation (it runs against
// the in-memory mock DB, so both the call args and the resulting rows +
// insight_events audit trail are assertable).
vi.mock('@/lib/intelligence/insights', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/intelligence/insights')>();
  return { ...actual, createInsight: vi.fn(actual.createInsight) };
});

let db: SupabaseMock;
beforeEach(() => {
  db = mockSupabase();
  vi.mocked(createInsight).mockClear();
});

const seedEntities = (n: number): void => {
  db.seed(
    'competitor_entities',
    Array.from({ length: n }, (_, i) => ({
      ...makeEntity({ id: `ent-${i}`, name: `מתחרה ${i}` }),
    })),
  );
};

describe('upsertEntity — the tracking cap', () => {
  it('creates a new entity (default ring direct, active)', async () => {
    const res = await upsertEntity(db.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, name: 'מרפאת ד"ר כהן',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.created).toBe(true);
      expect(res.entity).toMatchObject({ name: 'מרפאת ד"ר כהן', ring: 'direct', active: true });
    }
  });

  it(`REJECTS a ${MAX_ACTIVE_ENTITIES + 1}th active entity, naming which to deactivate`, async () => {
    seedEntities(MAX_ACTIVE_ENTITIES);
    const res = await upsertEntity(db.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, name: 'מתחרה שישי',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('cap_exceeded');
      expect(res.active_entities).toHaveLength(MAX_ACTIVE_ENTITIES);
      expect(res.message).toContain('מתחרה 0');
    }
    // nothing was inserted
    expect(db.rows('competitor_entities')).toHaveLength(MAX_ACTIVE_ENTITIES);
  });

  it('updating an ALREADY-ACTIVE entity at the cap is allowed (no new slot taken)', async () => {
    seedEntities(MAX_ACTIVE_ENTITIES);
    const res = await upsertEntity(db.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, name: 'מתחרה 2', ring: 'category',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entity.ring).toBe('category');
  });

  it('deactivation always succeeds; REACTIVATION is cap-checked', async () => {
    seedEntities(MAX_ACTIVE_ENTITIES);
    const off = await setEntityActive(db.client, CLIENT_ID, OWNER_ID, 'ent-0', false);
    expect(off.ok).toBe(true);

    // 4 active now → reactivating is fine…
    const on = await setEntityActive(db.client, CLIENT_ID, OWNER_ID, 'ent-0', true);
    expect(on.ok).toBe(true);

    // …but a 6th entity trying to activate while 5 are active is rejected.
    db.rows('competitor_entities').push({ ...makeEntity({ id: 'ent-6', name: 'מתחרה 6', active: false }) });
    const blocked = await setEntityActive(db.client, CLIENT_ID, OWNER_ID, 'ent-6', true);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('cap_exceeded');
  });

  it('setEntityActive on an unknown/foreign entity → not_found', async () => {
    const res = await setEntityActive(db.client, CLIENT_ID, OWNER_ID, 'ent-nope', false);
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

describe('upsertObservedAds — the longevity tracker', () => {
  it('inserts new observations (first_seen defaults to today; inactive paste → last_seen = first_seen)', async () => {
    const res = await upsertObservedAds(db.client, E1, [
      { ref: 'lib:111', text: 'מודעה פעילה', still_active: true },
      { ref: 'lib:222', text: 'מודעה מתה', first_seen: '2026-05-01', still_active: false },
    ], NOW);
    expect(res.inserted).toBe(2);
    expect(res.updated).toBe(0);
    const rows = db.rows('competitor_ads');
    expect(rows.find((r) => r.platform_ad_ref === 'lib:111')).toMatchObject({
      first_seen: '2026-07-01', last_seen: '2026-07-01', active: true,
      client_id: CLIENT_ID, owner_user_id: OWNER_ID, entity_id: E1.id,
    });
    expect(rows.find((r) => r.platform_ad_ref === 'lib:222')).toMatchObject({
      first_seen: '2026-05-01', last_seen: '2026-05-01', active: false,
    });
  });

  it('re-observation moves last_seen/active but NEVER first_seen (the §2 age inference depends on it)', async () => {
    db.seed('competitor_ads', [
      { ...makeAd({ id: 'ad-x', entity_id: E1.id, first_seen: '2026-03-01', last_seen: '2026-06-01', platform_ad_ref: 'lib:111' }) },
    ]);
    const res = await upsertObservedAds(db.client, E1, [
      { ref: 'lib:111', text: 'אותה מודעה', first_seen: '2026-06-30', still_active: true },
    ], NOW);
    expect(res).toMatchObject({ inserted: 0, updated: 1 });
    expect(db.rows('competitor_ads')[0]).toMatchObject({
      first_seen: '2026-03-01',   // untouched despite the observation claiming otherwise
      last_seen:  '2026-07-01',   // moved to today — seen running now
      active:     true,
    });
  });

  it('an inactive observation flips active off WITHOUT bumping last_seen (not a sighting)', async () => {
    db.seed('competitor_ads', [
      { ...makeAd({ id: 'ad-x', entity_id: E1.id, first_seen: '2026-03-01', last_seen: '2026-06-01', platform_ad_ref: 'lib:111' }) },
    ]);
    await upsertObservedAds(db.client, E1, [{ ref: 'lib:111', text: 'אותה מודעה', still_active: false }], NOW);
    expect(db.rows('competitor_ads')[0]).toMatchObject({ active: false, last_seen: '2026-06-01' });
  });

  it('re-pasting the SAME paste is idempotent: same hashes → same refs → zero inserts', async () => {
    const paste = 'השתלת שיניים ב-12 תשלומים\n\nיישור שקוף — בדיקה חינם';
    const first = await upsertObservedAds(db.client, E1, parsePastedAds(paste), NOW);
    expect(first).toMatchObject({ inserted: 2, updated: 0 });

    const second = await upsertObservedAds(db.client, E1, parsePastedAds(paste), NOW);
    expect(second).toMatchObject({ inserted: 0, updated: 2 });
    expect(db.rows('competitor_ads')).toHaveLength(2);
  });

  it('dedupes the same ad WITHIN one batch', async () => {
    const res = await upsertObservedAds(db.client, E1, [
      { text: 'אותה מודעה בדיוק', still_active: true },
      { text: 'אותה   מודעה בדיוק', still_active: true }, // whitespace → same manual ref
    ], NOW);
    expect(res.inserted).toBe(1);
  });

  it('propagates DB errors instead of swallowing them', async () => {
    db.failOn.add('insert:competitor_ads');
    await expect(
      upsertObservedAds(db.client, E1, [{ text: 'מודעה', still_active: true }], NOW),
    ).rejects.toThrow(/forced failure/);
  });
});

describe('emitAtomActions — audited atom emission (skill §6.2)', () => {
  it('creates an alternative atom per entity with source_ref evidence + a created audit event', async () => {
    const ads = DENTAL_ADS.filter((a) => a.entity_id === E1.id);
    db.seed('competitor_ads', ads.map((a) => ({ ...a })));

    const map = buildCoverageMap([E1], ads, [], NOW);
    const actions = await emitAtomActions(db.client, CLIENT_ID, OWNER_ID, {
      entities: [E1], ads, map, ownAngles: [], now: NOW,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: 'created', entity_id: E1.id });

    // createInsight args: the source_ref carries traceable evidence.
    expect(vi.mocked(createInsight)).toHaveBeenCalledOnce();
    const input = vi.mocked(createInsight).mock.calls[0][1];
    expect(input).toMatchObject({
      clientId:    CLIENT_ID,
      ownerUserId: OWNER_ID,
      layer:       'customers',
      kind:        'alternative',
      source:      'ai_synthesis',
      confidence:  COMPETITOR_ATOM_CONFIDENCE,
    });
    expect(input.sourceRef).toMatchObject({ competitor_watch: true, entity_id: E1.id });
    expect(input.sourceRef).toHaveProperty('ad_ids', ['ad-1', 'ad-2', 'ad-3']);
    // structured: veteran-validated strengths (2 price veterans → one angle)
    expect(input.structured).toMatchObject({
      strengths:      [{ angle: 'price_deal', evidence: 'veteran_ad' }],
      running_angles: ['price_deal', 'proof_results'],
    });
    expect(input.content).toContain(E1.name);

    // the atom row + its audit trail exist
    expect(db.rows('client_insights')).toHaveLength(1);
    const events = db.rows('insight_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'created' });
  });

  it('REFRESHES an existing alternative atom (matched by source_ref.entity_id) with a corroborated audit event', async () => {
    const ads = DENTAL_ADS.filter((a) => a.entity_id === E1.id);
    db.seed('client_insights', [{
      id: 'atom-alt-1', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      layer: 'customers', kind: 'alternative', content: 'מתחרה ישיר: מרפאת שיניים ד"ר כהן',
      structured: { competitor_watch: true, entity_id: E1.id, strengths: [] },
      source: 'ai_synthesis', source_ref: { competitor_watch: true, entity_id: E1.id },
      confidence: 0.6, evidence_count: 1, status: 'active',
      superseded_by: null, superseded_reason: null,
      first_seen_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    }]);

    const map = buildCoverageMap([E1], ads, [], NOW);
    const actions = await emitAtomActions(db.client, CLIENT_ID, OWNER_ID, {
      entities: [E1], ads, map, ownAngles: [], now: NOW,
    });

    expect(actions).toEqual([expect.objectContaining({ action: 'updated', insight_id: 'atom-alt-1' })]);
    expect(vi.mocked(createInsight)).not.toHaveBeenCalled(); // no duplicate atom
    expect(db.rows('client_insights')).toHaveLength(1);
    expect(db.rows('client_insights')[0].structured).toMatchObject({
      strengths: [{ angle: 'price_deal', evidence: 'veteran_ad' }],
    });
    // AUDIT EVERYTHING: the structured refresh logged an event
    const events = db.rows('insight_events');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ insight_id: 'atom-alt-1', event: 'corroborated', delta_confidence: 0 });
  });

  it('stamps structured.contested (+ taxonomy_angle cache) on own angle atoms, with an audit event', async () => {
    db.seed('client_insights', [{
      id: 'atom-price', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      layer: 'bridge', kind: 'angle', content: 'זווית מחיר: 12 תשלומים ללא ריבית',
      structured: null, source: 'brief', source_ref: null,
      confidence: 0.8, evidence_count: 2, status: 'active',
      superseded_by: null, superseded_reason: null,
      first_seen_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    }]);

    const ads = DENTAL_ADS.filter((a) => a.entity_id === E1.id);
    const ownAngles = [{ angle: 'price_deal', atomConfidence: 0.8, insightId: 'atom-price' }] as const;
    const map = buildCoverageMap([E1], ads, [...ownAngles], NOW);

    const actions = await emitAtomActions(db.client, CLIENT_ID, OWNER_ID, {
      entities: [{ ...E1, active: true }], ads: [], map, ownAngles: [...ownAngles], now: NOW,
    });

    const flagged = actions.find((a) => a.action === 'flagged');
    expect(flagged).toMatchObject({ insight_id: 'atom-price', angle: 'price_deal' });
    expect(db.rows('client_insights')[0].structured).toMatchObject({
      taxonomy_angle: 'price_deal',
      contested:      true,          // E1 has veteran price ads → heavy in the lane
      market_weight:  'contested',   // one heavy entity
    });
    expect(db.rows('insight_events')[0]).toMatchObject({ insight_id: 'atom-price', event: 'corroborated' });
  });
});
