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

const h2 = vi.hoisted(() => ({ lastDeps: undefined as any, liveCheckerBuilt: 0 }));

vi.mock('@/lib/meta-health', () => ({
  buildReadinessReport: vi.fn(async ({ ownerUserId }: { ownerUserId: string }, deps: any) => {
    h.ownerSeen = ownerUserId;
    h2.lastDeps = deps;
    return {
      appConfigured: false,
      redirectUris: { dashboard: 'd', connect: 'c' },
      requiredScopes: [],
      connections: [],
      ready: false,
      blockers: ['no connected Meta account for any client'],
    };
  }),
  metaGraphCheckScopes: vi.fn(() => {
    h2.liveCheckerBuilt += 1;
    return async () => undefined;
  }),
}));

import { GET } from '@/app/api/meta/health/route';

// Minimal NextRequest stand-in: the route only reads req.nextUrl.searchParams.
const mkReq = (url = 'http://localhost/api/meta/health') => ({ nextUrl: new URL(url) }) as any;

beforeEach(() => {
  h.userId = 'u1';
  h.ownerSeen = null;
  h2.lastDeps = undefined;
  h2.liveCheckerBuilt = 0;
  delete process.env.META_LIVE_SCOPE_CHECK;
});

describe('GET /api/meta/health', () => {
  it('401s when unauthenticated', async () => {
    h.userId = null;
    const res = await GET(mkReq());
    expect(res.status).toBe(401);
  });

  it('returns the readiness report for the authed owner (dry-run by default)', async () => {
    const res = await GET(mkReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.blockers).toContain('no connected Meta account for any client');
    expect(h.ownerSeen).toBe('u1');
    expect(body.scopeCheck).toBe('dry-run');
    expect(h2.lastDeps?.checkScopes).toBeUndefined();
    expect(h2.liveCheckerBuilt).toBe(0);
  });

  it('flips to LIVE scope-check with ?live=1 (injects metaGraphCheckScopes)', async () => {
    const res = await GET(mkReq('http://localhost/api/meta/health?live=1'));
    const body = await res.json();
    expect(body.scopeCheck).toBe('live');
    expect(typeof h2.lastDeps?.checkScopes).toBe('function');
    expect(h2.liveCheckerBuilt).toBe(1);
  });

  it('flips to LIVE scope-check when META_LIVE_SCOPE_CHECK=true', async () => {
    process.env.META_LIVE_SCOPE_CHECK = 'true';
    const res = await GET(mkReq());
    const body = await res.json();
    expect(body.scopeCheck).toBe('live');
    expect(typeof h2.lastDeps?.checkScopes).toBe('function');
  });
});
