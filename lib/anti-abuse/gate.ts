// lib/anti-abuse/gate.ts
//
// Phone-verification gate. A user gets FULL access only after their phone is
// verified (signup_verifications.phone_verified_at is set). Callers use this to
// guard privileged actions behind the OTP step.
//
// GRACEFUL DEGRADATION: if the signup_verifications table is absent (migration
// 049 not applied) the gate FAILS OPEN (treats as verified) so an un-migrated
// environment is not bricked. Enforcement is real once the migration lands.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Postgres / PostgREST signatures for "table does not exist yet". */
function isMissingTable(message?: string, code?: string): boolean {
  if (code === '42P01' || code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? '');
}

/**
 * Is this user's phone verified? Reads signup_verifications for the user.
 * FAILS CLOSED: any error in production returns false (an abuse gate must never
 * grant "verified" on error). The missing-table bypass is a DEV-ONLY convenience
 * for local envs where migration 050 hasn't been applied — never in production.
 * The `supabase` client may be RLS-scoped (owner reads own row) or admin.
 */
export async function isPhoneVerified(supabase: SupabaseClient, userId: string): Promise<boolean> {
  // In production, a missing/erroring table must fail closed, not open.
  const allowMissingTableBypass = process.env.NODE_ENV !== 'production';
  try {
    const { data, error } = await supabase
      .from('signup_verifications')
      .select('phone_verified_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (allowMissingTableBypass && isMissingTable(error.message, (error as { code?: string }).code)) return true;
      return false; // fail closed
    }
    return Boolean((data as { phone_verified_at?: string | null } | null)?.phone_verified_at);
  } catch (e) {
    if (allowMissingTableBypass && isMissingTable(e instanceof Error ? e.message : String(e))) return true;
    return false; // fail closed
  }
}
