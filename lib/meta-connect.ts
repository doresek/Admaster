// ════════════════════════════════════════════
// Session-less client-connect link — core logic.
//
// An agency mints a single-use, 72h-expiring magic-link for ONE meta_clients
// row. The external client opens it and authorizes THEIR OWN Meta account; the
// resulting credential is written to meta_connections by the service role. The
// client never logs into AdMaster, so the 64-hex token is the SOLE access
// control on the public routes.
//
// This module is kept free of next/headers so it is unit-testable with a mocked
// Supabase client (mirrors app/api/briefs/code/issue.ts).
// ════════════════════════════════════════════
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Must match generateConnectToken() (randomBytes(32) -> 64 lowercase hex chars).
// Identical shape to the brief token; this IS the access control on the public
// /connect/<token> routes, so it must be unguessable and non-enumerable.
export const CONNECT_TOKEN_REGEX = /^[a-f0-9]{64}$/;

// 72h connect-link lifetime — stricter than the (non-expiring) brief link.
export const CONNECT_LINK_TTL_MS = 72 * 60 * 60 * 1000;

// Thrown for caller-fixable problems (missing / not-owned client) so the route
// can map them to a 4xx instead of a generic 500.
export class ConnectLinkError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ConnectLinkError';
    this.status = status;
  }
}

export function generateConnectToken(): string {
  return randomBytes(32).toString('hex');
}

// Minimal shape of the meta_clients columns the predicate needs.
export interface ConnectTokenRow {
  connect_consumed_at: string | null;
  connect_expires_at: string | null;
}

export type ConnectLinkState = 'valid' | 'consumed' | 'expired' | 'invalid';

// Single source of truth for "is this connect link usable right now?".
// `null` row (no match) => invalid. Consumed wins over expired so a used link
// reads as consumed even past its expiry.
export function connectLinkState(
  row: ConnectTokenRow | null | undefined,
  now: Date = new Date(),
): ConnectLinkState {
  if (!row) return 'invalid';
  if (row.connect_consumed_at) return 'consumed';
  if (!row.connect_expires_at || new Date(row.connect_expires_at).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'valid';
}

export function isConnectLinkUsable(
  row: ConnectTokenRow | null | undefined,
  now: Date = new Date(),
): boolean {
  return connectLinkState(row, now) === 'valid';
}

// meta_clients row resolved FROM a connect token (service-role lookup). The
// public routes use this as their single binding to the owning client/agency —
// never a session.
export interface ConnectClientRow {
  id: string;
  name: string | null;
  user_id: string;
  connect_consumed_at: string | null;
  connect_expires_at: string | null;
}

// Resolve the meta_clients row a connect token points at, via the service-role
// (admin) client — RLS bypass, exactly like the brief resolver. Returns null
// when no row carries the token. Callers MUST regex-precheck the token and rate
// limit BEFORE calling this (the token is the sole access control).
export async function lookupConnectClient(
  admin: SupabaseClient,
  token: string,
): Promise<ConnectClientRow | null> {
  const { data } = await admin
    .from('meta_clients')
    .select('id, name, user_id, connect_consumed_at, connect_expires_at')
    .eq('connect_token', token)
    .maybeSingle();
  return (data as ConnectClientRow | null) ?? null;
}

export interface MintedConnectLink {
  client_id: string;
  token: string;
  expires_at: string;
}

/**
 * Verify `clientId` belongs to `userId`, then mint a fresh connect token on the
 * owner meta_clients row: connect_token = <64-hex>, connect_expires_at =
 * now()+72h, connect_consumed_at = null. Retries on the partial-unique-index
 * collision (Postgres 23505), regenerating the token each time.
 *
 * The route handler supplies an authenticated, user-scoped Supabase client, so
 * the UPDATE is itself RLS-guarded; the explicit ownership check gives a clean
 * 404/400 instead of a silent zero-row update.
 */
export async function mintConnectLink(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null | undefined,
  opts: { genToken?: () => string; maxAttempts?: number; now?: Date } = {},
): Promise<MintedConnectLink> {
  const genToken = opts.genToken ?? generateConnectToken;
  const maxAttempts = opts.maxAttempts ?? 5;
  const now = opts.now ?? new Date();

  if (!clientId) {
    throw new ConnectLinkError(400, 'client_id is required');
  }

  // Ownership: the client must belong to the authenticated agency user.
  const { data: owned } = await supabase
    .from('meta_clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!owned) {
    throw new ConnectLinkError(404, 'client not found');
  }

  const expiresAt = new Date(now.getTime() + CONNECT_LINK_TTL_MS).toISOString();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = genToken();

    const { data, error } = await supabase
      .from('meta_clients')
      .update({
        connect_token: token,
        connect_expires_at: expiresAt,
        connect_consumed_at: null,
      })
      .eq('id', clientId)
      .eq('user_id', userId)
      .select('id')
      .single();

    if (!error && data) {
      return { client_id: clientId, token, expires_at: expiresAt };
    }

    // 23505 = unique_violation on the partial unique index → token clash,
    // regenerate and retry. Any other error is a real failure.
    if (error && error.code !== '23505') {
      throw new Error(error.message);
    }
  }

  throw new Error(`could not generate a unique connect token after ${maxAttempts} attempts`);
}
