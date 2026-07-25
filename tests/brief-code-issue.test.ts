// Tests for the unified brief-code issuance core (app/api/briefs/code/issue.ts).
// Covers: code format, agency_name resolution, REQUIRED client_id with
// ownership validation, client_id passthrough, and the unique(code) retry path.
// Supabase is mocked.

import { describe, it, expect } from 'vitest';
import { issueBriefCode, generateBriefCode, generateBriefToken, BriefCodeError } from '@/app/api/briefs/code/issue';

// ── Mock Supabase ───────────────────────────────────────────────
// meta_clients: from('meta_clients').select('id').eq('id',_).eq('user_id',_).maybeSingle()
// users:        from('users').select('name').eq('id',_).maybeSingle()
// brief_codes:  from('brief_codes').insert(row).select(...).single()  (write)
//               from('brief_codes').select(...).eq(...).maybeSingle() (read)
//
// Faithfulness notes (these mirror the LIVE DB and are what makes the
// per-client-uniqueness bug reproducible here):
//   * `_inserted` records every insert ATTEMPT (for assertions), but lookups
//     read only PERSISTED rows (`_stored`) — a failed insert never becomes
//     visible, exactly like Postgres.
//   * brief_codes carries UNIQUE(client_id) (`brief_codes_client_uniq`): a
//     second insert for a non-null client_id already present fails with 23505.
//   * `existingRows` seeds already-persisted rows (drives idempotency + lookups).
//   * `insertOutcomes` (optional) scripts forced per-attempt results — used to
//     simulate code/token (NOT client) collisions; an entry is { error } or
//     undefined (success). When omitted, inserts are governed by the real
//     uniqueness model above.
//   * `injectOnFirstInsert` simulates a concurrent creator landing a row for the
//     client between our existence check and our insert (the race path).
function pickReturned(row: any) {
  return { code: row.code, client_id: row.client_id ?? null, token: row.token ?? null };
}

function makeSupabase(opts: {
  profileName?: string | null;          // undefined → users row absent
  ownedClients?: string[];              // client ids owned by the user
  existingRows?: any[];                 // rows already persisted before this call
  insertOutcomes?: Array<{ error?: { code?: string; message?: string; details?: string } } | undefined>;
  injectOnFirstInsert?: any;            // concurrent creator's row (race simulation)
}) {
  const attempts: any[] = [];                              // every insert attempt
  const stored: any[] = [...(opts.existingRows ?? [])];    // persisted rows
  const outcomes = [...(opts.insertOutcomes ?? [])];
  const owned = opts.ownedClients ?? [];
  let injected = false;
  const supabase: any = {
    _inserted: attempts,
    _stored: stored,
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
        const lookup: Record<string, any> = {};
        const b: any = {
          insert: (r: any) => { row = r; attempts.push(r); return b; },
          select: () => b,
          // Read path — matches PERSISTED rows on ALL applied .eq() filters.
          // Mirrors the /brief/[token] resolver, the idempotency check, and the
          // race re-read (.eq('user_id',_).eq('client_id',_)).
          eq: (col: string, val: any) => { lookup[col] = val; return b; },
          maybeSingle: () =>
            Promise.resolve({
              data: stored.find(r => Object.keys(lookup).every(k => r[k] === lookup[k])) ?? null,
              error: null,
            }),
          single: () => {
            // Forced outcome (scripts code/token collisions) takes precedence.
            if (outcomes.length) {
              const outcome = outcomes.shift();
              if (outcome?.error) return Promise.resolve({ data: null, error: outcome.error });
              stored.push(row);
              return Promise.resolve({ data: pickReturned(row), error: null });
            }
            // A concurrent creator lands the client's row just before us.
            if (opts.injectOnFirstInsert && !injected) {
              injected = true;
              stored.push(opts.injectOnFirstInsert);
            }
            // Enforce brief_codes_client_uniq (one row per non-null client_id).
            if (row.client_id != null && stored.some(r => r.client_id === row.client_id)) {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "brief_codes_client_uniq"',
                  details: `Key (client_id)=(${row.client_id}) already exists.`,
                },
              });
            }
            stored.push(row);
            return Promise.resolve({ data: pickReturned(row), error: null });
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

describe('generateBriefToken', () => {
  it('produces a 64-char lowercase hex CSPRNG token', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const token = generateBriefToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(50); // no collisions
  });
});

