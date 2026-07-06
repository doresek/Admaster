// Tests for GET /api/pulse — MOCKED Supabase + loader + fleet, no live DB.
//
// Proves the route contract: auth (401), param validation (400s), clients
// ownership (404, before any load), and the PAYLOAD COMPOSITION with the REAL
// metrics registry + REAL narration over a fixture MetricInputs bundle —
// so every number in the assertions is hand-math, not mock echo. Mode law:
// the owner payload physically excludes marketer-only keys and jargon.
// Degradation law: approvals/diagnoses/shock failures produce absent-with-note,
// never a non-200.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type {
  ChannelReconciliationRow,
  ClientEconomicsRow,
  FunnelLeadRow,
  LeadStageEventRow,
  ShockState,
} from '@/lib/capability-contracts';
import type { LoadMetricParams, LoadMetricResult, MetricCampaignRow } from '@/lib/metrics-layer';
import type { PulsePayload } from '@/app/api/pulse/shared';

const CLIENT = '11111111-1111-1111-1111-111111111111';

interface TableResult {
  data:  unknown;
  error: { message: string } | null;
}

interface RouteHarness {
  authUser:   { id: string } | null;
  owned:      { id: string } | null;
  approvals:  TableResult;
  diagnoses:  TableResult;
  loadCalls:  LoadMetricParams[];
  /** funnel rows the mocked loader slices into current/previous by period. */
  leads:         FunnelLeadRow[];
  stageEvents:   LeadStageEventRow[];
  campaigns:     MetricCampaignRow[];
  reconciliation: ChannelReconciliationRow[];
  economics:     ClientEconomicsRow | null;
  shockStates:   Record<string, ShockState>;
  shockThrows:   boolean;
  shockCalls:    Array<{ date: string; metric: string }>;
}

const CALM: ShockState = { shocked: false, factor: null, direction: null, note: 'no factor computed' };

const H = vi.hoisted((): RouteHarness => ({
  authUser:       { id: 'owner-1' },
  owned:          { id: '11111111-1111-1111-1111-111111111111' },
  approvals:      { data: [], error: null },
  diagnoses:      { data: [], error: null },
  loadCalls:      [],
  leads:          [],
  stageEvents:    [],
  campaigns:      [],
  reconciliation: [],
  economics:      null,
  shockStates:    {},
  shockThrows:    false,
  shockCalls:     [],
}));

// ── Supabase user client: auth + clients/approvals/diagnoses reads ────────────

interface QueryStub {
  select:      (cols?: string) => QueryStub;
  eq:          (col: string, val: unknown) => QueryStub;
  or:          (expr: string) => QueryStub;
  order:       (col: string, opts?: { ascending: boolean }) => QueryStub;
  limit:       (n: number) => Promise<TableResult>;
  maybeSingle: () => Promise<TableResult>;
}

function makeQuery(result: TableResult): QueryStub {
  const stub: QueryStub = {
    select:      () => stub,
    eq:          () => stub,
    or:          () => stub,
    order:       () => stub,
    limit:       async () => result,
    maybeSingle: async () => result,
  };
  return stub;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
    from: (table: string) => {
      if (table === 'clients')   return makeQuery({ data: H.owned, error: null });
      if (table === 'approvals') return makeQuery(H.approvals);
      if (table === 'diagnoses') return makeQuery(H.diagnoses);
      return makeQuery({ data: null, error: { message: `unexpected table ${table}` } });
    },
  }),
  createAdminClient: () => ({ admin: true }),
}));

// ── metrics loader: fixture rows sliced by the ROUTE-derived period ───────────
// The registry + computeMetrics + narration stay REAL — payload numbers below
// are real math over these rows.

