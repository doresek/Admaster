// Tests for POST /api/briefs/submit — the public brief-submission endpoint.
//
// Focus: a business owner must be able to RE-SUBMIT / update their brief. The
// unique constraint briefs_client_uniq (one brief per client_id) stays; the
// route therefore UPSERTs on conflict(client_id) so a second submit UPDATES the
// existing row instead of erroring with a duplicate key. Every submit re-runs
// the 3-layer analysis with force: true (the orchestrator's idempotency guard
// would otherwise skip a re-submit because core_generated_at can be newer than
// the reused brief row).
//
// Supabase, rate-limit, journey, brief-v2 gate and the orchestrator are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  briefsStore: [] as any[],            // simulated briefs table (unique on client_id)
  upsertCalls: [] as Array<{ row: any; opts: any }>,
  insertCalls: [] as any[],
  orchestratorCalls: [] as any[],
  idSeq: 0,
  rlOk: true,
  requiredOk: true,
  // brief_codes resolution result (token/code lookup).
  briefCode: { code: 'ABC123', user_id: 'user-1', client_id: 'client-1' } as any,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ ok: H.rlOk, retryAfter: 1 }),
}));

vi.mock('@/lib/journey', () => ({
  advanceJourneyOnBrief: vi.fn(async () => {}),
}));

vi.mock('@/lib/brief-v2', () => ({
  allRequiredSatisfied: () => H.requiredOk,
}));

vi.mock('@/lib/client-core/orchestrator', () => ({
  orchestrateClientCore: vi.fn(async (_admin: any, opts: any) => {
    H.orchestratorCalls.push(opts);
    return { analysis: true, avatar: true };
  }),
}));

// Admin Supabase mock. `briefs` is backed by an in-memory store keyed by
// client_id so an UPSERT updates the existing row (mirroring the unique
// constraint) instead of throwing a duplicate-key error.
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === 'brief_codes') {
        const b: any = {
          select: () => b,
          eq: () => b,
          single: async () => ({
            data: H.briefCode,
            error: H.briefCode ? null : { message: 'not found' },
          }),
        };
        return b;
      }
      if (table === 'briefs') {
        let mode: 'upsert' | 'insert' | null = null;
        let payload: any;
        const b: any = {
          upsert: (row: any, opts: any) => {
            mode = 'upsert';
            payload = row;
            H.upsertCalls.push({ row, opts });
            return b;
          },
          insert: (row: any) => {
            mode = 'insert';
            payload = row;
            H.insertCalls.push(row);
            return b;
          },
          select: () => b,
          single: async () => {
            if (mode === 'upsert') {
              const existing = H.briefsStore.find((r) => r.client_id === payload.client_id);
              if (existing) {
                Object.assign(existing, payload); // UPDATE in place — no duplicate-key error
                return { data: pick(existing), error: null };
              }
              const row = { id: `brief-${++H.idSeq}`, ...payload };
              H.briefsStore.push(row);
              return { data: pick(row), error: null };
            }
            // plain insert (client_id === null edge)
            const row = { id: `brief-${++H.idSeq}`, ...payload };
            H.briefsStore.push(row);
            return { data: pick(row), error: null };
          },
        };
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

function pick(r: any) {
  return { id: r.id, client_id: r.client_id, user_id: r.user_id };
}

import { POST } from '@/app/api/briefs/submit/route';

const req = (body: any) =>
  ({
    headers: { get: () => null },
    json: async () => body,
  }) as any;

beforeEach(() => {
  H.briefsStore = [];
  H.upsertCalls = [];
  H.insertCalls = [];
  H.orchestratorCalls = [];
  H.idSeq = 0;
  H.rlOk = true;
  H.requiredOk = true;
  H.briefCode = { code: 'ABC123', user_id: 'user-1', client_id: 'client-1' };
});

describe('POST /api/briefs/submit — first submit', () => {
  it('inserts via upsert, returns { success, id }, and triggers the orchestrator with force:true', async () => {
    const res = await POST(req({ code: 'ABC123', values: { biz_what: 'pizza' } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, id: 'brief-1' });

    // Upsert path, with the client_id conflict target.
    expect(H.upsertCalls.length).toBe(1);
    expect(H.insertCalls.length).toBe(0);
    expect(H.upsertCalls[0].opts).toEqual({ onConflict: 'client_id' });
    expect(H.upsertCalls[0].row).toMatchObject({
      client_id: 'client-1',
      code: 'ABC123',
      user_id: 'user-1',
      status: 'new',
      values: { biz_what: 'pizza' },
    });
    expect(typeof H.upsertCalls[0].row.updated_at).toBe('string');

    // One row in the table, brain re-run forced.
    expect(H.briefsStore.length).toBe(1);
    expect(H.orchestratorCalls).toEqual([
      { userId: 'user-1', clientId: 'client-1', briefId: 'brief-1', force: true },
    ]);
  });
});

describe('POST /api/briefs/submit — re-submit for the same client', () => {
  it('updates the existing brief (no duplicate-key error) and re-runs the brain with force:true', async () => {
    // First submit.
    const r1 = await POST(req({ code: 'ABC123', values: { biz_what: 'pizza' } }));
    expect((await r1.json()).success).toBe(true);

    // Second submit for the SAME client_id — must UPDATE, not collide.
    const r2 = await POST(req({ code: 'ABC123', values: { biz_what: 'sushi' } }));
    const b2 = await r2.json();

    expect(r2.status).toBe(200);
    expect(b2.success).toBe(true);

    // Still exactly one brief row for the client — it was updated in place.
    expect(H.briefsStore.length).toBe(1);
    expect(H.briefsStore[0].values).toEqual({ biz_what: 'sushi' });
    expect(b2.id).toBe('brief-1'); // same row id reused

    // Both submits went through the upsert path; no plain insert, no error.
    expect(H.upsertCalls.length).toBe(2);
    expect(H.insertCalls.length).toBe(0);

    // The re-submit re-ran the orchestrator with force:true on the same brief.
    expect(H.orchestratorCalls.length).toBe(2);
    expect(H.orchestratorCalls[1]).toEqual({
      userId: 'user-1',
      clientId: 'client-1',
      briefId: 'brief-1',
      force: true,
    });
  });
});

describe('POST /api/briefs/submit — client_id null edge', () => {
  it('falls back to a plain insert (no conflict target) and skips the orchestrator', async () => {
    H.briefCode = { code: 'NOCLIENT', user_id: 'user-1', client_id: null };

    const res = await POST(req({ code: 'NOCLIENT', values: { biz_what: 'pizza' } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    expect(H.insertCalls.length).toBe(1);
    expect(H.upsertCalls.length).toBe(0);
    expect(H.insertCalls[0]).toMatchObject({ client_id: null, code: 'NOCLIENT', status: 'new' });

    // No client_id → orchestrator is not triggered.
    expect(H.orchestratorCalls.length).toBe(0);
  });
});
