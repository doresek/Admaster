// Core brief-code issuance logic, kept free of next/headers so it can be
// unit-tested with a mocked Supabase client. The route handler (route.ts)
// supplies an authenticated, user-scoped Supabase client.
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Thrown for caller-fixable problems (missing / not-owned client_id) so the
// route can map them to a 400 instead of a generic 500.
export class BriefCodeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BriefCodeError';
    this.status = status;
  }
}

// Code generation — UNCHANGED from the original inline client logic:
// a random base-36 string, 6 chars, uppercased (e.g. "K3J9ZQ").
// NOTE: this is a manual-entry fallback only; it is NOT used as the magic-link
// access control (Math.random is not a CSPRNG and 6 chars is enumerable).
export function generateBriefCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Magic-link token — a 256-bit CSPRNG value as 64 lowercase hex chars. This IS
// the access control on the public /brief/<token> form, so it must be
// unguessable and non-enumerable. Mirrors the column added in migration 018.
export function generateBriefToken(): string {
  return randomBytes(32).toString('hex');
}

export interface IssuedBriefCode {
  code:      string;
  client_id: string;
  token:     string;
}

// The production brief_codes table carries a UNIQUE(client_id) constraint
// (`brief_codes_client_uniq`): each client has at MOST ONE brief code, hence one
// stable magic link. This is true on the live DB even though older migrations
// only created a (non-unique) index; migration 019 records it so fresh DBs match.
const CLIENT_UNIQUE_CONSTRAINT = 'brief_codes_client_uniq';

// Distinguish the per-client unique violation from a (rare) code/token clash.
// Both surface as Postgres 23505, but only the former mentions the client_id
// column / the constraint name — and it can never be resolved by regenerating
// code+token, so it must be handled by returning the existing row instead.
function isClientUniqueViolation(error: { code?: string; message?: string; details?: string }): boolean {
  if (error?.code !== '23505') return false;
  const blob = `${error.message ?? ''} ${error.details ?? ''}`;
  return blob.includes(CLIENT_UNIQUE_CONSTRAINT) || /\bclient_id\b/.test(blob);
}

// Fetch this client's existing brief code (if any). Returns null when the client
// has no code yet, or has a legacy row with a null token (no working link).
async function findClientCode(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<IssuedBriefCode | null> {
  const { data } = await supabase
    .from('brief_codes')
    .select('code, client_id, token')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (data?.token) {
    return { code: data.code, client_id: data.client_id, token: data.token };
  }
  return null;
}

/**
 * Resolve agency_name from users.name (unchanged), and return the brief code +
 * magic-link token for `userId`'s `clientId`. `clientId` is REQUIRED and must
 * belong to the user's meta_clients — issuance is client-scoped.
 *
 * IDEMPOTENT PER CLIENT: the live DB enforces one code per client
 * (`brief_codes_client_uniq`), so if the client already has a code we RETURN it
 * rather than attempting a duplicate insert. This fixes the real-runtime bug
 * where "create code" for a client that already had one threw
 * "could not generate a unique brief code after N attempts" and produced no
 * magic link — the previous retry loop mistook the per-client 23505 for a
 * code/token clash and just regenerated code+token (which never changes
 * client_id), exhausting every attempt.
 *
 * For the genuinely-new case we still retry on the unique(code)/unique(token)
 * constraints (regenerating each time), and we tolerate a concurrent creator
 * winning the race by re-reading the client's row on a per-client 23505.
 */
export async function issueBriefCode(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null | undefined,
  opts: { genCode?: () => string; genToken?: () => string; maxAttempts?: number } = {},
): Promise<IssuedBriefCode> {
  const genCode = opts.genCode ?? generateBriefCode;
  const genToken = opts.genToken ?? generateBriefToken;
  const maxAttempts = opts.maxAttempts ?? 5;

  if (!clientId) {
    throw new BriefCodeError(400, 'client_id is required');
  }

  // Ownership check: the client must belong to the authenticated user.
  const { data: ownedClient } = await supabase
    .from('meta_clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!ownedClient) {
    throw new BriefCodeError(400, 'client_id does not belong to this user');
  }

  // Already has a code → return its (existing) magic link instead of colliding
  // with brief_codes_client_uniq.
  const existing = await findClientCode(supabase, userId, clientId);
  if (existing) return existing;

  // agency_name from users.name (faithful to today; null when absent).
  const { data: profile } = await supabase
    .from('users')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  const agency_name = profile?.name ?? null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = genCode();
    const token = genToken();
    const row = { code, token, user_id: userId, agency_name, client_id: clientId };

    const { data, error } = await supabase
      .from('brief_codes')
      .insert(row)
      .select('code, client_id, token')
      .single();

    if (!error) {
      return { code: data.code, client_id: data.client_id, token: data.token };
    }

    // Non-unique errors are real failures; surface immediately.
    if (error.code !== '23505') {
      throw new Error(error.message);
    }

    // Per-client unique violation → a concurrent request created this client's
    // code between our check and insert. Re-read and return it; regenerating
    // would never succeed (client_id is fixed).
    if (isClientUniqueViolation(error)) {
      const raced = await findClientCode(supabase, userId, clientId);
      if (raced) return raced;
      throw new Error(error.message);
    }

    // Otherwise it's a code/token clash → regenerate both and retry.
  }

  throw new Error(`could not generate a unique brief code after ${maxAttempts} attempts`);
}
