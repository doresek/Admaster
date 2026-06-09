// lib/autopilot/credits.ts
// Credit helpers for autopilot/judge actions that are NOT yet in the shared
// CREDIT_COSTS map (types/index.ts is co-edited by the parallel session). We
// call the generic deduct_credits/refund_credits RPCs with an explicit cost,
// which is exactly what lib/credits.ts does under the hood. When the two keys
// are eventually added to types/index.ts, callers can switch to deductCredits().

import type { SupabaseClient } from '@supabase/supabase-js';

export const AUTOPILOT_CREDIT_COSTS = {
  autopilot_run: 5,
  judge: 1,
} as const;

export type AutopilotAction = keyof typeof AUTOPILOT_CREDIT_COSTS;

export interface ExplicitDeductResult {
  ok: boolean;
  status: number;
  cost: number;
  credits?: number;
  error?: string;
}

export async function deductExplicit(
  supabase: SupabaseClient,
  userId: string,
  action: AutopilotAction,
): Promise<ExplicitDeductResult> {
  const cost = AUTOPILOT_CREDIT_COSTS[action];
  const { data, error } = await supabase.rpc('deduct_credits', {
    p_user_id: userId,
    p_action: action,
    p_cost: cost,
  });
  if (error) return { ok: false, status: 400, cost, error: error.message };
  if (!data?.success) {
    return { ok: false, status: 402, cost, credits: data?.credits ?? 0, error: 'insufficient_credits' };
  }
  return { ok: true, status: 200, cost, credits: data.credits as number };
}

export async function refundExplicit(
  supabase: SupabaseClient,
  userId: string,
  action: AutopilotAction,
  cost: number,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('refund_credits', {
      p_user_id: userId,
      p_action: action,
      p_cost: cost,
    });
    if (error) console.error('[autopilot refundExplicit] RPC failed:', error.message);
  } catch (e: any) {
    console.error('[autopilot refundExplicit] exception:', e?.message);
  }
}
