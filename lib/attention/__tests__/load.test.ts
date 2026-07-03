// Tests for lib/attention/load.ts — batched state assembly (C-06).
//
// The stub below implements the AttentionDb seam directly (no casts) and
// COUNTS queries per table: the N+1 guard asserts exactly one query per table
// for a multi-client owner, which is the module's hard scaling requirement.
import { describe, it, expect } from 'vitest';
import type {
  AttentionDb,
  AttentionQueryResult,
  AttentionSelectBuilder,
} from '@/lib/attention/load';
import { loadClientState, loadStatesForOwner, parseSeasonalityAtom } from '@/lib/attention/load';

// ── In-memory stub of the AttentionDb seam ────────────────────────────────────

type StubRow = Record<string, unknown>;

function makeStubDb(tables: Record<string, StubRow[]>, failTable?: string) {
  const queryCounts: Record<string, number> = {};

  const db: AttentionDb = {
    from(table: string) {
      queryCounts[table] = (queryCounts[table] ?? 0) + 1;
      return {
        select(_columns: string): AttentionSelectBuilder {
          const predicates: Array<(row: StubRow) => boolean> = [];
          const run = (): AttentionQueryResult => {
            if (table === failTable) return { data: null, error: { message: `boom:${table}` } };
            const rows = (tables[table] ?? []).filter((r) => predicates.every((p) => p(r)));
            return { data: rows, error: null };
          };
          const builder: AttentionSelectBuilder = {
            eq(column: string, value: string) {
              predicates.push((r) => r[column] === value);
              return builder;
            },
            in(column: string, values: readonly string[]) {
              predicates.push((r) => values.some((v) => v === r[column]));
              return builder;
            },
            then<X>(onfulfilled: (response: AttentionQueryResult) => X | PromiseLike<X>): Promise<X> {
              return Promise.resolve(run()).then(onfulfilled);
            },
          };
          return builder;
        },
      };
    },
  };

  return { db, queryCounts };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-03T00:00:00Z');
const OWNER = 'u1';

const hypRow = (over: StubRow = {}): StubRow => ({
  id: 'h1', client_id: 'c1', owner_user_id: OWNER,
  insight_ids: ['a1', 'a2', 'a3'],
  claim: 'urgency angle beats status angle',
  prediction: { metric: 'ctr', comparator: 'ratio_gte', value: 1.3, arm: 'A', confidence: 0.7 },
  floor_spec: { metric_grade: 'ctr', per_arm: { impressions: 4000 } },
  horizon: { max_days: 14 },
  verdict_map: { supported: [], refuted: [], inconclusive: [] },
  kill_rules: {},
  test_refs: [{ arm_label: 'A' }],
  domain: 'angle', status: 'open', resolution: null,
  registered_at: 't0', resolved_at: null, superseded_by: null,
  created_at: 't0', updated_at: 't0',
  ...over,
});

const seasonalityRow = (over: StubRow = {}): StubRow => ({
  client_id: 'c1', owner_user_id: OWNER, kind: 'seasonality', status: 'active',
  content: 'wedding season is booked in winter',
  confidence: 0.8,
  structured: { window: { iso_start: '2026-08-02', iso_end: '2026-08-20' }, decision_lag: 45 },
  ...over,
});

function threeClientFleet(): Record<string, StubRow[]> {
  return {
    clients: [
      { id: 'c1', owner_user_id: OWNER },
      { id: 'c2', owner_user_id: OWNER },
      { id: 'c3', owner_user_id: OWNER },
      { id: 'cx', owner_user_id: 'other-owner' }, // must not leak into the fleet
    ],
    hypotheses: [
      hypRow(),
      hypRow({ id: 'h2', client_id: 'c2', domain: 'creative', insight_ids: ['b1', 'b2'] }),
      hypRow({ id: 'h3', client_id: 'c1', status: 'supported' }), // resolved → filtered by the query
    ],
    insight_events: [
      { client_id: 'c1', owner_user_id: OWNER, created_at: '2026-07-01T00:00:00Z' },
      { client_id: 'c1', owner_user_id: OWNER, created_at: '2026-06-01T00:00:00Z' }, // older — must lose
      { client_id: 'c2', owner_user_id: OWNER, created_at: '2026-06-12T00:00:00Z' },
      // c3 has NO events → never analyzed
    ],
    client_insights: [seasonalityRow()],
    campaigns: [
      { client_id: 'c1', owner_user_id: OWNER, status: 'live' },
      { client_id: 'c1', owner_user_id: OWNER, status: 'scheduled' },
      { client_id: 'c1', owner_user_id: OWNER, status: 'completed' }, // inactive → excluded
      { client_id: 'c2', owner_user_id: OWNER, status: 'publishing' },
    ],
  };
}

// ── N+1 guard ─────────────────────────────────────────────────────────────────

describe('loadStatesForOwner — the N+1 guard', () => {
  it('issues EXACTLY one query per table for a 3-client owner', async () => {
    const { db, queryCounts } = makeStubDb(threeClientFleet());
    const states = await loadStatesForOwner(db, OWNER, { now: NOW });

    expect(states).toHaveLength(3);
    expect(queryCounts).toEqual({
      clients:         1,
      hypotheses:      1,
      insight_events:  1,
      client_insights: 1,
      campaigns:       1,
    });
  });

  it('empty fleet → [] (and no ledger queries at all)', async () => {
    const { db, queryCounts } = makeStubDb({ clients: [] });
    const states = await loadStatesForOwner(db, OWNER, { now: NOW });
    expect(states).toEqual([]);
    expect(queryCounts).toEqual({ clients: 1 });
  });
});

// ── Assembly correctness ──────────────────────────────────────────────────────

describe('loadStatesForOwner — grouping and derivation', () => {
  it('assembles each client from its own rows only, owner-scoped', async () => {
    const { db } = makeStubDb(threeClientFleet());
    const states = await loadStatesForOwner(db, OWNER, { now: NOW });
    const byId = new Map(states.map((s) => [s.clientId, s]));

    const c1 = byId.get('c1');
    const c2 = byId.get('c2');
    const c3 = byId.get('c3');
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c3).toBeDefined();
    expect(byId.has('cx')).toBe(false); // other owner's client never loaded
    if (!c1 || !c2 || !c3) return;

    // Open hypotheses: c1's resolved row is filtered out by the status=open query.
    expect(c1.openHypotheses.map((h) => h.hypothesis.id)).toEqual(['h1']);
    expect(c2.openHypotheses.map((h) => h.hypothesis.id)).toEqual(['h2']);
    expect(c3.openHypotheses).toEqual([]);

    // Staleness: max created_at wins; c3 has no events → null ("never analyzed").
    expect(c1.staleness.daysSinceLastAtomEvent).toBeCloseTo(2, 5);
    expect(c2.staleness.daysSinceLastAtomEvent).toBeCloseTo(21, 5);
    expect(c3.staleness.daysSinceLastAtomEvent).toBeNull();
    expect(c1.staleness.cadenceDays).toBe(7); // DEFAULT_CADENCE_DAYS

    // Active campaigns: 'completed' excluded by the status .in() filter.
    expect(c1.activeCampaigns).toBe(2);
    expect(c2.activeCampaigns).toBe(1);
    expect(c3.activeCampaigns).toBe(0);

    // Anomalies are empty today (C-05 pending) — the shape is forward-compatible.
    expect(c1.anomalyFlags).toEqual([]);
  });

  it('decisionWeight = max(1, atom count) × domain multiplier (angle 1.5, other 1.0)', async () => {
    const { db } = makeStubDb({
      clients: [{ id: 'c1', owner_user_id: OWNER }],
      hypotheses: [
        hypRow({ id: 'h-angle', insight_ids: ['a', 'b', 'c'], domain: 'angle' }),
        hypRow({ id: 'h-creative', insight_ids: ['a', 'b'], domain: 'creative' }),
        hypRow({ id: 'h-bare', insight_ids: [], domain: 'timing' }),
      ],
    });
    const [state] = await loadStatesForOwner(db, OWNER, { now: NOW });
    const weightOf = (id: string) =>
      state.openHypotheses.find((h) => h.hypothesis.id === id)?.decisionWeight;

    expect(weightOf('h-angle')).toBeCloseTo(4.5, 5);    // 3 atoms × 1.5
    expect(weightOf('h-creative')).toBeCloseTo(2, 5);   // 2 atoms × 1.0
    expect(weightOf('h-bare')).toBeCloseTo(1, 5);       // floor: unblocks its own verdict
  });

  it('sampleProgress: 0 when unknown, injected observation wins when provided', async () => {
    const tables = {
      clients: [{ id: 'c1', owner_user_id: OWNER }],
      hypotheses: [hypRow({ id: 'h1' }), hypRow({ id: 'h2' })],
    };

    const bare = await loadStatesForOwner(makeStubDb(tables).db, OWNER, { now: NOW });
    expect(bare[0].openHypotheses.map((h) => h.sampleProgress)).toEqual([0, 0]);

    const observed = await loadStatesForOwner(makeStubDb(tables).db, OWNER, {
      now: NOW,
      observations: { h1: 0.85, h2: NaN }, // non-finite observation → still unknown → 0
    });
    const progressOf = (id: string) =>
      observed[0].openHypotheses.find((h) => h.hypothesis.id === id)?.sampleProgress;
    expect(progressOf('h1')).toBe(0.85);
    expect(progressOf('h2')).toBe(0);
  });

  it('errorStates are empty by default and populated from the injected flags', async () => {
    const tables = { clients: [{ id: 'c1', owner_user_id: OWNER }] };

    const bare = await loadStatesForOwner(makeStubDb(tables).db, OWNER, { now: NOW });
    expect(bare[0].errorStates).toEqual([]);

    const flagged = await loadStatesForOwner(makeStubDb(tables).db, OWNER, {
      now: NOW,
      errorFlags: { c1: [{ kind: 'meta_token_expiring', severity: 'high' }] },
    });
    expect(flagged[0].errorStates).toEqual([{ kind: 'meta_token_expiring', severity: 'high' }]);
  });
});

