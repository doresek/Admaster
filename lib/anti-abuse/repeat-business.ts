// lib/anti-abuse/repeat-business.ts
//
// Repeat-business detection (signal #4). When a Meta page / business is
// connected, flag if the same FB page id or business id is ALREADY linked to
// another account. This is a FLAG-FOR-REVIEW signal — never a hard block —
// because legitimate agencies re-connect the same page across clients.
//
// Read-only over meta_connections (agency model) + meta_clients (legacy). The
// caller passes a Supabase client (injectable) — use the SERVICE-ROLE admin
// client so the query sees rows across ALL accounts (that's the whole point:
// detecting the SAME page on a DIFFERENT owner).

import type { SupabaseClient } from '@supabase/supabase-js';

import type { RepeatBusinessMatch, RepeatBusinessResult } from './types';

export interface DetectRepeatBusinessInput {
  /** The connected Facebook Page id, if known. */
  pageId?: string | null;
  /** The connected Meta business / ad-account id, if known. */
  businessId?: string | null;
  /**
   * The account performing THIS connect. Matches on this owner are excluded so
   * a user re-connecting their own page is not flagged as repeat business.
   */
  excludeUserId?: string | null;
}

const NON_MISSING = (v: string | null | undefined): v is string => typeof v === 'string' && v.length > 0;

/**
 * Detect whether `pageId` / `businessId` is already linked to another account.
 * Queries are best-effort and degrade to "no match" on any error / missing
 * table, so a detection outage never blocks signup.
 */
export async function detectRepeatBusiness(
  supabase: SupabaseClient,
  input: DetectRepeatBusinessInput,
): Promise<RepeatBusinessResult> {
  const pageId = NON_MISSING(input.pageId) ? input.pageId : null;
  const businessId = NON_MISSING(input.businessId) ? input.businessId : null;
  const exclude = NON_MISSING(input.excludeUserId) ? input.excludeUserId : null;

  if (!pageId && !businessId) return { isRepeat: false, matches: [] };

  const matches: RepeatBusinessMatch[] = [];

  const push = (
    userId: string | null | undefined,
    clientId: string | null | undefined,
    source: RepeatBusinessMatch['source'],
    matchedOn: RepeatBusinessMatch['matchedOn'],
  ) => {
    if (!userId || !clientId) return;
    if (exclude && userId === exclude) return;
    if (matches.some((m) => m.userId === userId && m.clientId === clientId && m.matchedOn === matchedOn)) return;
    matches.push({ userId, clientId, source, matchedOn });
  };

  // meta_connections — the agency-model source of truth. selected_page_id /
  // selected_ad_account_id are the connected assets.
  try {
    if (pageId) {
      const { data } = await supabase
        .from('meta_connections')
        .select('agency_user_id, client_id')
        .eq('selected_page_id', pageId);
      for (const r of (data ?? []) as Array<{ agency_user_id: string; client_id: string }>) {
        push(r.agency_user_id, r.client_id, 'meta_connections', 'pageId');
      }
    }
    if (businessId) {
      const { data } = await supabase
        .from('meta_connections')
        .select('agency_user_id, client_id')
        .eq('selected_ad_account_id', businessId);
      for (const r of (data ?? []) as Array<{ agency_user_id: string; client_id: string }>) {
        push(r.agency_user_id, r.client_id, 'meta_connections', 'businessId');
      }
    }
  } catch {
    /* table absent / query error — degrade to no match */
  }

  // meta_clients — legacy (pre-connections-split) source. Owner is user_id and
  // the row IS the business, so client_id == the meta_clients row id.
  try {
    if (pageId) {
      const { data } = await supabase
        .from('meta_clients')
        .select('id, user_id')
        .eq('selected_page_id', pageId);
      for (const r of (data ?? []) as Array<{ id: string; user_id: string }>) {
        push(r.user_id, r.id, 'meta_clients', 'pageId');
      }
    }
    if (businessId) {
      const { data } = await supabase
        .from('meta_clients')
        .select('id, user_id')
        .eq('selected_ad_account_id', businessId);
      for (const r of (data ?? []) as Array<{ id: string; user_id: string }>) {
        push(r.user_id, r.id, 'meta_clients', 'businessId');
      }
    }
  } catch {
    /* legacy table absent / query error — degrade to no match */
  }

  return { isRepeat: matches.length > 0, matches };
}
