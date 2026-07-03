// Shared fixtures for the C-11 portfolio tests: atom builders, candidate
// builders and open hypothesis rows. Every test overrides ONLY the fields
// under test so failures point at one rule (same doctrine as
// lib/hypotheses/__tests__/fixtures).

import type { HypothesisRow } from '@/lib/capability-contracts';
import type { ClientInsight } from '@/lib/intelligence/types';
import type { HypothesisCandidate, UnitCosts } from '../types';

export const CLIENT = 'client-1';
export const OWNER  = 'owner-1';

let atomSeq = 0;

/** A minimal active atom; confidence/layer are what the scorers read. */
export function atom(overrides: Partial<ClientInsight> = {}): ClientInsight {
  atomSeq += 1;
  return {
    id:                `atom-${atomSeq}`,
    client_id:         CLIENT,
    owner_user_id:     OWNER,
    layer:             'customers',
    kind:              'pain',
    content:           'fixture atom',
    structured:        null,
    source:            'brief',
    source_ref:        null,
    confidence:        0.5,
    evidence_count:    1,
    status:            'active',
    superseded_by:     null,
    superseded_reason: null,
    first_seen_at:     '2026-06-01T00:00:00.000Z',
    updated_at:        '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

/** N high-confidence bridge atoms (the maturity signal). */
export function bridgeAtoms(count: number, confidence = 0.8): ClientInsight[] {
  return Array.from({ length: count }, (_, i) =>
    atom({ id: `bridge-${i + 1}`, layer: 'bridge', kind: 'angle', confidence }),
  );
}

export function candidate(overrides: Partial<HypothesisCandidate> = {}): HypothesisCandidate {
  return {
    id:          'cand-1',
    claim:       'angle atom A beats angle atom B for sub-audience X',
    insight_ids: ['atom-a'],
    domain:      'creative',
    kind:        'contested_atom',
    floor_spec:  { metric_grade: 'ctr', per_arm: { impressions: 1000 } },
    horizon:     { max_days: 10 },
    arm_count:   2,
    ...overrides,
  };
}

export function hypothesisRow(overrides: Partial<HypothesisRow> = {}): HypothesisRow {
  return {
    id:            'hyp-1',
    client_id:     CLIENT,
    owner_user_id: OWNER,
    insight_ids:   ['atom-a'],
    claim:         'fixture hypothesis',
    prediction:    { metric: 'ctr', comparator: 'ratio_gte', value: 1.3, arm: 'A', baseline_arm: 'B', confidence: 0.7 },
    floor_spec:    { metric_grade: 'ctr', per_arm: { impressions: 1000 } },
    horizon:       { max_days: 10 },
    verdict_map: {
      supported:    [{ insight_id: 'atom-a', polarity: 'positive', weight: 0.6 }],
      refuted:      [{ insight_id: 'atom-a', polarity: 'negative', weight: 0.6 }],
      inconclusive: [],
    },
    kill_rules:    {},
    test_refs:     [{ arm_label: 'A' }, { arm_label: 'B' }],
    domain:        'creative',
    status:        'open',
    resolution:    null,
    registered_at: '2026-07-01T00:00:00.000Z',
    resolved_at:   null,
    superseded_by: null,
    created_at:    '2026-07-01T00:00:00.000Z',
    updated_at:    '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

export const UNIT_COSTS: UnitCosts = {
  expected_cpm: 20,   // ₪20 per 1,000 impressions
  expected_cpc: 1.5,  // ₪1.50 per click
  expected_cpa: 40,   // ₪40 per conversion
};

/** Deterministic Fisher–Yates with a fixed LCG — shuffles for determinism tests. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
