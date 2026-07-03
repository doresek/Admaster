// End-to-end watch runs over the in-memory DB: FixtureFetcher + a mock LLM
// that decodes by keyword. Proves the full pipeline (fetch → upsert → decode
// → analyze → atom actions), per-entity failure isolation, and second-run
// idempotency.

import { beforeEach, describe, expect, it } from 'vitest';
import type { CompetitorEntityRow } from '@/lib/capability-contracts';
import type { LlmComplete } from '../decode';
import { FixtureFetcher, type AdSourceFetcher } from '../fetcher';
import { runWatch } from '../run-watch';
import type { FetchResult, RawObservedAd } from '../types';
import { CLIENT_ID, E1, E2, E3, NOW, OWNER_ID } from './fixtures';
import { mockSupabase, type SupabaseMock } from './mock-supabase';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keyword decoder standing in for the LLM — reads the fenced items JSON out
 *  of the real prompt and answers in the real output schema. */
const angleFor = (text: string): string =>
  text.includes('בלי כאב') ? 'emotional_safety'
  : text.includes('נותרו') ? 'urgency_scarcity'
  : text.includes('תשלומים') || text.includes('מחיר') ? 'price_deal'
  : text.includes('מהבית') ? 'speed_convenience'
  : 'proof_results';

const mockLlm: LlmComplete = {
  complete(prompt: string): Promise<string> {
    const m = /<<<UNTRUSTED_COMPETITOR_ADS\n([\s\S]*?)\n>>>/.exec(prompt);
    const parsed: unknown = JSON.parse(m ? m[1] : '[]');
    const items = Array.isArray(parsed) ? parsed : [];
    const out = items.flatMap((it) => {
      if (!isRecord(it) || typeof it.id !== 'string' || typeof it.text !== 'string') return [];
      return [{ id: it.id, angle: angleFor(it.text), awareness: 'solution_aware', offer: 'הצעה', confidence: 0.8 }];
    });
    return Promise.resolve(JSON.stringify({ items: out }));
  },
};

const brokenLlm: LlmComplete = {
  complete: () => Promise.reject(new Error('provider unavailable')),
};

/** The observed market, as a fixture fetch (NOW = 2026-07-01):
 *  E1 — a 122d price veteran + a 6d proof ad
 *  E2 — a 77d price veteran + a dead urgency ad (churn)
 *  E3 — a 21d speed ad (light) */
const FIXTURE_ADS: Record<string, RawObservedAd[]> = {
  [E1.id]: [
    { ref: 'lib:e1-price', text: 'השתלת שיניים ב-12 תשלומים ללא ריבית', first_seen: '2026-03-01', still_active: true },
    { ref: 'lib:e1-proof', text: 'לפני ואחרי — 743 חיוכים השנה', first_seen: '2026-06-25', still_active: true },
  ],
  [E2.id]: [
    { ref: 'lib:e2-price', text: 'מתחייבים למחיר הזול בעיר', first_seen: '2026-04-15', still_active: true },
    { ref: 'lib:e2-urgency', text: 'נותרו 3 מקומות אחרונים למבצע!', first_seen: '2026-05-01', still_active: false },
  ],
  [E3.id]: [
    { ref: 'lib:e3-speed', text: 'סריקה מהבית ותוכנית תוך 48 שעות', first_seen: '2026-06-10', still_active: true },
  ],
};

let db: SupabaseMock;
beforeEach(() => {
  db = mockSupabase();
  db.seed('competitor_entities', [E1, E2, E3].map((e) => ({ ...e })));
  db.seed('client_insights', [
    {
      // own price angle, ALREADY stamped with a taxonomy angle (decode cache)
      id: 'atom-price', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      layer: 'bridge', kind: 'angle', content: 'זווית מחיר: 12 תשלומים ללא ריבית',
      structured: { taxonomy_angle: 'price_deal' }, source: 'brief', source_ref: null,
      confidence: 0.8, evidence_count: 2, status: 'active',
      superseded_by: null, superseded_reason: null,
      first_seen_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    },
    {
      // own emotional-safety angle, NOT yet projected — needs the LLM
      id: 'atom-emsafe', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      layer: 'bridge', kind: 'angle', content: 'טיפול בלי כאב וללא לחץ — יחס אישי',
      structured: null, source: 'brief', source_ref: null,
      confidence: 0.72, evidence_count: 1, status: 'active',
      superseded_by: null, superseded_reason: null,
      first_seen_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    },
  ]);
});

const opts = { clientId: CLIENT_ID, ownerUserId: OWNER_ID, now: NOW };

