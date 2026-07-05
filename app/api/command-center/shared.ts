// Shared helpers + types for the Command Center API.
//
// The Command Center is READ-HEAVY: the owner sees ALL marketing (campaigns,
// spend, performance) AND the *understanding* behind every decision — the
// grounded insights + rationale ("the WHY"). The only writes are status
// changes (pause/resume/approve); nothing here ever spends money.
//
// IMPORTANT: the underlying tables (campaigns, campaign_items,
// campaign_decisions, diagnoses, client_insights) ship in migration 030 which
// is NOT applied in prod yet. Every read MUST degrade to "no data yet" when a
// relation is missing — see `isMissingRelation`.
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Resolved insight (the WHY a decision was grounded in) ───────
export interface ResolvedInsight {
  id: string;
  content: string | null;
  confidence: number | null; // 0..1
  layer: string | null;
}

export interface CampaignDecision {
  id: string;
  decision_type: string | null;
  // `campaign_decisions.decision` is jsonb — an object like { channel } /
  // { frameworks, variant_count } / { platform }. It is NOT a string; the UI
  // summarizes it for display (never renders the raw object as a React child).
  decision: unknown;
  rationale: string | null;
  grounded_in: string[];
  grounded: ResolvedInsight[];
}

export interface CampaignItem {
  id: string;
  item_type: string | null;
  status: string | null;
  rationale: string | null;
  targeting_spec: unknown;
  grounded_in: string[];
  grounded: ResolvedInsight[];
}

export interface Campaign {
  id: string;
  status: string | null;
  channel: string | null;
  daily_budget: number | null;
  funnel_stage: string | null;
  rationale: string | null;
  meta_campaign_id: string | null;
  dry_run: boolean;
  grounded_in: string[];
  grounded: ResolvedInsight[];
  items: CampaignItem[];
  decisions: CampaignDecision[];
}

export interface Diagnosis {
  id: string;
  failed_link: string | null;
  rationale: string | null;
  target_insight_ids: string[];
  targets: ResolvedInsight[];
}

// A Supabase/PostgREST error means "table absent" when the relation is unknown
// to Postgres (42P01) or to the PostgREST schema cache (PGRST205/PGRST202), or
// the message plainly says the relation/table does not exist. Treated as
// "no campaigns yet" so the UI renders an empty state instead of a crash.
export function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  const code = e.code ?? '';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    /relation .* does not exist/.test(msg) ||
    /could not find the table/.test(msg) ||
    /does not exist/.test(msg) && /table|relation/.test(msg)
  );
}

// Resolve a flat list of `grounded_in` insight ids → their content+confidence
// so the UI can show the WHY. Tolerant of an absent `client_insights` table
// (returns an empty map) and de-dupes ids before querying.
export async function resolveInsights(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, ResolvedInsight>> {
  const map = new Map<string, ResolvedInsight>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from('client_insights')
    .select('id, content, confidence, layer')
    .in('id', unique);

  if (error) {
    // Missing table or any resolution error → no WHY available, not a crash.
    return map;
  }
  for (const row of (data ?? []) as ResolvedInsight[]) {
    map.set(row.id, {
      id: row.id,
      content: row.content ?? null,
      confidence: row.confidence ?? null,
      layer: row.layer ?? null,
    });
  }
  return map;
}

// Map a list of grounded_in ids through a resolved-insight map, dropping ids
// that did not resolve (e.g. deleted insight).
export function attachGrounded(
  groundedIn: string[] | null | undefined,
  map: Map<string, ResolvedInsight>,
): ResolvedInsight[] {
  return (groundedIn ?? [])
    .map((id) => map.get(id))
    .filter((x): x is ResolvedInsight => !!x);
}
