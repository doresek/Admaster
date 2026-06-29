// ════════════════════════════════════════════
// Meta Graph "insights" → ad_performance mapping.
//
// Pure, side-effect-free helpers shared by the /api/meta/insights sync route
// and its unit test. Keeping the mapping here (not inline in the route) means
// it can be tested without spinning up Next/Supabase/Graph.
//
// The Graph Insights endpoint returns every numeric metric as a STRING, and
// "conversions" are not a first-class field — they live inside the `actions`
// array as {action_type, value} pairs. We coerce all numerics defensively
// (NaN → 0) and derive conversions by summing a configured set of conversion
// action types. ad_performance columns this fills:
//   impressions, clicks, spend, reach, frequency, ctr, cpc, cpm,
//   conversions, cost_per_result   (roas left at its DB default — needs
//   action_values, out of scope for W5.2a).
// ════════════════════════════════════════════

// A single daily row as returned by GET {ad_account}/insights?time_increment=1.
export interface GraphInsightsRow {
  date_start?: string;
  date_stop?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  reach?: string;
  frequency?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

// The subset of ad_performance columns this sync writes (the rest carry their
// DB defaults). Matches supabase/migrations/002_features.sql.
export interface AdPerformanceRecord {
  user_id: string;
  client_id: string;
  ad_account_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  cost_per_result: number;
  fetched_at: string;
}

export interface MappingContext {
  userId: string;
  clientId: string;
  adAccountId: string;
  fetchedAt: string; // ISO timestamp; passed in so mapping stays deterministic
}

// Action types we treat as "conversions". Meta returns both canonical short
// names and pixel-/omni-prefixed variants; which one is present depends on the
// account's setup, so we accept the common ones. NOTE: if an account reports
// BOTH a canonical and a pixel variant for the same event this can double
// count — acceptable for the v1 report; revisit with per-category dedup if it
// proves noisy in production.
export const CONVERSION_ACTION_TYPES: ReadonlySet<string> = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
]);

// Parse a Graph numeric string to an integer, defaulting to 0 on null/NaN.
function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// Parse a Graph numeric string to a float, defaulting to 0 on null/NaN.
function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Sum the values of `actions` entries whose action_type is a conversion type.
export function extractConversions(
  actions: GraphInsightsRow['actions'],
): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, a) => {
    if (a && a.action_type && CONVERSION_ACTION_TYPES.has(a.action_type)) {
      return sum + toNum(a.value);
    }
    return sum;
  }, 0);
}

// Map one daily Graph insights row to an ad_performance upsert record.
export function mapInsightsRowToPerformance(
  row: GraphInsightsRow,
  ctx: MappingContext,
): AdPerformanceRecord {
  const spend = toNum(row.spend);
  const conversions = extractConversions(row.actions);

  return {
    user_id: ctx.userId,
    client_id: ctx.clientId,
    ad_account_id: ctx.adAccountId,
    // date_start is the day for a time_increment=1 row; fall back to date_stop.
    date: row.date_start ?? row.date_stop ?? '',
    impressions: toInt(row.impressions),
    clicks: toInt(row.clicks),
    spend,
    reach: toInt(row.reach),
    frequency: toNum(row.frequency),
    ctr: toNum(row.ctr),
    cpc: toNum(row.cpc),
    cpm: toNum(row.cpm),
    conversions,
    // Cheap derived metric; roas needs action_values (out of scope here).
    cost_per_result: conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0,
    fetched_at: ctx.fetchedAt,
  };
}
