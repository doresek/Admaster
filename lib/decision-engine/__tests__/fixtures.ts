// Test fixtures: build ClientInsight atoms with minimal ceremony.
import type { Insight } from '../types';
import type { InsightLayer, InsightStatus } from '@/lib/intelligence/types';

let seq = 0;

/** Build an active atom; override any field. id auto-increments for stability. */
export function atom(partial: Partial<Insight> & { layer: InsightLayer; kind: string; content: string }): Insight {
  seq += 1;
  return {
    id:                partial.id ?? `atom_${seq}`,
    client_id:         partial.client_id ?? 'client_1',
    owner_user_id:     partial.owner_user_id ?? 'owner_1',
    layer:             partial.layer,
    kind:              partial.kind,
    content:           partial.content,
    structured:        partial.structured ?? null,
    source:            partial.source ?? 'brief',
    source_ref:        partial.source_ref ?? null,
    confidence:        partial.confidence ?? 0.5,
    evidence_count:    partial.evidence_count ?? 1,
    status:            (partial.status ?? 'active') as InsightStatus,
    superseded_by:     partial.superseded_by ?? null,
    superseded_reason: partial.superseded_reason ?? null,
    first_seen_at:     partial.first_seen_at ?? '2026-01-01T00:00:00Z',
    updated_at:        partial.updated_at ?? '2026-01-01T00:00:00Z',
  };
}

/** A rich, realistic atom set for a coaching/service business. */
export function sampleInsights(): Insight[] {
  return [
    // bridge
    atom({ id: 'angle_low',  layer: 'bridge', kind: 'angle', content: 'Generic "we are the best" angle', confidence: 0.45 }),
    atom({ id: 'angle_high', layer: 'bridge', kind: 'angle', content: 'From overwhelmed to in-control in 30 days', confidence: 0.82 }),
    atom({ id: 'vt_1',       layer: 'bridge', kind: 'value_translation', content: 'Our system = their freedom', confidence: 0.7 }),
    atom({ id: 'platform_1', layer: 'bridge', kind: 'platform', content: 'Instagram Reels for this audience', confidence: 0.75 }),
    atom({ id: 'hook_1',     layer: 'bridge', kind: 'hook', content: 'Still doing X the hard way?', confidence: 0.6 }),
    // customers
    atom({ id: 'persona_1',  layer: 'customers', kind: 'persona', content: 'Female solopreneurs 30-45 drowning in admin', confidence: 0.78, structured: { age_min: 30, age_max: 45, genders: 'female' } }),
    atom({ id: 'pain_1',     layer: 'customers', kind: 'pain', content: 'No time, working nights', confidence: 0.8 }),
    atom({ id: 'desire_1',   layer: 'customers', kind: 'desire', content: 'Wants weekends back', confidence: 0.72 }),
    atom({ id: 'aware_1',    layer: 'customers', kind: 'awareness', content: 'Solution-aware', confidence: 0.65 }),
    atom({ id: 'objection_1',layer: 'customers', kind: 'objection', content: 'Too expensive / "I can do it myself"', confidence: 0.8 }),
    // business
    atom({ id: 'usp_1',      layer: 'business', kind: 'real_usp', content: 'Done-for-you in 48h', confidence: 0.85 }),
    atom({ id: 'constraint_1', layer: 'business', kind: 'constraint', content: 'Serves the Tel Aviv area only (location-bound)', confidence: 0.6 }),
  ];
}
