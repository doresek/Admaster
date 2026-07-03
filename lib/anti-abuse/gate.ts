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
 * Returns true when verified OR when the table is absent (fail-open). The
 * `supabase` client may be RLS-scoped (owner reads own row) or admin.
 */
export async function isPhoneVerified(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('signup_verifications')
      .select('phone_verified_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error.message, (error as { code?: string }).code)) return true; // fail open
      return false;
    }
    return Boolean((data as { phone_verified_at?: string | null } | null)?.phone_verified_at);
  } catch (e) {
    if (isMissingTable(e instanceof Error ? e.message : String(e))) return true;
    return false;
  }
}
