// Core report share-link minting logic, kept free of next/headers so it can be
// unit-tested with a mocked Supabase client. The route handler (route.ts)
// supplies an authenticated, user-scoped Supabase client.
//
// A marketer mints a long, unguessable TOKEN over an already-generated ROI
// report so the client can open a public, stable link (/report/<token>) without
// logging in. The report snapshot is stored at mint time (jsonb) so the link is
// IMMUTABLE even if the underlying ad_performance data later changes.
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Thrown for caller-fixable problems (missing fields / not-owned client) so the
// route can map them to a 400 instead of a generic 500.
export class ReportShareError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ReportShareError';
    this.status = status;
  }
}

// Share token — a 256-bit CSPRNG value as 64 lowercase hex chars. This IS the
// SOLE access control on the public /report/<token> view, so it must be
// unguessable and non-enumerable. Mirrors brief_codes.token / connect tokens.
export function generateShareToken(): string {
  return randomBytes(32).toString('hex');
}

// Links are valid for 30 days from mint (matches report_shares.expires_at).
const SHARE_TTL_DAYS = 30;

export interface MintShareInput {
  clientId:    string | null | undefined;
  periodStart: string | null | undefined;
  periodEnd:   string | null | undefined;
  report:      unknown; // the already-generated report snapshot (jsonb)
}

export interface MintedShare {
  token: string;
}

/**
 * Validate the input, verify the client belongs to `userId`, then insert a
 * report_shares row with a fresh 64-hex token and the immutable report
 * snapshot. Retries on the unique(token) constraint (Postgres 23505),
 * regenerating each time, so a rare token clash never surfaces as a hard error.
 */
export async function mintReportShare(
  supabase: SupabaseClient,
  userId: string,
  input: MintShareInput,
  opts: { genToken?: () => string; maxAttempts?: number; now?: () => Date } = {},
): Promise<MintedShare> {
  const genToken = opts.genToken ?? generateShareToken;
  const maxAttempts = opts.maxAttempts ?? 5;
  const now = opts.now ?? (() => new Date());

  if (!input.clientId) {
    throw new ReportShareError(400, 'clientId is required');
  }
  if (!input.periodStart || !input.periodEnd) {
    throw new ReportShareError(400, 'periodStart and periodEnd are required');
  }
  if (input.report == null) {
    throw new ReportShareError(400, 'report snapshot is required');
  }

  // Ownership check: the client must belong to the authenticated user.
  const { data: ownedClient } = await supabase
    .from('meta_clients')
    .select('id')
    .eq('id', input.clientId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!ownedClient) {
    throw new ReportShareError(400, 'clientId does not belong to this user');
  }

  const expiresAt = new Date(
    now().getTime() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = genToken();
    const row = {
      token,
      user_id:      userId,
      client_id:    input.clientId,
      period_start: input.periodStart,
      period_end:   input.periodEnd,
      report:       input.report,
      expires_at:   expiresAt,
    };

    const { data, error } = await supabase
      .from('report_shares')
      .insert(row)
      .select('token')
      .single();

    if (!error) {
      return { token: data.token };
    }

    // 23505 = unique_violation → token clash, regenerate and retry.
    // Any other error is a real failure; surface it immediately.
    if (error.code !== '23505') {
      throw new Error(error.message);
    }
  }

  throw new Error(`could not mint a unique report share token after ${maxAttempts} attempts`);
}
