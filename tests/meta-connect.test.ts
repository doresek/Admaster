// Tests for the session-less client-connect core (lib/meta-connect.ts).
// Covers: token format, the valid/expired/consumed/invalid predicate, and
// mintConnectLink (ownership check + unique-collision retry). Supabase mocked.
import { describe, it, expect } from 'vitest';
import {
  generateConnectToken,
  CONNECT_TOKEN_REGEX,
  connectLinkState,
  isConnectLinkUsable,
  mintConnectLink,
  lookupConnectClient,
  ConnectLinkError,
  CONNECT_LINK_TTL_MS,
} from '@/lib/meta-connect';

describe('connect token format', () => {
  it('generates 64 lowercase hex chars matching the regex', () => {
    for (let i = 0; i < 50; i++) {
      const t = generateConnectToken();
      expect(t).toMatch(CONNECT_TOKEN_REGEX);
      expect(t).toHaveLength(64);
    }
  });

  it('rejects malformed tokens', () => {
    expect(CONNECT_TOKEN_REGEX.test('')).toBe(false);
    expect(CONNECT_TOKEN_REGEX.test('XYZ')).toBe(false);
    expect(CONNECT_TOKEN_REGEX.test('A'.repeat(64))).toBe(false); // uppercase
    expect(CONNECT_TOKEN_REGEX.test('a'.repeat(63))).toBe(false); // too short
    expect(CONNECT_TOKEN_REGEX.test('a'.repeat(65))).toBe(false); // too long
    expect(CONNECT_TOKEN_REGEX.test('g'.repeat(64))).toBe(false); // non-hex
  });
});

describe('connectLinkState predicate', () => {
  const now = new Date('2026-06-29T12:00:00Z');
  const future = new Date(now.getTime() + 60_000).toISOString();
  const past = new Date(now.getTime() - 60_000).toISOString();

  it('is invalid for a missing row', () => {
    expect(connectLinkState(null, now)).toBe('invalid');
    expect(connectLinkState(undefined, now)).toBe('invalid');
    expect(isConnectLinkUsable(null, now)).toBe(false);
  });

  it('is valid when unconsumed and not yet expired', () => {
    const row = { connect_consumed_at: null, connect_expires_at: future };
    expect(connectLinkState(row, now)).toBe('valid');
    expect(isConnectLinkUsable(row, now)).toBe(true);
  });

  it('is expired when past expiry', () => {
    expect(connectLinkState({ connect_consumed_at: null, connect_expires_at: past }, now)).toBe('expired');
  });

  it('is expired at exactly the expiry instant (boundary is not usable)', () => {
    expect(connectLinkState({ connect_consumed_at: null, connect_expires_at: now.toISOString() }, now)).toBe('expired');
  });

  it('is expired when expiry is missing entirely', () => {
    expect(connectLinkState({ connect_consumed_at: null, connect_expires_at: null }, now)).toBe('expired');
  });

  it('is consumed even when still within expiry (single-use wins)', () => {
    const row = { connect_consumed_at: past, connect_expires_at: future };
    expect(connectLinkState(row, now)).toBe('consumed');
    expect(isConnectLinkUsable(row, now)).toBe(false);
  });

  it('is consumed even past expiry (consumed beats expired)', () => {
    expect(connectLinkState({ connect_consumed_at: past, connect_expires_at: past }, now)).toBe('consumed');
  });
});

