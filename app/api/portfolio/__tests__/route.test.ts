// Route composition tests for GET /api/portfolio — vi.mock'd seams, following
// the command-center harness pattern:
//   • supabase server client — auth only (the route reads no tables itself);
//   • lib/clients.listClients + lib/attention.loadStatesForOwner — data seams;
//   • lib/metrics-layer.loadMetricInputs — replaced per-client; rankClients,
//     computeMetrics and the REAL registry run for real, so lanes/aggregates
//     are asserted against genuine attention + metric arithmetic.
//
// Contracts under test: auth (401) · lane assembly in attention-rank order ·
// STRICT owner boundary (a foreign client never appears, is never queried) ·
// per-client metric failure → partial, never a 500 · the 20-client metric cap.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientAttentionState, ErrorFlag, AnomalyFlag } from '@/lib/attention';
import type { MetricCampaignRow, MetricInputs, MetricPeriod } from '@/lib/metrics-layer';
import { periodDaysInclusive, previousPeriod } from '@/lib/metrics-layer';
import { makeLead } from '@/lib/metrics-layer/__tests__/fixtures';
import { METRIC_CLIENT_CAP } from '../shared';

// ── mutable mock state (hoisted so factories can close over it) ──────────────
// Typed via an explicit annotation (no casts) — type-only references inside
// vi.hoisted are erased at runtime, so hoisting stays safe.

interface MetricCfg { leadsNow: number; leadsPrev: number; budget: number | null }

interface Harness {
  user:       { id: string } | null;
  clients:    Array<{ id: string; name: string }>;
  states:     ClientAttentionState[];
  stateCalls: number;
  metricCfg:  Record<string, MetricCfg | { fail: string }>;
  loadCalls:  Array<{ clientId: string; ownerUserId: string; periodStart: string; periodEnd: string }>;
}

const H = vi.hoisted((): Harness => ({
  user:       { id: 'owner-1' },
  clients:    [],
  states:     [],
  stateCalls: 0,
  metricCfg:  {},
  loadCalls:  [],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
  }),
}));

vi.mock('@/lib/clients', () => ({
  listClients: async () => H.clients,
}));

vi.mock('@/lib/attention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/attention')>();
  return {
    ...actual,
    loadStatesForOwner: async () => { H.stateCalls += 1; return H.states; },
  };
});

vi.mock('@/lib/metrics-layer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/metrics-layer')>();
  return {
    ...actual,
    loadMetricInputs: async (
      _sb: unknown,
      params: { clientId: string; ownerUserId: string; periodStart: string; periodEnd: string },
    ) => {
      H.loadCalls.push({ ...params });
      const cfg = H.metricCfg[params.clientId] ?? { leadsNow: 0, leadsPrev: 0, budget: null };
      if ('fail' in cfg) throw new Error(cfg.fail);
      return { inputs: inputsFor(params, cfg), warnings: [] };
    },
  };
});

import { GET } from '@/app/api/portfolio/route';

// ── typed input fixtures (fed to the REAL computeMetrics + registry) ─────────

function leadsIn(period: MetricPeriod, clientId: string, n: number, tag: string) {
  return Array.from({ length: n }, (_, i) =>
    makeLead({ id: `${clientId}-${tag}-${i}`, client_id: clientId, created_at: `${period.start}T08:00:00Z` }));
}

function inputsFor(
  params: { clientId: string; periodStart: string; periodEnd: string },
  cfg:    MetricCfg,
): MetricInputs {
  const current: MetricPeriod = { start: params.periodStart, end: params.periodEnd };
  const previous = previousPeriod(current);
  const campaigns: MetricCampaignRow[] = cfg.budget !== null
    ? [{ id: `${params.clientId}-camp`, status: 'live', channel: 'meta_paid',
         daily_budget: cfg.budget, dry_run: false, created_at: `${current.start}T00:00:00Z` }]
    : [];
  return {
    current:  { period: current,  leads: leadsIn(current, params.clientId, cfg.leadsNow, 'cur'),
                stageEvents: [], reconciliation: [], campaigns },
    previous: { period: previous, leads: leadsIn(previous, params.clientId, cfg.leadsPrev, 'prev'),
                stageEvents: [], reconciliation: [], campaigns: [] },
    economics: null,
  };
}