// ── Calendar parsing ──────────────────────────────────────────────────────────

describe('seasonality atoms → CalendarProximity', () => {
  it('iso window ahead: correct day count, decision_lag passed through, confidence carried', async () => {
    const { db } = makeStubDb({
      clients: [{ id: 'c1', owner_user_id: OWNER }],
      client_insights: [seasonalityRow()],
    });
    const [state] = await loadStatesForOwner(db, OWNER, { now: NOW });

    expect(state.calendar).toHaveLength(1);
    const [c] = state.calendar;
    expect(c.daysUntilWindow).toBe(30);      // 2026-07-03 → 2026-08-02
    expect(c.decisionLagDays).toBe(45);      // the URGENT-NOW case: 30 − 45 < 0
    expect(c.relevanceConfidence).toBeCloseTo(0.8, 5);
    expect(c.windowLabel).toContain('wedding season');
  });

  it('month window: inside → 0 days; ahead → exact days; past → rolls to next year', async () => {
    const { db } = makeStubDb({
      clients: [{ id: 'c1', owner_user_id: OWNER }],
      client_insights: [
        seasonalityRow({ content: 'summer', structured: { window: { month_start: 6, month_end: 8 } } }),
        seasonalityRow({ content: 'tishrei', structured: { window: { month_start: 9, month_end: 10 } } }),
        seasonalityRow({ content: 'pre-pesach', structured: { window: { month_start: 2, month_end: 3 } } }),
      ],
    });
    const [state] = await loadStatesForOwner(db, OWNER, { now: NOW });
    const byLabel = new Map(state.calendar.map((c) => [c.windowLabel, c.daysUntilWindow]));

    expect(byLabel.get('summer')).toBe(0);        // Jun–Aug: we are inside it on Jul 3
    expect(byLabel.get('tishrei')).toBe(60);      // Jul 3 → Sep 1
    expect(byLabel.get('pre-pesach')).toBe(213);  // Feb–Mar is over → next Feb 1
  });

  it('malformed seasonality payloads are skipped without throwing', async () => {
    const { db } = makeStubDb({
      clients: [{ id: 'c1', owner_user_id: OWNER }],
      client_insights: [
        seasonalityRow({ structured: null }),
        seasonalityRow({ structured: {} }),                                     // no window
        seasonalityRow({ structured: { window: 'September' } }),                // window not an object
        seasonalityRow({ structured: { window: { month_start: 13, month_end: 2 } } }),
        seasonalityRow({ structured: { window: { month_start: 1.5, month_end: 2 } } }),
        seasonalityRow({ structured: { window: { iso_start: 'garbage', iso_end: 'also' } } }),
        seasonalityRow({ structured: { window: { iso_start: '2026-01-01', iso_end: '2026-02-01' } } }), // one-shot, passed
        seasonalityRow({ confidence: 'high' }),                                 // fails the row guard
      ],
    });
    const [state] = await loadStatesForOwner(db, OWNER, { now: NOW });
    expect(state.calendar).toEqual([]);
  });

  it('parseSeasonalityAtom: december-wrap window spans the year boundary', () => {
    const c = parseSeasonalityAtom(
      {
        client_id: 'c1', content: 'chanukah-to-january', confidence: 0.7,
        structured: { window: { month_start: 12, month_end: 1 } },
      },
      NOW,
    );
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.daysUntilWindow).toBe(151); // 2026-07-03 → 2026-12-01
  });
});

