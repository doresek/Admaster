// Tests for POST/GET /api/clients — the clean-model client endpoint.
//
// Mocks lib/clients + the Supabase auth so they pass without live tables.
// Locks: 400 without name, 401 unauthenticated, POST never touches Meta,
// GET lists for the user.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  authUser: { id: 'owner-1' } as { id: string } | null,
  created: undefined as any,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
  }),
}));

vi.mock('@/lib/clients', () => ({
  createClient: vi.fn(async (_sb: any, input: any) => {
    H.created = input;
    return { id: 'c-1', owner_user_id: input.ownerUserId, name: input.name };
  }),
  listClients: vi.fn(async () => [{ id: 'c-1', name: 'A' }, { id: 'c-2', name: 'B' }]),
}));

import { POST, GET } from '@/app/api/clients/route';

const req = (body: any) => ({ json: async () => body }) as any;

beforeEach(() => {
  H.authUser = { id: 'owner-1' };
  H.created = undefined;
});

describe('POST /api/clients', () => {
  it('400s when name is missing', async () => {
    const res = await POST(req({ email: 'a@b.com' }));
    expect(res.status).toBe(400);
    expect(H.created).toBeUndefined();
  });

  it('400s when name is only whitespace', async () => {
    const res = await POST(req({ name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await POST(req({ name: 'Acme' }));
    expect(res.status).toBe(401);
  });

  it('creates an identity-only client and returns it', async () => {
    const res = await POST(req({ name: 'Acme', email: 'a@b.com', phone: '050', company: 'Co', notes: 'n' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(H.created).toEqual({
      ownerUserId: 'owner-1', name: 'Acme', email: 'a@b.com', phone: '050', company: 'Co', notes: 'n',
    });
    expect(data.id).toBe('c-1');
  });
});

describe('GET /api/clients', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('lists clients for the user', async () => {
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveLength(2);
  });
});