function mkState(clientId: string, over: Partial<ClientAttentionState> = {}): ClientAttentionState {
  return {
    clientId,
    ownerUserId:     'owner-1',
    anomalyFlags:    [],
    openHypotheses:  [],
    staleness:       { daysSinceLastAtomEvent: 0, cadenceDays: 7 },
    calendar:        [],
    errorStates:     [],
    activeCampaigns: 0,
    ...over,
  };
}

const CONN_ERROR: ErrorFlag[]  = [{ kind: 'connection_error', severity: 'high' }];
const FRESH_LOW:  AnomalyFlag[] = [{ kind: 'ctr_cliff', severity: 'low', ageHours: 0 }];

beforeEach(() => {
  H.user       = { id: 'owner-1' };
  H.clients    = [];
  H.states     = [];
  H.stateCalls = 0;
  H.metricCfg  = {};
  H.loadCalls  = [];
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/portfolio — auth', () => {
  it('401s when unauthenticated', async () => {
    H.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('GET /api/portfolio — lane assembly over real ranking + real metrics', () => {
  beforeEach(() => {
    H.clients = [
      { id: 'c-err',   name: 'שגיאה בעמ' },
      { id: 'c-anom',  name: 'חריגה בעמ' },
      { id: 'c-crash', name: 'צניחה בעמ' },
      { id: 'c-ok',    name: 'רגוע בעמ' },
    ];
    H.states = [
      mkState('c-err',   { errorStates: CONN_ERROR }), // errors 0.85 → urgent
      mkState('c-anom',  { anomalyFlags: FRESH_LOW }), // anomaly ≈0.39 → watch
      mkState('c-crash'),                              // clean attention…
      mkState('c-ok'),
    ];
    H.metricCfg = {
      'c-err':   { leadsNow: 2, leadsPrev: 2,  budget: null },
      'c-anom':  { leadsNow: 4, leadsPrev: 4,  budget: 10 },
      'c-crash': { leadsNow: 5, leadsPrev: 10, budget: null }, // leads −50% → urgent
      'c-ok':    { leadsNow: 3, leadsPrev: 3,  budget: null },
    };
  });

  it('assembles the three lanes in attention-rank order', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Rank: c-err (.2125) > c-anom (~.1377) > c-crash = c-ok (0, id tiebreak).
    expect(body.lanes.urgent.map((s: { clientId: string }) => s.clientId)).toEqual(['c-err', 'c-crash']);
    expect(body.lanes.watch.map((s: { clientId: string }) => s.clientId)).toEqual(['c-anom']);
    expect(body.lanes.ok.map((s: { clientId: string }) => s.clientId)).toEqual(['c-ok']);
  });

  it('carries the top issue (Hebrew label + verbatim C-06 reason) and headline metric', async () => {
    const body = await (await GET()).json();
    const cErr = body.lanes.urgent[0];
    expect(cErr.top_issue.label_he).toBe('תקלה בצינור הנתונים');
    expect(cErr.top_issue.reason).toContain('connection error');
    const cCrash = body.lanes.urgent[1];
    expect(cCrash.headline_metric).toEqual({ leads: 5, delta_pct: -50 });
    expect(cCrash.partial).toBe(false);
  });

  it('aggregates: summed leads + delta, honesty-labeled planned spend, narration', async () => {
    const body = await (await GET()).json();
    expect(body.aggregates.leads_total).toBe(14);           // 2+4+5+3
    expect(body.aggregates.leads_prev).toBe(19);            // 2+4+10+3
    expect(body.aggregates.leads_delta_pct).toBe(-26.3);    // (14-19)/19, 1dp
    expect(body.aggregates.spend_total).toBe(70);           // ₪10/day × 7 days
    expect(body.aggregates.spend_honesty_label).toBe('תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה');
    expect(body.aggregates.lane_counts).toEqual({ urgent: 2, watch: 1, ok: 1 });
    expect(body.narration.headline_he).toContain('4 לקוחות');
    expect(body.narration.headline_he).toContain('הכי דחוף: שגיאה בעמ');
    expect(body.narration.text_he).toContain('תקציב מתוכנן');
  });

  it('scopes every metric load to the owner over a 7-day period', async () => {
    await GET();
    expect(H.loadCalls).toHaveLength(4);
    for (const call of H.loadCalls) {
      expect(call.ownerUserId).toBe('owner-1');
      expect(periodDaysInclusive({ start: call.periodStart, end: call.periodEnd })).toBe(7);
    }
  });
});

describe('GET /api/portfolio — strict owner boundary', () => {
  it('a state for a client the owner does not own NEVER appears and is never queried', async () => {
    H.clients = [{ id: 'c-mine', name: 'שלי' }];
    H.states = [
      mkState('c-mine'),
      mkState('foreign-1', { errorStates: CONN_ERROR }), // loud — must still vanish
    ];
    const res = await GET();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('foreign-1');
    expect(H.loadCalls.map((c) => c.clientId)).toEqual(['c-mine']);
    expect(body.aggregates.clients_total).toBe(1);
  });
});

describe('GET /api/portfolio — failure discipline', () => {
  it('one client\'s metric failure → that client is partial; the page payload survives', async () => {
    H.clients = [{ id: 'c-bad', name: 'תקול' }, { id: 'c-good', name: 'תקין' }];
    H.states = [mkState('c-bad'), mkState('c-good')];
    H.metricCfg = {
      'c-bad':  { fail: 'kaboom' },
      'c-good': { leadsNow: 6, leadsPrev: 6, budget: null },
    };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const all = [...body.lanes.urgent, ...body.lanes.watch, ...body.lanes.ok];
    const bad  = all.find((s: { clientId: string }) => s.clientId === 'c-bad');
    const good = all.find((s: { clientId: string }) => s.clientId === 'c-good');
    expect(bad).toMatchObject({ partial: true, headline_metric: null });
    expect(good).toMatchObject({ partial: false, headline_metric: { leads: 6, delta_pct: 0 } });
    expect(body.warnings.join(' ')).toContain('kaboom');
    expect(body.aggregates.leads_total).toBe(6); // only computed clients summed
  });
});

describe('GET /api/portfolio — empty portfolio', () => {
  it('zero clients → honest empty payload; the attention loader is not even called', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aggregates.clients_total).toBe(0);
    expect(body.lanes).toEqual({ urgent: [], watch: [], ok: [] });
    expect(body.narration.headline_he).toBe('אין עדיין לקוחות בתיק.');
    expect(H.stateCalls).toBe(0);
    expect(H.loadCalls).toHaveLength(0);
  });
});

describe('GET /api/portfolio — the documented metric cap', () => {
  it('caps per-client metric loads at 20; the rest render as partial, capped is flagged', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `c-${String(i).padStart(2, '0')}`);
    H.clients = ids.map((id) => ({ id, name: `לקוח ${id}` }));
    H.states = ids.map((id) => mkState(id));
    const res = await GET();
    const body = await res.json();
    // All score 0 → rank order = clientId asc; only the top 20 get metrics.
    expect(H.loadCalls).toHaveLength(METRIC_CLIENT_CAP);
    expect(H.loadCalls.map((c) => c.clientId)).toEqual(ids.slice(0, METRIC_CLIENT_CAP));
    expect(body.aggregates.metrics_capped).toBe(true);
    expect(body.aggregates.computed_clients).toBe(METRIC_CLIENT_CAP);
    const partials = body.lanes.ok.filter((s: { partial: boolean }) => s.partial);
    expect(partials.map((s: { clientId: string }) => s.clientId)).toEqual(ids.slice(METRIC_CLIENT_CAP));
  });
});