vi.mock('@/lib/metrics-layer/load', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const shiftDays = (iso: string, days: number): string =>
    new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
  const previousPeriod = (period: { start: string; end: string }) => {
    const days = Math.round(
      (Date.parse(`${period.end}T00:00:00.000Z`) - Date.parse(`${period.start}T00:00:00.000Z`)) / DAY_MS,
    ) + 1;
    const prevEnd = shiftDays(period.start, -1);
    return { start: shiftDays(prevEnd, -(days - 1)), end: prevEnd };
  };
  const inPeriod = (createdAt: string, p: { start: string; end: string }): boolean =>
    createdAt >= p.start && createdAt < shiftDays(p.end, 1);

  const loadMetricInputs = async (
    _supabase: unknown,
    params:    LoadMetricParams,
  ): Promise<LoadMetricResult> => {
    H.loadCalls.push(params);
    const current  = { start: params.periodStart, end: params.periodEnd };
    const previous = previousPeriod(current);
    const slice = (p: { start: string; end: string }, campaigns: MetricCampaignRow[]) => ({
      period:         p,
      leads:          H.leads.filter((l) => inPeriod(l.created_at, p)),
      stageEvents:    H.stageEvents.filter((e) => inPeriod(e.created_at, p)),
      reconciliation: H.reconciliation,
      campaigns,
    });
    return {
      inputs: {
        current:   slice(current, H.campaigns),
        previous:  slice(previous, []),
        economics: H.economics,
      },
      warnings: [],
    };
  };
  return { loadMetricInputs, previousPeriod };
});

// ── fleet: getShockState per metric, throw-able ───────────────────────────────

vi.mock('@/lib/fleet', () => ({
  getShockState: async (_admin: unknown, date: string, metric: string): Promise<ShockState> => {
    if (H.shockThrows) throw new Error('fleet table unreachable');
    H.shockCalls.push({ date, metric });
    return H.shockStates[metric] ?? CALM;
  },
}));

import { GET } from '@/app/api/pulse/route';

// ── fixtures (dates pinned relative to "today" so any run date works) ────────

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number): string =>
  new Date(Date.parse(`${today}T12:00:00.000Z`) - n * 24 * 60 * 60 * 1000).toISOString();

const lead = (id: string, createdAt: string, over: Partial<FunnelLeadRow> = {}): FunnelLeadRow => ({
  id,
  client_id:           CLIENT,
  owner_user_id:       'owner-1',
  source:              'landing',
  source_ref:          {},
  name:                null,
  phone:               null,
  email:               null,
  consent_marketing:   false,
  consent_recorded_at: null,
  current_stage:       'new',
  value:               null,
  created_at:          createdAt,
  updated_at:          createdAt,
  ...over,
});

const wonEvent = (id: string, leadId: string, createdAt: string, value: number): LeadStageEventRow => ({
  id,
  lead_id:       leadId,
  client_id:     CLIENT,
  owner_user_id: 'owner-1',
  stage:         'closed_won',
  value,
  marked_via:    'ui',
  note:          null,
  created_at:    createdAt,
});

const liveCampaign: MetricCampaignRow = {
  id: 'camp-1', status: 'live', channel: 'meta', daily_budget: 10, dry_run: false,
  created_at: daysAgo(40),
};

const economics: ClientEconomicsRow = {
  id: 'econ-1', client_id: CLIENT, owner_user_id: 'owner-1',
  contribution_margin_pct: 50, avg_deal_value: 2000, close_rate_pct: 20,
  payback_target_months: 6, currency: 'ILS', source: 'owner',
  updated_at: daysAgo(1), created_at: daysAgo(1),
};

/** 4 current-period leads (1 qualified, 1 irrelevant), 2 previous-period. */
function seedSpine(): void {
  H.leads = [
    lead('l1', daysAgo(2), { current_stage: 'qualified' }),
    lead('l2', daysAgo(3), { current_stage: 'irrelevant' }),
    lead('l3', daysAgo(4)),
    lead('l4', daysAgo(5)),
    lead('p1', daysAgo(35)),
    lead('p2', daysAgo(36)),
  ];
  H.stageEvents = [wonEvent('e1', 'l1', daysAgo(1), 1000)];
  H.campaigns = [liveCampaign];
  H.economics = economics;
}

const req = (query: string) => new NextRequest(`http://test/api/pulse${query}`);

async function getPayload(query: string): Promise<PulsePayload> {
  const res = await GET(req(query));
  expect(res.status).toBe(200);
  const body: unknown = await res.json();
  // Documented test-stub cast: the shape is asserted field-by-field below.
  return body as PulsePayload;
}

