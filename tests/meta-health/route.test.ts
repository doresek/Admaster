// tests/meta-health/route.test.ts — GET /api/meta/health: requires auth,
// returns the readiness report. Supabase + the report builder are mocked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  ownerSeen: null as string | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null } }) },
  }),
}));

vi.mock('@/lib/meta-health', () => ({
  buildReadinessReport: vi.fn(async ({ ownerUserId }: { ownerUserId: string }) => {
    h.ownerSeen = ownerUserId;
    return {
      appConfigured: false,
      redirectUris: { dashboard: 'd', connect: 'c' },
      requiredScopes: [],
      connections: [],
      ready: false,
      blockers: ['no connected Meta account for any client'],
    };
  }),
}));

import { GET } from '@/app/api/meta/health/route';

beforeEach(() => {
  h.userId = 'u1';
  h.ownerSeen = null;
});

describe('GET /api/meta/health', () => {
  it('401s when unauthenticated', async () => {
    h.userId = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the readiness report for the authed owner', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.blockers).toContain('no connected Meta account for any client');
    expect(h.ownerSeen).toBe('u1');
  });
});
