// ════════════════════════════════════════════
// Meta connection HEALTH / readiness (dry-run).
//
// Reports whether the app + each client's Meta connection is ready for
// autonomous marketing, so go-live is a visible checklist instead of a mystery.
//
// Design contract:
//   • NO live network by default. `checkScopes` defaults to a no-op that returns
//     `undefined` (scopes "unknown") — it never throws and never hits Graph.
//   • Everything the report needs is injectable (`loadConnections`,
//     `checkScopes`) so it is fully unit-testable without Meta creds or a DB.
//   • Absent-`meta_connections`-safe: the default loader swallows table/DB
//     errors and yields an empty connection list rather than throwing.
//
// The real Graph `debug_token` lookup lives in `metaGraphCheckScopes` and is
// OPT-IN — callers wire it explicitly (e.g. once H4 creds land); it is never the
// default.
// ════════════════════════════════════════════

import {
  META_APP_ID,
  META_APP_SECRET,
  META_GRAPH_BASE,
  META_OAUTH_SCOPES,
  assertMetaAppConfigured,
  metaRedirectUri,
} from './meta-config';

// ── Report shape ────────────────────────────────────────────────────────────

export interface ConnectionHealth {
  clientId: string;
  status: string;
  hasToken: boolean;
  // Present only when a scope check ran AND returned a known answer.
  grantedScopes?: string[];
  // Required scopes not present in grantedScopes. Undefined when scopes unknown.
  missingScopes?: string[];
}

export interface ReadinessReport {
  appConfigured: boolean;
  redirectUris: { dashboard: string; connect: string };
  requiredScopes: string[];
  connections: ConnectionHealth[];
  ready: boolean;
  blockers: string[];
}

// A connection as this module needs to reason about it. The token is the
// DECRYPTED access token (or null) — used only to (a) report `hasToken` and
// (b) feed an injected `checkScopes`; it never leaves this module.
export interface HealthConnection {
  clientId: string;
  status: string;
  token: string | null;
}

export interface ReadinessDeps {
  // Load the owner's Meta connections. Defaults to reading `meta_connections`
  // by agency_user_id via the admin client (absent-table-safe → []).
  loadConnections?: (ownerUserId: string) => Promise<HealthConnection[]>;
  // Given a decrypted token, return the granted scopes, or `undefined` when
  // unknown. Defaults to a no-op that returns `undefined` (never networks).
  checkScopes?: (token: string) => Promise<string[] | undefined>;
}

export interface ReadinessArgs {
  ownerUserId: string;
}

// ── Defaults (network-free) ───────────────────────────────────────────────────

// Default scope checker: reports "unknown" and NEVER touches the network. This
// is what keeps `buildReadinessReport` safe with no creds.
export const noopCheckScopes = async (_token: string): Promise<string[] | undefined> => undefined;

// Default connection loader: reads `meta_connections` for the owner via the
// admin client and decrypts each token. Any failure (missing table, no creds,
// DB down) degrades to an empty list — the report stays a checklist, not a 500.
async function defaultLoadConnections(ownerUserId: string): Promise<HealthConnection[]> {
  try {
    const { createAdminClient } = await import('./supabase/server');
    const { decryptOrPlaintext } = await import('./crypto');
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('meta_connections')
      .select('client_id, status, token_encrypted')
      .eq('agency_user_id', ownerUserId)
      .order('connected_at', { ascending: false });

    if (error || !data) return [];

    return (data as Array<{ client_id: string; status: string | null; token_encrypted: string | null }>).map(
      (row) => ({
        clientId: row.client_id,
        status: row.status ?? 'unknown',
        token: row.token_encrypted ? decryptOrPlaintext(row.token_encrypted) : null,
      }),
    );
  } catch {
    return [];
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

export async function buildReadinessReport(
  { ownerUserId }: ReadinessArgs,
  deps: ReadinessDeps = {},
): Promise<ReadinessReport> {
  const loadConnections = deps.loadConnections ?? defaultLoadConnections;
  const checkScopes = deps.checkScopes ?? noopCheckScopes;

  // App-level config. assertMetaAppConfigured throws when creds are missing.
  let appConfigured = true;
  try {
    assertMetaAppConfigured();
  } catch {
    appConfigured = false;
  }
  // Belt-and-suspenders presence check (mirrors what assert verifies).
  appConfigured = appConfigured && Boolean(META_APP_ID) && Boolean(META_APP_SECRET);

  const requiredScopes = [...META_OAUTH_SCOPES];

  const rawConnections = await loadConnections(ownerUserId);

  const connections: ConnectionHealth[] = [];
  for (const conn of rawConnections) {
    const hasToken = Boolean(conn.token);
    const health: ConnectionHealth = {
      clientId: conn.clientId,
      status: conn.status,
      hasToken,
    };

    if (hasToken && conn.token) {
      const grantedScopes = await checkScopes(conn.token);
      if (grantedScopes !== undefined) {
        health.grantedScopes = grantedScopes;
        health.missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));
      }
    }

    connections.push(health);
  }

  // Human-readable blockers. Empty list ⇒ ready.
  const blockers: string[] = [];
  if (!META_APP_ID) blockers.push('META_APP_ID not set');
  if (!META_APP_SECRET) blockers.push('META_APP_SECRET not set');

  if (connections.length === 0) {
    blockers.push('no connected Meta account for any client');
  }

  for (const c of connections) {
    if (!c.hasToken) {
      blockers.push(`no connected Meta account for client ${c.clientId}`);
      continue;
    }
    if (c.status !== 'connected') {
      blockers.push(`connection for client ${c.clientId} is ${c.status}, not connected`);
    }
    if (c.missingScopes && c.missingScopes.length > 0) {
      blockers.push(`missing scopes for client ${c.clientId}: ${c.missingScopes.join(', ')}`);
    }
  }

  return {
    appConfigured,
    redirectUris: {
      dashboard: metaRedirectUri('dashboard'),
      connect: metaRedirectUri('connect'),
    },
    requiredScopes,
    connections,
    ready: blockers.length === 0,
    blockers,
  };
}

// ── Opt-in live scope checker ───────────────────────────────────────────────

// Build a `checkScopes` that queries Graph `debug_token` to read the scopes a
// token actually granted. OPT-IN only — never the default. Requires app creds;
// returns `undefined` (unknown) on any error so it degrades gracefully.
//
//   deps: { fetch } is injectable for tests. Default uses global fetch.
export function metaGraphCheckScopes(
  opts: { fetchImpl?: typeof fetch } = {},
): (token: string) => Promise<string[] | undefined> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (token: string): Promise<string[] | undefined> => {
    if (!META_APP_ID || !META_APP_SECRET || !token) return undefined;
    try {
      const appToken = `${META_APP_ID}|${META_APP_SECRET}`;
      const url =
        `${META_GRAPH_BASE}/debug_token` +
        `?input_token=${encodeURIComponent(token)}` +
        `&access_token=${encodeURIComponent(appToken)}`;
      const res = await fetchImpl(url);
      if (!res.ok) return undefined;
      const json = (await res.json()) as { data?: { scopes?: string[] } };
      const scopes = json?.data?.scopes;
      return Array.isArray(scopes) ? scopes : undefined;
    } catch {
      return undefined;
    }
  };
}
