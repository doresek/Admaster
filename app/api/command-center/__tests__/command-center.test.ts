// Unit tests for the Command Center API — MOCKED Supabase, no live DB.
//
// Asserts the three contract guarantees of these read-heavy routes:
//   1. Auth required (401 when unauthenticated).
//   2. Empty-safe when migration-030 tables are absent (no 500; empty payload).
//   3. grounded_in ids resolve → insight content+confidence so the UI shows WHY.
//   4. PATCH only flips status (pause/resume/approve), never spends.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock state, hoisted so the vi.mock factory can close over it.
const H = vi.hoisted(() => ({
  authUser: { id: 'owner-1' } as { id: string } | null,
  // Per-table behavior. Each entry returns { data, error } for the terminal op.
  tables: {} as Record<string, { rows?: any[]; error?: any }>,
  // Capture of the last campaigns.update() payload + filters (PATCH test).
  updatePayload: undefined as any,
  updateFilters: [] as Array<[string, any]>,
}));

const MISSING = { code: '42P01', message: 'relation "campaigns" does not exist' };

// A chainable query builder that records filters and resolves to the table's
// configured { data, error }. Supports .select/.eq/.in/.order/.update/.single
// and is awaitable (thenable) for the non-.single() reads.
function makeBuilder(table: string) {
  const cfg = H.tables[table] ?? { rows: [] };
  const result = { data: cfg.error ? null : (cfg.rows ?? []), error: cfg.error ?? null };
  const single = { data: cfg.error ? null : (cfg.rows?.[0] ?? null), error: cfg.error ?? null };

  let updated = false; // this builder chain is an .update() — echo the merged row
  const builder: any = {
    select: () => builder,
    order: () => builder,
    in: () => builder,
    eq: (col: string, val: any) => {
      if (table === 'campaigns' && H.updatePayload !== undefined) H.updateFilters.push([col, val]);
      return builder;
    },
    update: (p: any) => { H.updatePayload = p; updated = true; return builder; },
    single: async () =>
      updated && single.data
        ? { data: { ...single.data, ...H.updatePayload }, error: single.error }
        : single,
    then: (resolve: any) => resolve(result), // awaitable terminal
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
    from: (table: string) => makeBuilder(table),
  }),
}));

import { GET as getCampaigns } from '@/app/api/command-center/campaigns/route';
import { GET as getDiagnoses } from '@/app/api/command-center/diagnoses/route';
import { PATCH as patchCampaign } from '@/app/api/command-center/campaigns/[id]/route';

const patchReq = (body: any) => ({ json: async () => body }) as any;

beforeEach(() => {
  H.authUser = { id: 'owner-1' };
  H.tables = {};
  H.updatePayload = undefined;
  H.updateFilters = [];
});

describe('GET /api/command-center/campaigns', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await getCampaigns();
    expect(res.status).toBe(401);
  });

  it('is empty-safe when the campaigns table is absent (no 500)', async () => {
    H.tables = { campaigns: { error: MISSING } };
    const res = await getCampaigns();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.campaigns).toEqual([]);
  });

  it('returns empty when there are no campaigns', async () => {
    H.tables = { campaigns: { rows: [] } };
    const res = await getCampaigns();
    const data = await res.json();
    expect(data.campaigns).toEqual([]);
  });

  it('resolves grounded_in ids → insight content+confidence (the WHY)', async () => {
    H.tables = {
      campaigns: {
        rows: [{
          id: 'camp-1', status: 'active', channel: 'facebook', daily_budget: 120,
          funnel_stage: 'conversion', grounded_in: ['ins-1'], rationale: 'why-c',
          meta_campaign_id: 'm-1', dry_run: true,
        }],
      },
      campaign_items: {
        rows: [{ id: 'item-1', campaign_id: 'camp-1', item_type: 'ad', status: 'active', grounded_in: ['ins-2'], rationale: 'why-i', targeting_spec: { age: '25-45' } }],
      },
      campaign_decisions: {
        rows: [{ id: 'dec-1', campaign_id: 'camp-1', decision_type: 'budget', decision: 'raise', grounded_in: ['ins-1', 'ins-3'], rationale: 'why-d' }],
      },
      client_insights: {
        rows: [
          { id: 'ins-1', content: 'Audience converts on weekends', confidence: 0.82, layer: 'behavior' },
          { id: 'ins-2', content: 'High intent 25-45', confidence: 0.6, layer: 'demographic' },
          { id: 'ins-3', content: 'CPA trending down', confidence: 0.91, layer: 'performance' },
        ],
      },
    };
    const res = await getCampaigns();
    expect(res.status).toBe(200);
    const { campaigns } = await res.json();
    expect(campaigns).toHaveLength(1);

    const c = campaigns[0];
    // Campaign-level grounding resolved id → content+confidence.
    expect(c.grounded).toHaveLength(1);
    expect(c.grounded[0]).toMatchObject({ id: 'ins-1', content: 'Audience converts on weekends', confidence: 0.82 });
    // Items + decisions attached and resolved.
    expect(c.items[0].grounded[0].content).toBe('High intent 25-45');
    expect(c.decisions[0].grounded.map((g: any) => g.id)).toEqual(['ins-1', 'ins-3']);
    expect(c.dry_run).toBe(true);
  });

  it('still returns campaigns when client_insights table is absent (no WHY, no crash)', async () => {
    H.tables = {
      campaigns: { rows: [{ id: 'camp-1', status: 'active', grounded_in: ['ins-1'], dry_run: false }] },
      campaign_items: { rows: [] },
      campaign_decisions: { rows: [] },
      client_insights: { error: { code: 'PGRST205', message: 'Could not find the table' } },
    };
    const res = await getCampaigns();
    const { campaigns } = await res.json();
    expect(campaigns[0].grounded).toEqual([]);
  });
});