beforeEach(() => {
  H.authUser       = { id: 'owner-1' };
  H.owned          = { id: CLIENT };
  H.approvals      = { data: [], error: null };
  H.diagnoses      = { data: [], error: null };
  H.loadCalls      = [];
  H.leads          = [];
  H.stageEvents    = [];
  H.campaigns      = [];
  H.reconciliation = [];
  H.economics      = null;
  H.shockStates    = {};
  H.shockThrows    = false;
  H.shockCalls     = [];
  seedSpine();
});

describe('GET /api/pulse — auth + validation', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    expect((await GET(req(`?clientId=${CLIENT}`))).status).toBe(401);
    expect(H.loadCalls).toEqual([]);
  });

  it('400s on a non-UUID clientId', async () => {
    expect((await GET(req('?clientId=nope'))).status).toBe(400);
  });

  it('400s on an unknown period or mode', async () => {
    expect((await GET(req(`?clientId=${CLIENT}&period=14d`))).status).toBe(400);
    expect((await GET(req(`?clientId=${CLIENT}&mode=admin`))).status).toBe(400);
  });

  it('404s when the client is not owned — nothing loaded', async () => {
    H.owned = null;
    expect((await GET(req(`?clientId=${CLIENT}`))).status).toBe(404);
    expect(H.loadCalls).toEqual([]);
  });
});

describe('GET /api/pulse — payload composition (real registry + narration)', () => {
  it('loads scoped to the AUTHED user with a 30d default period ending today', async () => {
    await getPayload(`?clientId=${CLIENT}`);
    expect(H.loadCalls.length).toBe(1);
    expect(H.loadCalls[0].ownerUserId).toBe('owner-1');
    expect(H.loadCalls[0].clientId).toBe(CLIENT);
    expect(H.loadCalls[0].periodEnd).toBe(today);
  });

  it('returns real hand-math metrics: 4 leads, ₪75/lead, worth-it 1.67', async () => {
    const p = await getPayload(`?clientId=${CLIENT}&period=30d`);
    const byKey = new Map(p.metrics.map((m) => [m.key, m]));
    expect(byKey.get('leads_total')?.value).toBe(4);
    // spend = 10 ₪/day × 30 days = 300; CPL = 300/4 = 75.
    expect(byKey.get('spend_total')?.value).toBe(300);
    expect(byKey.get('cost_per_lead')?.value).toBe(75);
    // ROAS 1000/300 = 3.33; break-even at 50% margin = 2 → ratio 1.67.
    expect(byKey.get('roas_vs_breakeven')?.value).toBe(1.67);
    // Story headline carries the same numbers (leap 1, no re-derivation).
    expect(p.story.headline_he).toContain('4 לידים');
    expect(p.story.headline_he).toContain('₪75 לליד');
    expect(p.story.headline_he).toContain('משתלם ✅');
  });

  it('honesty labels travel on the payload metrics (never stripped)', async () => {
    const p = await getPayload(`?clientId=${CLIENT}`);
    const cpl = p.metrics.find((m) => m.key === 'cost_per_lead');
    expect(cpl?.honesty_label).toBe('מבוסס קליקים');
    const spend = p.metrics.find((m) => m.key === 'spend_total');
    expect(spend?.honesty_label).toContain('תקציב מתוכנן');
  });

  it('OWNER mode: no marketer-only keys, no ROAS jargon in the narration', async () => {
    const p = await getPayload(`?clientId=${CLIENT}&mode=owner`);
    expect(p.mode).toBe('owner');
    expect(p.metrics.some((m) => m.key === 'reconciliation_ratio')).toBe(false);
    expect(p.narration_he).not.toContain('ROAS');
    expect(JSON.stringify(p.whys)).not.toContain('reconciliation_ratio');
  });

  it('MARKETER mode: all 12 registry keys present, null metrics carry reasons', async () => {
    H.campaigns = []; // no live spend → spend metrics null with reasons
    const p = await getPayload(`?clientId=${CLIENT}&mode=marketer`);
    expect(p.metrics.length).toBe(12);
    const spend = p.metrics.find((m) => m.key === 'spend_total');
    expect(spend?.value).toBeNull();
    expect(spend?.not_computable_reason).toContain('אין קמפיינים חיים');
  });

  it('sets Cache-Control: no-store and a generated_at timestamp', async () => {
    const res = await GET(req(`?clientId=${CLIENT}`));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body: unknown = await res.json();
    const p = body as PulsePayload; // documented test-stub cast
    expect(Number.isFinite(Date.parse(p.generated_at))).toBe(true);
    expect(p.period).toEqual({ start: H.loadCalls[0].periodStart, end: today, days: 30 });
  });
});

