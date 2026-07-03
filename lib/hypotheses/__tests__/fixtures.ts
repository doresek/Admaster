// Shared fixtures for the hypothesis-ledger tests: a fully valid registration,
// a frozen open hypothesis row, and small builders for observations. Every
// test overrides ONLY the field under test so failures point at one rule.

import type {
  FloorSpec,
  HypothesisRow,
  Prediction,
  VerdictMap,
} from '@/lib/capability-contracts';
import type { ArmObservation, RegisterHypothesisInput } from '../types';

export const CLIENT = 'client-1';
export const OWNER  = 'owner-1';
export const ATOM_1 = '00000000-0000-4000-8000-000000000001';
export const ATOM_2 = '00000000-0000-4000-8000-000000000002';

export function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    metric:       'cvr',
    comparator:   'ratio_gte',
    value:        1.3,
    arm:          'A',
    baseline_arm: 'B',
    confidence:   0.7,
    ...overrides,
  };
}

export function floorSpec(overrides: Partial<FloorSpec> = {}): FloorSpec {
  return { metric_grade: 'cvr', per_arm: { clicks: 100 }, ...overrides };
}

export function verdictMap(overrides: Partial<VerdictMap> = {}): VerdictMap {
  return {
    supported: [
      { insight_id: ATOM_1, polarity: 'positive', weight: 0.6 },
      { insight_id: ATOM_2, polarity: 'positive', weight: 0.5 },
    ],
    refuted:      [{ insight_id: ATOM_1, polarity: 'negative', weight: 0.6 }],
    inconclusive: [],
    ...overrides,
  };
}

export function registration(overrides: Partial<RegisterHypothesisInput> = {}): RegisterHypothesisInput {
  return {
    clientId:    CLIENT,
    ownerUserId: OWNER,
    insightIds:  [ATOM_1, ATOM_2],
    claim:       'angle atom #1 (emotional safety) beats angle atom #2 (price) for sub-audience X',
    prediction:  prediction(),
    floorSpec:   floorSpec(),
    horizon:     { max_days: 14 },
    verdictMap:  verdictMap(),
    killRules: {
      mercy:        { min_floor_multiple: 2, max_fraction_of_leader: 0.5 },
      catastrophic: { spend_multiple: 3, expected_cost_per_result: 40 },
    },
    testRefs: [{ arm_label: 'A' }, { arm_label: 'B' }],
    domain:   'angle',
    ...overrides,
  };
}

export function hypothesisRow(overrides: Partial<HypothesisRow> = {}): HypothesisRow {
  return {
    id:            'hyp-1',
    client_id:     CLIENT,
    owner_user_id: OWNER,
    insight_ids:   [ATOM_1, ATOM_2],
    claim:         'angle atom #1 beats angle atom #2 for sub-audience X',
    prediction:    prediction(),
    floor_spec:    floorSpec(),
    horizon:       { max_days: 14, max_spend: 1000 },
    verdict_map:   verdictMap(),
    kill_rules: {
      mercy:        { min_floor_multiple: 2, max_fraction_of_leader: 0.5 },
      catastrophic: { spend_multiple: 3, expected_cost_per_result: 40 },
    },
    test_refs:     [{ arm_label: 'A' }, { arm_label: 'B' }],
    domain:        'angle',
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

export function obs(arm: string, fields: Omit<ArmObservation, 'arm'> = {}): ArmObservation {
  return { arm, ...fields };
}
