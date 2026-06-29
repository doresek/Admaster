// lib/intelligence/synthesize.ts
//
// Project the living atoms (client_insights) into the SYNTHESIZED SNAPSHOT that
// the rest of the app already consumes: the StrategyAnalysis (#32) shape that
// lib/ai-context.ts emits as the MARKETING STRATEGY block, plus a structured
// avatar object (the fields lib/ai-context.ts's formatClientAvatar renders).
//
// The snapshot is a DERIVED, cacheable view — it is rebuilt from the atoms and
// upserted onto client_strategy (one row per client). We always prefer the
// highest-confidence atom per slot. This is a pure projection; there is no LLM
// call (the deep analysis already ran in lib/intelligence/analyze.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyAnalysis } from '@/lib/analyze-brief';
import { listActiveInsights } from './insights';
import type { ClientInsight } from './types';

export interface SynthesisResult {
  business_analysis: StrategyAnalysis;
  avatar:            Record<string, unknown>;
}

/** Highest-confidence atom of a given kind (atoms arrive sorted desc already). */
function top(atoms: ClientInsight[], kind: string): string {
  const hit = atoms.filter((a) => a.kind === kind).sort((a, b) => b.confidence - a.confidence)[0];
  return hit?.content ?? '';
}

/** First non-empty `top` across several kinds (priority order). */
function topAny(atoms: ClientInsight[], kinds: string[]): string {
  for (const k of kinds) {
    const v = top(atoms, k);
    if (v) return v;
  }
  return '';
}

/** All contents for the given kinds, highest-confidence first, capped. */
function many(atoms: ClientInsight[], kinds: string[], cap = 5): string[] {
  return atoms
    .filter((a) => kinds.includes(a.kind))
    .sort((a, b) => b.confidence - a.confidence)
    .map((a) => a.content.trim())
    .filter(Boolean)
    .slice(0, cap);
}

/** The rationale recorded on the top atom of a kind (for snapshot "reason" fields). */
function topRationale(atoms: ClientInsight[], kind: string): string {
  const hit = atoms.filter((a) => a.kind === kind).sort((a, b) => b.confidence - a.confidence)[0];
  const r = hit?.structured?.['rationale'];
  return typeof r === 'string' ? r : '';
}

/** Project the active atoms into the StrategyAnalysis + avatar snapshot shapes. */
export function projectSnapshot(active: ClientInsight[]): SynthesisResult {
  const business  = active.filter((a) => a.layer === 'business');
  const customers = active.filter((a) => a.layer === 'customers');
  const bridge    = active.filter((a) => a.layer === 'bridge');

  const business_analysis: StrategyAnalysis = {
    strategic_summary: {
      goal:        topAny(business, ['goal', 'real_solution']),
      core_offer:  topAny(business, ['core_offer', 'real_solution']),
      usp:         topAny(business, ['real_usp', 'true_value']),
      constraints: many(business, ['constraint'], 5),
    },
    sub_audience: {
      name:            top(customers, 'persona') || topAny(customers, ['pain', 'desire']),
      awareness_level: top(customers, 'awareness'),
      persona:         top(customers, 'persona'),
      explanation:     topAny(customers, ['pain', 'unspoken_want', 'desire']),
    },
    platform_funnel: {
      platform:        top(bridge, 'platform'),
      ad_format:       topAny(bridge, ['angle', 'hook']),
      funnel_type:     top(bridge, 'funnel'),
      platform_reason: topRationale(bridge, 'platform'),
      format_reason:   topRationale(bridge, 'angle'),
      funnel_reason:   topRationale(bridge, 'funnel'),
    },
    offer_stack: {
      components: many(business, ['core_offer', 'real_solution'], 5),
      strengths:  many(business, ['real_usp', 'pain_solved'], 5),
      assessment: topAny(business, ['true_value', 'real_usp']),
    },
    raw_text: '',
  };

  const avatar: Record<string, unknown> = {
    name:                        top(customers, 'persona'),
    occupation:                  '',
    pains:                       many(customers, ['pain'], 5),
    desires:                     many(customers, ['desire', 'aspiration', 'dream'], 5),
    fears:                       many(customers, ['unspoken_want'], 3),
    objections:                  many(customers, ['objection'], 5),
    awareness_level:             top(customers, 'awareness'),
    recommended_angle:           topAny(bridge, ['angle', 'value_translation']),
    recommended_creative_angles: many(bridge, ['angle', 'hook'], 3),
  };

  return { business_analysis, avatar };
}

/**
 * Read the active atoms for a client, project them into the snapshot, and upsert
 * client_strategy (business_analysis + avatar + core_generated_at). Returns the
 * projected snapshot, or null when there is nothing to synthesize (no atoms and
 * no resolvable owner). Errors throw to the caller (the orchestrator wraps).
 */
export async function synthesizeStrategy(
  admin:    SupabaseClient,
  clientId: string,
): Promise<SynthesisResult | null> {
  const active = await listActiveInsights(admin, clientId);

  // Resolve the owner for the (NOT NULL) owner_user_id column: prefer an atom's
  // owner, else the client identity row.
  let ownerUserId: string | null = active[0]?.owner_user_id ?? null;
  if (!ownerUserId) {
    const { data } = await admin
      .from('clients')
      .select('owner_user_id')
      .eq('id', clientId)
      .maybeSingle();
    ownerUserId = (data as unknown as { owner_user_id?: string } | null)?.owner_user_id ?? null;
  }
  if (!ownerUserId) return null;

  const snapshot = projectSnapshot(active);
  const now = new Date().toISOString();

  const { error } = await admin
    .from('client_strategy')
    .upsert(
      {
        client_id:         clientId,
        owner_user_id:     ownerUserId,
        business_analysis: snapshot.business_analysis,
        avatar:            snapshot.avatar,
        core_generated_at: now,
        updated_at:        now,
      },
      { onConflict: 'client_id' },
    );

  if (error) throw new Error(error.message);
  return snapshot;
}
