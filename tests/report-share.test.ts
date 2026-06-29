// Tests for the client-facing report SHARE-LINK core (W5.3a).
// Covers: share-token format + resolver regex; mint inserts a row with a
// 64-hex token + immutable snapshot (and ownership / validation / 23505 retry);
// resolver returns invalid for bad/unknown/expired tokens and a clean payload
// for a valid one. Supabase is mocked — no live DB (migration 025 may be
// unapplied in this worktree).
import { describe, it, expect } from 'vitest';
import {
  mintReportShare,
  generateShareToken,
  ReportShareError,
} from '@/app/api/reports/share/mint';
import {
  resolveReportShare,
  REPORT_TOKEN_REGEX,
} from '@/app/api/report/[token]/resolve';

const CLIENT = 'client-9';
const SNAPSHOT = { client: 'Acme', metrics: { spend: 1234 }, analysis: 'תקציר' };
const VALID_INPUT = {
  clientId: CLIENT,
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  report: SNAPSHOT,
};

// ── Mint mock ───────────────────────────────────────────────────
// clients: from('clients').select('id').eq('id',_).eq('owner_user_id',_).maybeSingle()
// report_shares: from('report_shares').insert(row).select('token').single()
function makeMintSupabase(opts: {
  ownedClients?: string[];
  insertOutcomes?: Array<{ error?: { code?: string; message?: string } } | undefined>;
}) {
  const inserted: any[] = [];
  const outcomes = [...(opts.insertOutcomes ?? [undefined])];
  const owned = opts.ownedClients ?? [];
  const supabase: any = {
    _inserted: inserted,
    from(table: string) {
      if (table === 'clients') {
        const filters: any = {};
        const b: any = {
          select: () => b,
          eq: (col: string, val: any) => { filters[col] = val; return b; },
          maybeSingle: () =>
            Promise.resolve({ data: owned.includes(filters.id) ? { id: filters.id } : null }),
        };
        return b;
      }
      if (table === 'report_shares') {
        let row: any;
        const b: any = {
          insert: (r: any) => { row = r; inserted.push(r); return b; },
          select: () => b,
          single: () => {
            const outcome = outcomes.shift();
            if (outcome?.error) return Promise.resolve({ data: null, error: outcome.error });
            return Promise.resolve({ data: { token: row.token }, error: null });
          },
        };
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return supabase;
}

// ── Resolve mock ────────────────────────────────────────────────
// report_shares: from('report_shares').select(...).eq('token',_).maybeSingle()
function makeResolveSupabase(rowByToken: Record<string, any>) {
  return {
    from(table: string) {
      if (table !== 'report_shares') throw new Error(`unexpected table ${table}`);
      const lookup: any = {};
      const b: any = {
        select: () => b,
        eq: (col: string, val: any) => { lookup.col = col; lookup.val = val; return b; },
        maybeSingle: () =>
          Promise.resolve({ data: rowByToken[lookup.val] ?? null, error: null }),
      };
      return b;
    },
  } as any;
}

const HEX64 = /^[a-f0-9]{64}$/;
const TOKEN_A = 'a'.repeat(64);

describe('generateShareToken / REPORT_TOKEN_REGEX', () => {
  it('produces a 64-char lowercase hex CSPRNG token with no collisions', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = generateShareToken();
      expect(t).toMatch(HEX64);
      expect(REPORT_TOKEN_REGEX.test(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(50);
  });

  it('the resolver regex rejects malformed tokens', () => {
    expect(REPORT_TOKEN_REGEX.test('nope')).toBe(false);
    expect(REPORT_TOKEN_REGEX.test('A'.repeat(64))).toBe(false); // uppercase
    expect(REPORT_TOKEN_REGEX.test('a'.repeat(63))).toBe(false); // too short
    expect(REPORT_TOKEN_REGEX.test(TOKEN_A)).toBe(true);
  });
});

describe('mintReportShare', () => {
  it('inserts a report_shares row with a 64-hex token + the snapshot', async () => {
    const supabase = makeMintSupabase({ ownedClients: [CLIENT] });
    const { token } = await mintReportShare(supabase, 'user-1', VALID_INPUT);
    expect(token).toMatch(HEX64);

    const row = supabase._inserted[0];
    expect(row.token).toBe(token);
    expect(row).toMatchObject({
      user_id: 'user-1',
      client_id: CLIENT,
      period_start: '2026-06-01',
      period_end: '2026-06-30',
      report: SNAPSHOT, // immutable snapshot stored at mint time
    });
    expect(typeof row.expires_at).toBe('string');
  });

  it('sets expires_at ~30 days out', async () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const supabase = makeMintSupabase({ ownedClients: [CLIENT] });
    await mintReportShare(supabase, 'user-1', VALID_INPUT, { now: () => now });
    const expiresAt = new Date(supabase._inserted[0].expires_at);
    const days = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);
  });

  it('rejects (400) when clientId is missing', async () => {
    const supabase = makeMintSupabase({ ownedClients: [CLIENT] });
    await expect(
      mintReportShare(supabase, 'user-1', { ...VALID_INPUT, clientId: null }),
    ).rejects.toMatchObject({ status: 400 });
    expect(supabase._inserted.length).toBe(0);
  });

  it('rejects (400) when the period is missing', async () => {
    const supabase = makeMintSupabase({ ownedClients: [CLIENT] });
    await expect(
      mintReportShare(supabase, 'user-1', { ...VALID_INPUT, periodEnd: null }),
    ).rejects.toMatchObject({ status: 400 });
    expect(supabase._inserted.length).toBe(0);
  });

  it('rejects (400) when the report snapshot is missing', async () => {
    const supabase = makeMintSupabase({ ownedClients: [CLIENT] });
    await expect(
      mintReportShare(supabase, 'user-1', { ...VALID_INPUT, report: null }),
    ).rejects.toMatchObject({ status: 400 });
    expect(supabase._inserted.length).toBe(0);
  });

  it('rejects (400, ReportShareError) when the client is not owned by the user', async () => {
    const supabase = makeMintSupabase({ ownedClients: ['someone-else'] });
    await expect(
      mintReportShare(supabase, 'user-1', VALID_INPUT),
    ).rejects.toBeInstanceOf(ReportShareError);
    expect(supabase._inserted.length).toBe(0);
  });

  it('retries on a unique(token) collision (23505) and returns the token that sticks', async () => {
    const supabase = makeMintSupabase({
      ownedClients: [CLIENT],
      insertOutcomes: [{ error: { code: '23505' } }, undefined],
    });
    const { token } = await mintReportShare(supabase, 'user-1', VALID_INPUT);
    expect(token).toMatch(HEX64);
    expect(supabase._inserted.length).toBe(2);
    // each attempt regenerates the token
    expect(supabase._inserted[0].token).not.toBe(supabase._inserted[1].token);
  });

  it('does NOT retry on non-unique errors — surfaces them immediately', async () => {
    const supabase = makeMintSupabase({
      ownedClients: [CLIENT],
      insertOutcomes: [{ error: { code: '42501', message: 'permission denied' } }],
    });
    await expect(
      mintReportShare(supabase, 'user-1', VALID_INPUT),
    ).rejects.toThrow('permission denied');
    expect(supabase._inserted.length).toBe(1);
  });
});

describe('resolveReportShare', () => {
  it('returns invalid for a malformed token (no DB hit)', async () => {
    const supabase = makeResolveSupabase({});
    expect(await resolveReportShare(supabase, 'not-a-token')).toEqual({ valid: false });
  });

  it('returns invalid for an unknown token', async () => {
    const supabase = makeResolveSupabase({});
    expect(await resolveReportShare(supabase, TOKEN_A)).toEqual({ valid: false });
  });

  it('returns expired for a token past its expires_at', async () => {
    const supabase = makeResolveSupabase({
      [TOKEN_A]: {
        client_id: CLIENT,
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        report: SNAPSHOT,
        expires_at: '2026-01-01T00:00:00.000Z',
        clients: { name: 'Acme' },
      },
    });
    const res = await resolveReportShare(supabase, TOKEN_A, { now: () => new Date('2026-06-29') });
    expect(res).toEqual({ valid: false, expired: true });
  });

  it('returns a clean payload (clientName from join) for a valid token', async () => {
    const supabase = makeResolveSupabase({
      [TOKEN_A]: {
        client_id: CLIENT,
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        report: SNAPSHOT,
        expires_at: '2026-12-31T00:00:00.000Z',
        clients: { name: 'Acme' },
      },
    });
    const res = await resolveReportShare(supabase, TOKEN_A, { now: () => new Date('2026-06-29') });
    expect(res).toEqual({
      valid: true,
      clientName: 'Acme',
      report: SNAPSHOT,
      period: { start: '2026-06-01', end: '2026-06-30' },
    });
  });

  it('treats a null expires_at as never-expiring, and handles array-shaped join', async () => {
    const supabase = makeResolveSupabase({
      [TOKEN_A]: {
        client_id: CLIENT,
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        report: SNAPSHOT,
        expires_at: null,
        clients: [{ name: 'Acme Array' }],
      },
    });
    const res = await resolveReportShare(supabase, TOKEN_A);
    expect(res.valid).toBe(true);
    expect(res.clientName).toBe('Acme Array');
  });
});
