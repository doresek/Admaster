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

/**
 * Resolve agency_name from users.name (unchanged), generate a code, and insert
 * a brief_codes row for `userId`. `clientId` is now REQUIRED and must belong to
 * the user's `clients` — issuance is client-scoped.
 *
 * ROBUSTNESS IMPROVEMENT: the original client code inserted a single random
 * code with no collision handling. Here we retry on the unique(code) constraint
 * (Postgres 23505) up to `maxAttempts` times, regenerating each time, so a rare
 * code clash no longer surfaces as a hard error.
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
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (!ownedClient) {
    throw new BriefCodeError(400, 'client_id does not belong to this user');
  }

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

    // 23505 = unique_violation → code/token clash, regenerate both and retry.
    // Any other error is a real failure; surface it immediately.
    if (error.code !== '23505') {
      throw new Error(error.message);
    }
  }

  throw new Error(`could not generate a unique brief code after ${maxAttempts} attempts`);
}