// ── Mock Supabase for mintConnectLink + lookupConnectClient ──────────────────
function makeSupabase(opts: {
  ownedClients?: string[];
  updateOutcomes?: Array<{ error?: { code?: string; message?: string } } | undefined>;
  lookupRow?: any;
}) {
  const updates: any[] = [];
  const outcomes = [...(opts.updateOutcomes ?? [undefined])];
  const owned = opts.ownedClients ?? [];
  const supabase: any = {
    _updates: updates,
    from(table: string) {
      if (table !== 'meta_clients') throw new Error(`unexpected table ${table}`);
      const filters: any = {};
      let pending: any = null; // 'update' once update() is called
      const b: any = {
        select: () => b,
        update: (vals: any) => { pending = vals; return b; },
        eq: (col: string, val: any) => { filters[col] = val; return b; },
        maybeSingle: () => {
          // lookupConnectClient: by connect_token
          if (filters.connect_token !== undefined) {
            return Promise.resolve({ data: opts.lookupRow ?? null });
          }
          // ownership check: select id by id+user_id
          return Promise.resolve({ data: owned.includes(filters.id) ? { id: filters.id } : null });
        },
        single: () => {
          // update path
          updates.push({ filters: { ...filters }, vals: pending });
          const outcome = outcomes.shift();
          if (outcome?.error) return Promise.resolve({ data: null, error: outcome.error });
          return Promise.resolve({ data: { id: filters.id }, error: null });
        },
      };
      return b;
    },
  };
  return supabase;
}

describe('mintConnectLink', () => {
  it('throws 400 when client_id is missing', async () => {
    const sb = makeSupabase({});
    await expect(mintConnectLink(sb, 'u1', null)).rejects.toMatchObject({ status: 400 });
  });

  it('throws 404 when the client is not owned by the user', async () => {
    const sb = makeSupabase({ ownedClients: [] });
    await expect(mintConnectLink(sb, 'u1', 'c1')).rejects.toBeInstanceOf(ConnectLinkError);
    await expect(mintConnectLink(sb, 'u1', 'c1')).rejects.toMatchObject({ status: 404 });
  });

  it('mints a token, 72h expiry, and clears consumed on an owned client', async () => {
    const now = new Date('2026-06-29T00:00:00Z');
    const sb = makeSupabase({ ownedClients: ['c1'] });
    const out = await mintConnectLink(sb, 'u1', 'c1', { now });
    expect(out.client_id).toBe('c1');
    expect(out.token).toMatch(CONNECT_TOKEN_REGEX);
    expect(new Date(out.expires_at).getTime() - now.getTime()).toBe(CONNECT_LINK_TTL_MS);

    const writeVals = sb._updates[0].vals;
    expect(writeVals.connect_token).toBe(out.token);
    expect(writeVals.connect_consumed_at).toBeNull();
    expect(writeVals.connect_expires_at).toBe(out.expires_at);
  });

  it('retries on a 23505 unique collision, regenerating the token', async () => {
    const sb = makeSupabase({
      ownedClients: ['c1'],
      updateOutcomes: [{ error: { code: '23505' } }, undefined],
    });
    const out = await mintConnectLink(sb, 'u1', 'c1');
    expect(out.token).toMatch(CONNECT_TOKEN_REGEX);
    expect(sb._updates).toHaveLength(2);
    expect(sb._updates[0].vals.connect_token).not.toBe(sb._updates[1].vals.connect_token);
  });

  it('surfaces a non-23505 error immediately', async () => {
    const sb = makeSupabase({
      ownedClients: ['c1'],
      updateOutcomes: [{ error: { code: '42P01', message: 'boom' } }],
    });
    await expect(mintConnectLink(sb, 'u1', 'c1')).rejects.toThrow('boom');
  });

  it('gives up after maxAttempts collisions', async () => {
    const sb = makeSupabase({
      ownedClients: ['c1'],
      updateOutcomes: [
        { error: { code: '23505' } },
        { error: { code: '23505' } },
      ],
    });
    await expect(mintConnectLink(sb, 'u1', 'c1', { maxAttempts: 2 })).rejects.toThrow(/unique connect token/);
  });
});

describe('lookupConnectClient', () => {
  it('returns the row carrying the token', async () => {
    const row = { id: 'c1', name: 'Acme', user_id: 'u1', connect_consumed_at: null, connect_expires_at: 'x' };
    const sb = makeSupabase({ lookupRow: row });
    await expect(lookupConnectClient(sb, 'a'.repeat(64))).resolves.toEqual(row);
  });

  it('returns null when no row matches', async () => {
    const sb = makeSupabase({ lookupRow: null });
    await expect(lookupConnectClient(sb, 'a'.repeat(64))).resolves.toBeNull();
  });
});