describe('GET /api/pulse — pending approvals (leap 6)', () => {
  it('maps pending approvals into the strip and the story line', async () => {
    H.approvals = {
      data: [
        { id: 'a1', title: 'אשר רענון קריאייטיב', created_at: daysAgo(1) },
        { id: 'a2', title: null, created_at: daysAgo(2) },
      ],
      error: null,
    };
    const p = await getPayload(`?clientId=${CLIENT}`);
    expect(p.pending.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(p.pending_note).toBeNull();
    expect(p.story.pending_he).toContain('2 פעולות');
    expect(p.story.pending_he).toContain('אשר רענון קריאייטיב');
  });

  it('approvals read failure → pending [] + Hebrew note + warning, still 200', async () => {
    H.approvals = { data: null, error: { message: 'permission denied' } };
    const p = await getPayload(`?clientId=${CLIENT}`);
    expect(p.pending).toEqual([]);
    expect(p.pending_note).not.toBeNull();
    expect(p.warnings.some((w) => w.includes('approvals read failed'))).toBe(true);
  });
});

describe('GET /api/pulse — diagnoses + whys (leap 3)', () => {
  it('caps diagnoses at the query result and maps them onto related metrics', async () => {
    H.diagnoses = {
      data: [
        { id: 'd1', rationale: 'הקריאייטיב התעייף', failed_link: 'creative', created_at: daysAgo(1) },
        { id: 'd2', rationale: 'הקהל רחב מדי', failed_link: 'audience', created_at: daysAgo(2) },
      ],
      error: null,
    };
    const p = await getPayload(`?clientId=${CLIENT}`);
    expect(p.diagnoses.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(p.whys.cost_per_lead?.diagnosis?.rationale).toBe('הקריאייטיב התעייף');
    expect(p.whys.qualified_rate?.diagnosis?.rationale).toBe('הקהל רחב מדי');
    // The narration's "why" section carries the rationales verbatim.
    expect(p.narration_he).toContain('הקריאייטיב התעייף');
  });

  it('diagnoses read failure (e.g. migration 030 absent) → empty + warning, 200', async () => {
    H.diagnoses = { data: null, error: { message: 'relation "diagnoses" does not exist' } };
    const p = await getPayload(`?clientId=${CLIENT}`);
    expect(p.diagnoses).toEqual([]);
    expect(p.whys.cost_per_lead?.diagnosis ?? null).toBeNull();
    expect(p.warnings.some((w) => w.includes('diagnoses read failed'))).toBe(true);
  });
});

describe('GET /api/pulse — C-04 shock state ("שוק, לא אתה")', () => {
  it('asks the fleet about all 4 metrics for the period end date', async () => {
    await getPayload(`?clientId=${CLIENT}`);
    expect(H.shockCalls.map((c) => c.metric).sort()).toEqual(['cpm', 'ctr', 'cvr', 'spend']);
    expect(H.shockCalls.every((c) => c.date === today)).toBe(true);
  });

  it('a shocked fleet metric produces the banner note + per-metric shock whys', async () => {
    H.shockStates = {
      cvr: { shocked: true, factor: -0.4, direction: 'down', note: 'יום זיכרון' },
    };
    const p = await getPayload(`?clientId=${CLIENT}`);
    expect(p.shock_note).toContain('שוק, לא אתה');
    expect(p.shock_note).toContain('יום זיכרון');
    expect(p.whys.leads_total?.shock?.direction).toBe('down');
    expect(p.whys.cost_per_lead?.shock?.note_he).toContain('שוק, לא אתה');
  });

  it('fleet failure degrades to calm-with-warning — the dashboard never breaks', async () => {
    H.shockThrows = true;
    const p = await getPayload(`?clientId=${CLIENT}`);
    expect(p.shock_note).toBeNull();
    expect(p.warnings.some((w) => w.includes('shock state unavailable'))).toBe(true);
  });
});
