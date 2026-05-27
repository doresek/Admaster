import type { SupabaseClient } from '@supabase/supabase-js';
import { CREDIT_COSTS, type CreditAction } from '@/types';

export type DeductResult =
  | { ok: true;  cost: number; credits: number }
  | { ok: false; status: 402 | 400; error: string; credits?: number };

/**
 * Deduct credits for an action via the SECURITY DEFINER `deduct_credits` RPC.
 * Returns a discriminated result; callers should `return` on `ok: false`.
 */
export async function deductCredits(
  supabase: SupabaseClient,
  userId:   string,
  action:   CreditAction,
): Promise<DeductResult> {
  const cost = CREDIT_COSTS[action];
  if (cost === undefined) return { ok: false, status: 400, error: 'Invalid action' };

  const { data, error } = await supabase.rpc('deduct_credits', {
    p_user_id: userId, p_action: action, p_cost: cost,
  });

  if (error) return { ok: false, status: 400, error: error.message };
  if (!data?.success) return { ok: false, status: 402, error: 'insufficient_credits', credits: data?.credits ?? 0 };

  return { ok: true, cost, credits: data.credits as number };
}

/**
 * Refund a previously-deducted action. Used when the external provider
 * (Claude, Ideogram, etc.) fails after credits were already deducted.
 * Best-effort: errors are logged and swallowed so the caller can still
 * propagate the original failure to the user.
 */
export async function refundCredits(
  supabase: SupabaseClient,
  userId:   string,
  action:   CreditAction,
  cost:     number,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('refund_credits', {
      p_user_id: userId, p_action: action, p_cost: cost,
    });
    if (error) console.error('[refundCredits] RPC failed:', error.message);
  } catch (e: any) {
    console.error('[refundCredits] exception:', e?.message);
  }
}

/**
 * Pull a useful error message out of an Anthropic / fetch error.
 */
export function extractErrorMessage(err: any): string {
  return err?.error?.error?.message    // Anthropic SDK shape
      || err?.error?.message
      || err?.response?.data?.error
      || err?.message
      || 'Unknown server error';
}