describe('issueBriefCode', () => {
  it('generates + persists + returns a 64-hex token alongside the code', async () => {
    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: [CLIENT] });
    const result = await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'ABC123' });
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(supabase._inserted[0].token).toBe(result.token);
  });

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

  // Regression: the "+ create brief code" action must yield a magic link that
  // actually resolves. Guards against the bug where new codes were inserted
  // WITHOUT a token (so /brief/<token> had nothing to resolve).
  it('REGRESSION: creating a code yields a token-resolvable magic link', async () => {
    // The resolver (/brief/[token] page + GET /api/brief/[token]) rejects
    // anything that fails this regex before it ever hits the DB.
    const RESOLVER_TOKEN_REGEX = /^[a-f0-9]{64}$/;

    const supabase = makeSupabase({ profileName: 'Acme', ownedClients: [CLIENT] });

    // 1) Create (uses the REAL default token generator, not a stub).
    const issued = await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'LINK01' });
    expect(issued.token).toMatch(RESOLVER_TOKEN_REGEX);

    // 2) The token was actually persisted on the row (not just returned).
    expect(supabase._inserted[0].token).toBe(issued.token);

    // 3) The resolver lookup by token finds the row → the link resolves.
    const { data: resolved } = await supabase
      .from('brief_codes')
      .select('agency_name, client_id, token')
      .eq('token', issued.token)
      .maybeSingle();
    expect(resolved).not.toBeNull();
    expect(resolved.token).toBe(issued.token);
    expect(resolved.client_id).toBe(CLIENT);

    // 4) The built link has the expected /brief/<token> shape.
    expect(`/brief/${issued.token}`).toMatch(/^\/brief\/[a-f0-9]{64}$/);
  });

  // Regression for the real-runtime bug: brief_codes has UNIQUE(client_id), so a
  // client that already has a code must get its EXISTING magic link back — not a
  // "could not generate a unique brief code after N attempts" failure. The old
  // code skipped straight to the insert loop, hit the per-client 23505, and
  // (mis)treated it as a code/token clash, regenerating forever.
  it('REGRESSION: a client that already has a code returns its existing link (idempotent), never errors', async () => {
    const EXISTING_TOKEN = 'a'.repeat(64);
    const supabase = makeSupabase({
      profileName: 'Acme',
      ownedClients: [CLIENT],
      existingRows: [{ code: 'OLD123', client_id: CLIENT, token: EXISTING_TOKEN, user_id: 'user-1' }],
    });

    const issued = await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'NEW999' });

    // Returns the EXISTING code + token (the stable per-client link)…
    expect(issued).toEqual({ code: 'OLD123', client_id: CLIENT, token: EXISTING_TOKEN });
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    // …and never attempted a doomed duplicate insert.
    expect(supabase._inserted.length).toBe(0);
  });

  // A concurrent request can create the client's code between our existence
  // check and our insert. The per-client 23505 must be recovered by re-reading
  // and returning the winning row (regenerating code+token can never help).
  it('tolerates a concurrent creator: per-client 23505 re-reads and returns the winning row', async () => {
    const RACE_TOKEN = 'b'.repeat(64);
    const supabase = makeSupabase({
      profileName: 'Acme',
      ownedClients: [CLIENT],
      injectOnFirstInsert: { code: 'WON111', client_id: CLIENT, token: RACE_TOKEN, user_id: 'user-1' },
    });

    const issued = await issueBriefCode(supabase, 'user-1', CLIENT, { genCode: () => 'MINE22' });

    expect(issued).toEqual({ code: 'WON111', client_id: CLIENT, token: RACE_TOKEN });
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