describe('runWatch — full pipeline', () => {
  it('fetches, stores, decodes, maps, flags and emits atoms end to end', async () => {
    const result = await runWatch(db.client, mockLlm, new FixtureFetcher(FIXTURE_ADS), opts);

    expect(result.errors).toEqual([]);
    expect(result.decode_dropped).toEqual([]);

    // stored + decoded: 5 ads, all stamped
    const ads = db.rows('competitor_ads');
    expect(ads).toHaveLength(5);
    expect(ads.every((a) => a.decoded !== null)).toBe(true);
    expect(result.decoded_count).toBe(5);

    // the map reproduces the craft reading: saturated price, open lanes
    const price = result.map.angles.find((a) => a.angle === 'price_deal');
    expect(price?.market_weight).toBe('saturated'); // veterans at E1 + E2
    const em = result.map.angles.find((a) => a.angle === 'emotional_safety');
    expect(em?.market_weight).toBe('open');
    expect(em?.open_lane).toEqual({ has_supporting_atom: true, churn_evidence: false });

    expect(result.flags.map((f) => `${f.kind}:${f.angle}`).sort()).toEqual([
      'open_lane_hypothesis:urgency_scarcity',
      'open_lane_priority:emotional_safety',
      'saturated_warning:price_deal',
    ]);

    // atom actions: an alternative atom per entity + contested stamps on both own angles
    const kinds = result.atomActions.map((a) => a.action).sort();
    expect(kinds).toEqual(['created', 'created', 'created', 'flagged', 'flagged']);
    const flaggedIds = result.atomActions.filter((a) => a.action === 'flagged').map((a) => a.insight_id).sort();
    expect(flaggedIds).toEqual(['atom-emsafe', 'atom-price']);

    // the emotional-safety atom got its taxonomy cache stamped (no LLM next run)
    const emAtom = db.rows('client_insights').find((r) => r.id === 'atom-emsafe');
    expect(emAtom?.structured).toMatchObject({ taxonomy_angle: 'emotional_safety', contested: false });

    // delta from an empty previous state: the two already-old ads are new veterans
    expect(result.delta.new_veterans.map((v) => v.platform_ad_ref).sort()).toEqual(['lib:e1-price', 'lib:e2-price']);
    expect(result.delta.bursts).toEqual([]); // max 2 new refs per entity < 3
  });

  it('a second identical run is idempotent: no new rows, atoms refreshed not duplicated', async () => {
    await runWatch(db.client, mockLlm, new FixtureFetcher(FIXTURE_ADS), opts);
    const second = await runWatch(db.client, mockLlm, new FixtureFetcher(FIXTURE_ADS), opts);

    expect(db.rows('competitor_ads')).toHaveLength(5);           // upsert, not append
    const alternatives = db.rows('client_insights').filter((r) => r.kind === 'alternative');
    expect(alternatives).toHaveLength(3);                        // one per entity, refreshed
    expect(second.atomActions.map((a) => a.action).sort()).toEqual([
      'flagged', 'flagged', 'updated', 'updated', 'updated',
    ]);
    expect(second.decoded_count).toBe(0);                        // nothing left to decode
    expect(second.delta.new_veterans).toEqual([]);               // no re-reporting
    expect(second.errors).toEqual([]);
  });
});

describe('runWatch — failure isolation', () => {
  it('a fetch failure on ONE entity is collected; the others still land', async () => {
    const inner = new FixtureFetcher(FIXTURE_ADS);
    const flaky: AdSourceFetcher = {
      fetch(entity: CompetitorEntityRow): Promise<FetchResult> {
        if (entity.id === E2.id) return Promise.reject(new Error('page wall'));
        return inner.fetch(entity);
      },
    };

    const result = await runWatch(db.client, mockLlm, flaky, opts);

    expect(result.errors).toEqual([{ stage: 'fetch', entity_id: E2.id, error: 'page wall' }]);
    // E1 + E3 progressed: 3 ads stored and decoded
    expect(db.rows('competitor_ads')).toHaveLength(3);
    expect(result.decoded_count).toBe(3);
    // analysis still produced a map and flags from what survived
    expect(result.map.angles.length).toBeGreaterThan(0);
    expect(result.atomActions.some((a) => a.action === 'created')).toBe(true);
  });

  it('an LLM outage is a typed decode error: observations persist undecoded, run completes', async () => {
    const result = await runWatch(db.client, brokenLlm, new FixtureFetcher(FIXTURE_ADS), opts);

    expect(result.errors.some((e) => e.stage === 'decode' && e.error === 'provider unavailable')).toBe(true);
    // the longevity data is SAFE — next run decodes it
    const ads = db.rows('competitor_ads');
    expect(ads).toHaveLength(5);
    expect(ads.every((a) => a.decoded === null)).toBe(true);
    expect(result.decoded_count).toBe(0);
    // no decoded ads → no alternative atoms fabricated
    expect(result.atomActions.filter((a) => a.action === 'created')).toEqual([]);
  });
});
