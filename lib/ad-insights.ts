// Fetch + normalize Meta ad/campaign performance insights.
// normalizeInsights is pure (unit-tested); fetch* wrap the Graph call.
import type { AdInsights } from '@/types';

const GRAPH = 'https://graph.facebook.com/v19.0';
const FIELDS = 'impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type';

// Action types that count as the "result" of a campaign, by priority.
const RESULT_ACTIONS = [
  'onsite_conversion.lead_grouped',
  'lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'link_click',
  'landing_page_view',
];

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Convert a raw Meta insights row into our normalized AdInsights shape. */
export function normalizeInsights(raw: any): AdInsights {
  const actions: { action_type: string; value: string }[] = raw?.actions || [];
  const costs: { action_type: string; value: string }[] = raw?.cost_per_action_type || [];

  let results = 0;
  let resultAction: string | null = null;
  for (const key of RESULT_ACTIONS) {
    const hit = actions.find(a => a.action_type === key);
    if (hit) { results = num(hit.value); resultAction = key; break; }
  }
  const costPerResult = resultAction
    ? num(costs.find(c => c.action_type === resultAction)?.value) || (results ? num(raw.spend) / results : null)
    : null;

  return {
    impressions: num(raw?.impressions),
    clicks:      num(raw?.clicks),
    spend:       num(raw?.spend),
    ctr:         num(raw?.ctr),
    cpc:         num(raw?.cpc),
    cpm:         num(raw?.cpm),
    reach:       num(raw?.reach),
    frequency:   num(raw?.frequency),
    results,
    costPerResult: costPerResult === 0 ? null : costPerResult,
  };
}

async function graphGet(path: string, token: string) {
  const url = `${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (data?.error) throw new Error(data.error.message || 'Graph insights error');
  return data;
}

/** Fetch insights for a single Meta object (ad or campaign id) over a date preset. */
export async function fetchInsights(
  token: string,
  objectId: string,
  datePreset = 'maximum',
): Promise<AdInsights> {
  const data = await graphGet(`${objectId}/insights?fields=${FIELDS}&date_preset=${datePreset}`, token);
  const row = data?.data?.[0];
  if (!row) {
    // No data yet (ad just launched / still PAUSED) — return zeros.
    return normalizeInsights({});
  }
  return normalizeInsights(row);
}