describe('GET /api/command-center/diagnoses', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await getDiagnoses();
    expect(res.status).toBe(401);
  });

  it('is empty-safe when the diagnoses table is absent', async () => {
    H.tables = { diagnoses: { error: { code: '42P01', message: 'relation "diagnoses" does not exist' } } };
    const res = await getDiagnoses();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.diagnoses).toEqual([]);
  });

  it('resolves target_insight_ids → insights', async () => {
    H.tables = {
      diagnoses: { rows: [{ id: 'dx-1', failed_link: 'landing→checkout', rationale: 'drop-off', target_insight_ids: ['ins-9'] }] },
      client_insights: { rows: [{ id: 'ins-9', content: 'Checkout friction', confidence: 0.7, layer: 'funnel' }] },
    };
    const res = await getDiagnoses();
    const { diagnoses } = await res.json();
    expect(diagnoses[0].failed_link).toBe('landing→checkout');
    expect(diagnoses[0].targets[0]).toMatchObject({ id: 'ins-9', content: 'Checkout friction' });
  });
});

describe('PATCH /api/command-center/campaigns/[id]', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await patchCampaign(patchReq({ action: 'pause' }), { params: Promise.resolve({ id: 'camp-1' }) });
    expect(res.status).toBe(401);
  });

  it('400s on an unknown action (no status written)', async () => {
    const res = await patchCampaign(patchReq({ action: 'delete' }), { params: Promise.resolve({ id: 'camp-1' }) });
    expect(res.status).toBe(400);
    expect(H.updatePayload).toBeUndefined();
  });

  // Actions map to REAL lifecycle states (campaigns.status CHECK / lib/campaigns/state.ts):
  // pause live→paused · resume paused→live · approve assembled→scheduled.
  it('pause (live) → status "paused", scoped to owner, never touches spend', async () => {
    H.tables = { campaigns: { rows: [{ id: 'camp-1', status: 'live', dry_run: true }] } };
    const res = await patchCampaign(patchReq({ action: 'pause' }), { params: Promise.resolve({ id: 'camp-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('paused');
    // Only the status column is written — nothing budget/spend related.
    expect(Object.keys(H.updatePayload)).toEqual(['status']);
    expect(H.updatePayload.status).toBe('paused');
    // Scoped to id + owner.
    expect(H.updateFilters).toContainEqual(['id', 'camp-1']);
    expect(H.updateFilters).toContainEqual(['owner_user_id', 'owner-1']);
  });

  it('approve (assembled) → status "scheduled" and keeps dry_run unchanged', async () => {
    H.tables = { campaigns: { rows: [{ id: 'camp-1', status: 'assembled', dry_run: true }] } };
    const res = await patchCampaign(patchReq({ action: 'approve' }), { params: Promise.resolve({ id: 'camp-1' }) });
    const data = await res.json();
    expect(data.status).toBe('scheduled');
    expect(data.dry_run).toBe(true); // approving a dry-run campaign stays dry-run
    expect(H.updatePayload.status).toBe('scheduled');
  });

  it('resume (paused) → status "live"', async () => {
    H.tables = { campaigns: { rows: [{ id: 'camp-1', status: 'paused', dry_run: false }] } };
    const res = await patchCampaign(patchReq({ action: 'resume' }), { params: Promise.resolve({ id: 'camp-1' }) });
    const data = await res.json();
    expect(data.status).toBe('live');
  });

  it('409s on an illegal transition (approve a live campaign) — no status written', async () => {
    H.tables = { campaigns: { rows: [{ id: 'camp-1', status: 'live', dry_run: false }] } };
    const res = await patchCampaign(patchReq({ action: 'approve' }), { params: Promise.resolve({ id: 'camp-1' }) });
    expect(res.status).toBe(409);
    expect(H.updatePayload).toBeUndefined();
  });

  it('404s when the campaigns table is absent', async () => {
    H.tables = { campaigns: { error: MISSING } };
    const res = await patchCampaign(patchReq({ action: 'pause' }), { params: Promise.resolve({ id: 'camp-1' }) });
    expect(res.status).toBe(404);
  });
});
