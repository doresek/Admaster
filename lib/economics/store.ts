// lib/economics/store.ts
//
// Persistence for client_economics (migration 060) following the
// lib/intelligence/insights.ts / lib/hypotheses/store.ts conventions: every
// function takes a SupabaseClient first (dependency injection — mockable in
// tests), every query is EXPLICITLY owner/client scoped even under the
// service-role client (background paths bypass RLS), and every DB error is
// checked and thrown with the function name.
//
// Ownership note: upserts key on client_id (UNIQUE in 060). Route callers
// verify clients-table ownership BEFORE calling in here (see
// app/api/economics/route.ts), and under the RLS user client the
// owner_user_id WITH CHECK policy blocks cross-owner writes as a second
// fence.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClientEconomicsRow, FunnelLeadRow } from '@/lib/capability-contracts';
import {
  computedEconomics,
  TERMINAL_STAGES,
  validateOwnerEconomics,
  type EconFieldError,
  type OwnerEconomicsInput,
} from './core';

export const ECONOMICS_COLUMNS =
  'id, client_id, owner_user_id, contribution_margin_pct, avg_deal_value, ' +
  'close_rate_pct, payback_target_months, currency, source, updated_at, created_at';

/** Read a client's economics row (null when the owner hasn't answered yet). */
export async function getEconomics(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<ClientEconomicsRow | null> {
  const { data, error } = await supabase
    .from('client_economics')
    .select(ECONOMICS_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<ClientEconomicsRow, { merge: false }>();

  if (error) throw new Error(`getEconomics: ${error.message}`);
  return data;
}

export interface UpsertEconomicsInput extends OwnerEconomicsInput {
  clientId:    string;
  ownerUserId: string;
}

export type UpsertEconomicsResult =
  | { ok: true;  row: ClientEconomicsRow }
  | { ok: false; errors: EconFieldError[] };

/**
 * Seed/replace the OWNER's answers (the 3 onboarding questions). Validation
 * failures come back typed (→ 400 at the API); DB failures throw. Writes
 * source='owner': the owner's answers are the authoritative seed, and
 * `refreshComputed` re-merges data-derived fields on its next run (source
 * then becomes 'mixed').
 */
export async function upsertEconomics(
  supabase: SupabaseClient,
  input:    UpsertEconomicsInput,
): Promise<UpsertEconomicsResult> {
  const errors = validateOwnerEconomics(input);
  if (errors.length > 0) return { ok: false, errors };

  const { data, error } = await supabase
    .from('client_economics')
    .upsert(
      {
        client_id:               input.clientId,
        owner_user_id:           input.ownerUserId,
        contribution_margin_pct: input.contributionMarginPct,
        avg_deal_value:          input.avgDealValue,
        close_rate_pct:          input.closeRatePct,
        payback_target_months:   input.paybackTargetMonths ?? 6,
        currency:                input.currency ?? 'ILS',
        source:                  'owner',
        updated_at:              new Date().toISOString(),
      },
      { onConflict: 'client_id' },
    )
    .select(ECONOMICS_COLUMNS)
    .single()
    .overrideTypes<ClientEconomicsRow, { merge: false }>();

  if (error) throw new Error(`upsertEconomics: ${error.message}`);
  return { ok: true, row: data };
}

export type RefreshComputedResult =
  | { updated: false; reason: 'insufficient_sample'; sampleN: number }
  | { updated: true;  row: ClientEconomicsRow };

/**
 * Recompute close_rate_pct + avg_deal_value from CRM ground truth
 * (funnel_leads closed_won values) and write them back when the sample can
 * carry the claim (≥5 closed-won-with-value; see `computedEconomics` for the
 * statistical-humility and denominator rationale).
 *
 * Merge semantics: only the data-derived fields are written — the owner's
 * contribution margin / payback target / currency are untouched (partial
 * upsert on client_id). source becomes 'mixed' when an owner-seeded margin
 * exists, 'computed' when the row is data-only. Below the sample floor,
 * NOTHING is written and the owner-seeded values remain in force.
 */
export async function refreshComputed(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
): Promise<RefreshComputedResult> {
  // Terminal stages only — exactly the denominator computedEconomics uses.
  const { data: leads, error: leadsError } = await supabase
    .from('funnel_leads')
    .select('current_stage, value')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .in('current_stage', TERMINAL_STAGES)
    .overrideTypes<Array<Pick<FunnelLeadRow, 'current_stage' | 'value'>>, { merge: false }>();

  if (leadsError) throw new Error(`refreshComputed: reading funnel_leads: ${leadsError.message}`);

  const result = computedEconomics(leads ?? []);
  if (result.computed === null) {
    return { updated: false, reason: result.reason, sampleN: result.sample_n };
  }

  const existing = await getEconomics(supabase, clientId, ownerUserId);
  const source: ClientEconomicsRow['source'] =
    existing !== null && existing.contribution_margin_pct !== null ? 'mixed' : 'computed';

  const { data, error } = await supabase
    .from('client_economics')
    .upsert(
      {
        client_id:      clientId,
        owner_user_id:  ownerUserId,
        close_rate_pct: result.computed.close_rate_pct,
        avg_deal_value: result.computed.avg_deal_value,
        source,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: 'client_id' },
    )
    .select(ECONOMICS_COLUMNS)
    .single()
    .overrideTypes<ClientEconomicsRow, { merge: false }>();

  if (error) throw new Error(`refreshComputed: writing client_economics: ${error.message}`);
  return { updated: true, row: data };
}
