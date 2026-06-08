// Tests for the unified brief-code issuance core (app/api/briefs/code/issue.ts).
// Covers: code format, agency_name resolution, REQUIRED client_id with
// ownership validation, client_id passthrough, and the unique(code) retry path.
// Supabase is mocked.

import { describe, it, expect } from 'vitest';
import { issueBriefCode, generateBriefCode, BriefCodeError } from '@/app/api/briefs/code/issue';

// ── Mock Supabase ───────────────────────────────────────────────
// meta_clients: from('meta_clients').select('id').eq('id',_).eq('user_id',_).maybeSingle()
// users:        from('users').select('name').eq('id',_).maybeSingle()
// brief_codes:  from('brief_codes').insert(row).select('code, client_id').single()
//
// `ownedClients` lists client ids the user owns (drives the ownership check).
// `insertOutcomes` is consumed once per insert attempt; each entry is either
// { error } (failed attempt) or undefined (success, echoes the row back).
// All inserted rows are recorded on `_inserted` for assertions.
function makeSupabase(opts: {
  profileName?: string | null;          // undefined → users row absent
  ownedClients?: string[];              // client ids owned by the user
  insertOutcomes?: Array<{ error?: { code?: string; message?: string } } | undefined>;
}) {
  const inserted: any[] = [];
  const outcomes = [...(opts.insertOutcomes ?? [undefined])];
  const owned = opts.ownedClients ?? [];
  const supabase: any = {
    _inserted: inserted,
    from(table: string) {
      if (table === 'meta_clients') {
        const filters: any = {};
        const b: any = {
          select: () => b,
          eq: (col: string, val: any) => { filters[col] = val; return b; },
          maybeSingle: () =>
            Promise.resolve({ data: owned.includes(filters.id) ? { id: filters.id } : null }),
        };
        return b;
      }
      if (table === 'users') {
        const b: any = {
          select: () => b,
          eq: () => b,
          maybeSingle: () =>
            Promise.resolve({
              data: opts.profileName === undefined ? null : { name: opts.profileName },
            }),
        };
        return b;
      }
      if (table === 'brief_codes') {
        let row: any;
        const b: any = {
          insert: (r: any) => { row = r; inserted.push(r); return b; },
          select: () => b,
          single: () => {
            const outcome = outcomes.shift();
            if (outcome?.error) return Promise.resolve({ data: null, error: outcome.error });
            return Promise.resolve({
              data: { code: row.code, client_id: row.client_id ?? null },
              error: null,
            });
          },
        };
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return supabase;
}

const CLIENT = 'client-9';

describe('generateBriefCode', () => {
  it('produces an uppercase base-36 code of at most 6 chars', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBriefCode();
      expect(code).toMatch(/^[0-9A-Z]+$/);
      expect(code.length).toBeLessThanOrEqual(6);
      expect(code).toBe(code.toUpperCase());
    }
  });
});

describe('issueBriefCode', () => {
  it('returns a 6-char-style uppercase code from the default generator', async () => {
    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: [CLIENT] });
    const { code } = await issueBriefCode(supabase, 'user-1', CLIENT);
    expect(code).toMatch(/^[0-9A-Z]+$/);
    expect(code.length).toBeLessThanOrEqual(6);
  });

  it('resolves agency_name from users.name', async () => {
    const supabase = makeSupabase({ profileName: 'Acme Agency', ownedClients: [CLIENT] });
    await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' });
    expect(supabase._inserted[0]).toMatchObject({
      code: 'ABC123',
      user_id: 'user-1',
      agency_name: 'Acme Agency',
      client_id: CLIENT,
    });
  });

  it('sets agency_name to null when the users row has no name', async () => {
    const supabase = makeSupabase({ profileName: undefined, ownedClients: [CLIENT] });
    await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' });
    expect(supabase._inserted[0].agency_name).toBeNull();
  });

  it('includes the (required) client_id in the insert and result', async () => {
    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: [CLIENT] });
    const result = await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' });
    expect(supabase._inserted[0].client_id).toBe(CLIENT);
    expect(result.client_id).toBe(CLIENT);
  });

  it('rejects (400) when client_id is missing', async () => {
    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: [CLIENT] });
    await expect(
      issueBriefCode(supabase, 'user-1', null, { genCode: () => 'ABC123' }),
    ).rejects.toMatchObject({ status: 400 });
    // never reached the insert
    expect(supabase._inserted.length).toBe(0);
  });

  it('rejects (400) when client_id is not owned by the user', async () => {
    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: ['someone-elses-client'] });
    await expect(
      issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(supabase._inserted.length).toBe(0);
  });

  it('the rejection is a BriefCodeError (so the route maps it to 400)', async () => {
    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: [] });
    await expect(
      issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' }),
    ).rejects.toBeInstanceOf(BriefCodeError);
  });

  it('retries on unique(code) collisions and returns the first code that sticks', async () => {
    const codes = ['DUP001', 'DUP002', 'OK0003'];
    let i = 0;
    const supabase = makeSupabase({
      profileName: 'Acme',
      ownedClients: [CLIENT],
      insertOutcomes: [
        { error: { code: '23505' } }, // first code collides
        { error: { code: '23505' } }, // second code collides
        undefined,                    // third succeeds
      ],
    });
    const { code } = await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => codes[i++] });
    expect(code).toBe('OK0003');
    expect(supabase._inserted.map((r: any) => r.code)).toEqual(['DUP001', 'DUP002', 'OK0003']);
  });

  it('does NOT retry on non-unique errors — surfaces them immediately', async () => {
    const supabase = makeSupabase({
      profileName: 'Acme',
      ownedClients: [CLIENT],
      insertOutcomes: [{ error: { code: '42501', message: 'permission denied' } }],
    });
    await expect(
      issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' }),
    ).rejects.toThrow('permission denied');
    expect(supabase._inserted.length).toBe(1);
  });

  it('gives up after maxAttempts when every code collides', async () => {
    const supabase = makeSupabase({
      profileName: 'Acme',
      ownedClients: [CLIENT],
      insertOutcomes: [
        { error: { code: '23505' } },
        { error: { code: '23505' } },
        { error: { code: '23505' } },
      ],
    });
    await expect(
      issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'SAME11', maxAttempts: 3 }),
    ).rejects.toThrow(/unique brief code after 3 attempts/);
    expect(supabase._inserted.length).toBe(3);
  });
});