// ── Single-client loader + error propagation ──────────────────────────────────

describe('loadClientState', () => {
  it('loads one client with the same batched plan (no clients-table query)', async () => {
    const { db, queryCounts } = makeStubDb(threeClientFleet());
    const state = await loadClientState(db, 'c1', OWNER, { now: NOW });

    expect(state.clientId).toBe('c1');
    expect(state.openHypotheses.map((h) => h.hypothesis.id)).toEqual(['h1']);
    expect(state.activeCampaigns).toBe(2);
    expect(queryCounts).toEqual({
      hypotheses:      1,
      insight_events:  1,
      client_insights: 1,
      campaigns:       1,
    });
  });

  it('a client with no rows anywhere still yields a complete state (never analyzed)', async () => {
    const { db } = makeStubDb({});
    const state = await loadClientState(db, 'c-new', OWNER, { now: NOW });
    expect(state.staleness.daysSinceLastAtomEvent).toBeNull();
    expect(state.openHypotheses).toEqual([]);
    expect(state.calendar).toEqual([]);
    expect(state.errorStates).toEqual([]);
    expect(state.activeCampaigns).toBe(0);
  });
});

describe('supabase error handling', () => {
  it('a failed ledger query throws with the table named — never a silent partial state', async () => {
    for (const failTable of ['hypotheses', 'insight_events', 'client_insights', 'campaigns']) {
      const { db } = makeStubDb(threeClientFleet(), failTable);
      await expect(loadStatesForOwner(db, OWNER, { now: NOW })).rejects.toThrow(
        `boom:${failTable}`,
      );
    }
  });

  it('a failed clients query throws too', async () => {
    const { db } = makeStubDb(threeClientFleet(), 'clients');
    await expect(loadStatesForOwner(db, OWNER, { now: NOW })).rejects.toThrow('boom:clients');
  });
});
