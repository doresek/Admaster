// Core public report-share resolution, kept free of next/headers so it can be
// unit-tested with a mocked Supabase client and reused by both the public API
// route and the public server page. The caller supplies a SERVICE-ROLE admin
// Supabase client — the token IS the authorization, there is no anon RLS.
import type { SupabaseClient } from '@supabase/supabase-js';

// Must match generateShareToken() (randomBytes(32) -> 64 lowercase hex chars).
export const REPORT_TOKEN_REGEX = /^[a-f0-9]{64}$/;

export interface ResolvedReport {
  valid:       boolean;
  expired?:    boolean;
  clientName?: string | null;
  report?:     unknown;
  period?:     { start: string; end: string };
}

/**
 * Resolve a share token to its immutable report snapshot. Returns
 * `{ valid: false }` for a malformed/unknown token and
 * `{ valid: false, expired: true }` for a link past its expires_at. The expiry
 * semantics are "expires_at IS NULL OR expires_at > now()".
 */
export async function resolveReportShare(
  supabase: SupabaseClient,
  token: string,
  opts: { now?: () => Date } = {},
): Promise<ResolvedReport> {
  const now = opts.now ?? (() => new Date());

  // Defense in depth: reject malformed tokens before any DB hit.
  if (!REPORT_TOKEN_REGEX.test(token)) {
    return { valid: false };
  }

  const { data, error } = await supabase
    .from('report_shares')
    .select('client_id, period_start, period_end, report, expires_at, meta_clients(name)')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) {
    return { valid: false };
  }

  // expires_at IS NULL → never expires; otherwise must be in the future.
  if (data.expires_at && new Date(data.expires_at) < now()) {
    return { valid: false, expired: true };
  }

  // The meta_clients join may surface as an object or a single-element array
  // depending on the PostgREST embedding shape; handle both defensively.
  const mc = Array.isArray(data.meta_clients) ? data.meta_clients[0] : data.meta_clients;
  const clientName = (mc as { name?: string } | null)?.name ?? null;

  return {
    valid:      true,
    clientName,
    report:     data.report,
    period:     { start: data.period_start, end: data.period_end },
  };
}
