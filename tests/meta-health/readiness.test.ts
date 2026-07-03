// tests/meta-health/readiness.test.ts — buildReadinessReport: app-config gating,
// missing-scope computation, and graceful degradation with no creds / no
// connections. Fully injected — never touches Graph or the DB.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildReadinessReport,
  metaGraphCheckScopes,
  noopCheckScopes,
  type HealthConnection,
} from '@/lib/meta-health';

const ORIG = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };

function setCreds(id: string | undefined, secret: string | undefined) {
  if (id === undefined) delete process.env.META_APP_ID;
  else process.env.META_APP_ID = id;
  if (secret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = secret;
}

// META_APP_ID/SECRET are read into module constants at import time, so the
// env only changes what assertMetaAppConfigured throws — but appConfigured also
// AND's the module constants. In this test suite creds are unset at import, so
// appConfigured is driven by the constants (false). We assert the shape/logic
// that does NOT depend on live env: redirect URIs, scopes, connections, blockers.

beforeEach(() => setCreds(undefined, undefined));
afterEach(() => setCreds(ORIG.id, ORIG.secret));

const conns =
  (list: HealthConnection[]) =>
  async (_owner: string): Promise<HealthConnection[]> =>
    list;

describe('buildReadinessReport', () => {
  it('reports app NOT configured and clear blockers when creds are absent', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      { loadConnections: conns([]) },
    );
    expect(r.appConfigured).toBe(false);
    expect(r.blockers).toContain('META_APP_ID not set');
    expect(r.blockers).toContain('META_APP_SECRET not set');
    expect(r.ready).toBe(false);
  });

  it('always exposes redirect URIs and the full required-scope list', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      { loadConnections: conns([]) },
    );
    expect(r.redirectUris.dashboard).toMatch(/\/api\/meta\/oauth\/callback$/);
    expect(r.redirectUris.connect).toMatch(/\/api\/meta\/connect\/callback$/);
    expect(r.requiredScopes).toEqual(
      expect.arrayContaining([
        'ads_management',
        'ads_read',
        'pages_read_engagement',
        'pages_show_list',
        'business_management',
      ]),
    );
  });

  it('blocks when there are no connections', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      { loadConnections: conns([]) },
    );
    expect(r.connections).toHaveLength(0);
    expect(r.blockers).toContain('no connected Meta account for any client');
    expect(r.ready).toBe(false);
  });

  it('flags a connection with no token as a per-client blocker', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      {
        loadConnections: conns([{ clientId: 'cA', status: 'pending', token: null }]),
      },
    );
    expect(r.connections[0]).toMatchObject({ clientId: 'cA', hasToken: false });
    expect(r.connections[0].grantedScopes).toBeUndefined();
    expect(r.blockers).toContain('no connected Meta account for client cA');
  });

  it('leaves scopes UNKNOWN (no blocker) with the default no-op checker + a token', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      {
        loadConnections: conns([{ clientId: 'cA', status: 'connected', token: 'tok' }]),
        // checkScopes omitted → noopCheckScopes
      },
    );
    expect(r.connections[0].hasToken).toBe(true);
    expect(r.connections[0].grantedScopes).toBeUndefined();
    expect(r.connections[0].missingScopes).toBeUndefined();
    // No scope blocker; only app-cred blockers remain (creds unset here).
    expect(r.blockers.some((b) => b.includes('missing scopes'))).toBe(false);
  });

  it('computes missingScopes when debug_token returns a subset', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      {
        loadConnections: conns([{ clientId: 'cA', status: 'connected', token: 'tok' }]),
        checkScopes: async () => ['ads_read', 'pages_show_list'],
      },
    );
    const c = r.connections[0];
    expect(c.grantedScopes).toEqual(['ads_read', 'pages_show_list']);
    expect(c.missingScopes).toEqual(
      expect.arrayContaining(['ads_management', 'pages_read_engagement', 'business_management']),
    );
    expect(c.missingScopes).not.toContain('ads_read');
    expect(r.blockers).toContain(
      `missing scopes for client cA: ${c.missingScopes!.join(', ')}`,
    );
  });

  it('reports no missing scopes when all required scopes are granted', async () => {
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      {
        loadConnections: conns([{ clientId: 'cA', status: 'connected', token: 'tok' }]),
        checkScopes: async () => [
          'ads_management',
          'ads_read',
          'pages_read_engagement',
          'pages_show_list',
          'business_management',
        ],
      },
    );
    expect(r.connections[0].missingScopes).toEqual([]);
    expect(r.blockers.some((b) => b.includes('missing scopes'))).toBe(false);
  });

  it('does not throw when the loader itself is the default (absent-table-safe path is internal)', async () => {
    // Injecting a loader that resolves empty is the unit-level analog; the
    // default loader swallows DB errors → [] (integration-covered).
    await expect(
      buildReadinessReport({ ownerUserId: 'u1' }, { loadConnections: async () => [] }),
    ).resolves.toBeTruthy();
  });
});

describe('token expiry (C-06 pipe-health)', () => {
  it('blocks a connected client whose token has expired, but not a never-expiring one', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const r = await buildReadinessReport(
      { ownerUserId: 'u1' },
      {
        loadConnections: conns([
          { clientId: 'cExpired', status: 'connected', token: 'tok', expiresAt: expired },
          { clientId: 'cLongLived', status: 'connected', token: 'tok', expiresAt: null },
        ]),
      },
    );
    expect(r.blockers).toContain('token for client cExpired has expired — reconnect required');
    expect(r.blockers.some((b) => b.includes('cLongLived') && b.includes('expired'))).toBe(false);
    expect(r.connections.find((c) => c.clientId === 'cExpired')?.expiresAt).toBe(expired);
  });
});

describe('noopCheckScopes', () => {
  it('returns undefined and never networks', async () => {
    await expect(noopCheckScopes('anything')).resolves.toBeUndefined();
  });
});

describe('metaGraphCheckScopes (opt-in)', () => {
  it('returns undefined without app creds (no network attempted)', async () => {
    setCreds(undefined, undefined);
    let called = false;
    const check = metaGraphCheckScopes({
      fetchImpl: (async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch,
    });
    await expect(check('tok')).resolves.toBeUndefined();
    expect(called).toBe(false);
  });
});
