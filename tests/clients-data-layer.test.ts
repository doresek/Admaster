// Tests for lib/clients — the clean client-model data layer.
//
// Mocks Supabase so they pass without the live `clients`/`client_strategy`
// tables. Locks: createClient inserts identity ONLY (no Meta), name required;
// listClients returns rows scoped to the owner; getClient maybeSingle null.
import { describe, it, expect, vi } from 'vitest';
import { createClient, listClients, getClient, getClientStrategy, canCreateClient } from '@/lib/clients';

describe('lib/clients canCreateClient (drives /clients create-button disabled state)', () => {
  it('is false until a non-empty name is entered', () => {
    expect(canCreateClient('')).toBe(false);
    expect(canCreateClient('   ')).toBe(false);
    expect(canCreateClient('A')).toBe(true);
    expect(canCreateClient('  Acme  ')).toBe(true);
  });
});

// Minimal chainable Supabase stub. Records the table + insert payload, and
// returns canned rows for select paths.
function makeSupabase(rows: any) {
  const calls: any = { table: undefined as string | undefined, insert: undefined as any, eqs: [] as any[] };
  const builder: any = {
    insert(p: any) { calls.insert = p; return builder; },
    update(p: any) { calls.update = p; return builder; },
    select() { return builder; },
    eq(col: string, val: any) { calls.eqs.push([col, val]); return builder; },
    order() { return builder; },
    single: async () => ({ data: { id: 'c-1', ...(calls.insert ?? {}) }, error: null }),
    maybeSingle: async () => ({ data: rows ?? null, error: null }),
    then: undefined,
  };
  // listClients awaits the builder after .order(); expose a thenable result.
  builder.order = () => Promise.resolve({ data: rows ?? [], error: null });
  const supabase: any = { from(t: string) { calls.table = t; return builder; } };
  return { supabase, calls };
}

describe('lib/clients createClient', () => {
  it('inserts identity ONLY (no Meta fields) and requires name', async () => {
    const { supabase, calls } = makeSupabase(null);
    const client = await createClient(supabase, {
      ownerUserId: 'owner-1', name: '  Acme  ', email: 'a@b.com', phone: '050', company: 'Co', notes: 'hi',
    });

    expect(calls.table).toBe('clients');
    expect(calls.insert).toEqual({
      owner_user_id: 'owner-1', name: 'Acme', email: 'a@b.com', phone: '050', company: 'Co', notes: 'hi',
    });
    // No Meta columns leak into the identity insert.
    expect(calls.insert).not.toHaveProperty('token_encrypted');
    expect(calls.insert).not.toHaveProperty('pages');
    expect(client.id).toBe('c-1');
  });

  it('defaults optional fields to null', async () => {
    const { supabase, calls } = makeSupabase(null);
    await createClient(supabase, { ownerUserId: 'o', name: 'Solo' });
    expect(calls.insert).toEqual({
      owner_user_id: 'o', name: 'Solo', email: null, phone: null, company: null, notes: null,
    });
  });

  it('throws when name is empty/whitespace (no insert)', async () => {
    const { supabase } = makeSupabase(null);
    await expect(createClient(supabase, { ownerUserId: 'o', name: '   ' })).rejects.toThrow('Missing name');
  });
});

describe('lib/clients listClients', () => {
  it('returns rows scoped to the owner', async () => {
    const { supabase, calls } = makeSupabase([{ id: 'c-1', name: 'A' }, { id: 'c-2', name: 'B' }]);
    const rows = await listClients(supabase, 'owner-1');
    expect(rows).toHaveLength(2);
    expect(calls.table).toBe('clients');
    expect(calls.eqs).toContainEqual(['owner_user_id', 'owner-1']);
  });
});

describe('lib/clients getClient / getClientStrategy', () => {
  it('getClient returns null when no row', async () => {
    const { supabase } = makeSupabase(null);
    const c = await getClient(supabase, 'missing', 'owner-1');
    expect(c).toBeNull();
  });

  it('getClientStrategy reads client_strategy', async () => {
    const { supabase, calls } = makeSupabase({ id: 's-1', client_id: 'c-1', core_generated_at: '2026-01-01' });
    const s = await getClientStrategy(supabase, 'c-1');
    expect(calls.table).toBe('client_strategy');
    expect(s?.core_generated_at).toBe('2026-01-01');
  });
});
