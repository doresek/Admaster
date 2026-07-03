// lib/voc/quote-bank.ts
//
// Read side for generation: the quote bank is "copy ammunition" (voc-mining
// §6.3) — the strongest verbatim customer phrases, filterable by extractable
// and funnel stage, formatted for direct prompt injection so hooks can pull
// real pain language instead of invented marketing-speak.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VocExtractable, VocQuoteRow } from '@/lib/capability-contracts';
import type { VocFunnelFit } from './types';

const QUOTE_COLUMNS =
  'id, document_id, client_id, owner_user_id, quote, extractable, polarity, segment_tags, atom_action, funnel_fit, created_at';

export interface QuoteBankFilters {
  extractable?: VocExtractable;
  funnelFit?:   VocFunnelFit;
  limit?:       number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT     = 50;

/**
 * Fetch the client's strongest quotes, newest first (recency is the ordering
 * proxy: fresh customer language beats stale, and reconciliation strength
 * already lives on the atoms the quotes fed). Owner-scoped explicitly so the
 * layer is correct under the admin client too.
 */
export async function getQuoteBank(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  filters:     QuoteBankFilters = {},
): Promise<VocQuoteRow[]> {
  const limit = Math.min(Math.max(1, filters.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  let q = supabase
    .from('voc_quotes')
    .select(QUOTE_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId);
  if (filters.extractable) q = q.eq('extractable', filters.extractable);
  if (filters.funnelFit)   q = q.eq('funnel_fit', filters.funnelFit);

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(limit)
    .overrideTypes<VocQuoteRow[], { merge: false }>();
  if (error) throw new Error(`getQuoteBank: ${error.message}`);
  return data ?? [];
}

/**
 * Render quotes for prompt injection — one line each, tagged by extractable +
 * funnel fit so a generation prompt can say "pain phrases → TOFU hooks; trust
 * markers → BOFU proof" (skill §6.3).
 */
export function formatQuotesForPrompt(quotes: VocQuoteRow[]): string {
  if (!quotes.length) return '';
  return quotes
    .map((q) => `- "${q.quote}" [${q.extractable}${q.funnel_fit ? ` · ${q.funnel_fit}` : ''}]`)
    .join('\n');
}
