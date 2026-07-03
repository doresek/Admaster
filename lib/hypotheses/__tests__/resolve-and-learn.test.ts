// resolveAndLearn + guarded registration against the in-memory Supabase stub:
// proves the verdict is persisted ONCE, learning_signals rows carry the FROZEN
// verdict_map polarity/weights, atoms move through the real lifecycle engine
// (insight_events written, confidence math owned by lib/intelligence), and
// replays/races emit nothing.

import { describe, it, expect } from 'vitest';
import { CONFIDENCE, type ClientInsight } from '@/lib/intelligence/types';
import { findPriorResolutions, registerHypothesisChecked, resolveAndLearn } from '../resolve-and-learn';
import { supersedeHypothesis } from '../store';
import { mockSupabase, type MockRow } from './mock-supabase';
import { ATOM_1, ATOM_2, CLIENT, OWNER, hypothesisRow, obs, registration, verdictMap } from './fixtures';

const NOW = new Date('2026-07-10T00:00:00.000Z');

function atomRow(id: string, overrides: Partial<ClientInsight> = {}): MockRow {
  return {
    id,
    client_id:         CLIENT,
    owner_user_id:     OWNER,
    layer:             'bridge',
    kind:              'angle',
    content:           `atom ${id}`,
    structured:        null,
    source:            'ai_synthesis',
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

/** Floor-met observations where cvr(A)/cvr(B) = 2 ≥ 1.3 → supported. */
const SUPPORTED_OBS = [
  obs('A', { clicks: 150, metrics: { cvr: 0.10 } }),
  obs('B', { clicks: 150, metrics: { cvr: 0.05 } }),
];
/** Floor-met observations where the ratio is 1.2 < 1.3 → refuted. */
const REFUTED_OBS = [
  obs('A', { clicks: 150, metrics: { cvr: 0.06 } }),
  obs('B', { clicks: 150, metrics: { cvr: 0.05 } }),
];

function seededMock(hypothesis = hypothesisRow()) {
  const mock = mockSupabase();
  mock.seed('hypotheses', [{ ...hypothesis }]);
  mock.seed('client_insights', [atomRow(ATOM_1), atomRow(ATOM_2)]);
  return mock;
}

describe('resolveAndLearn — supported path', () => {
  it('persists the resolution once and emits one frozen-weight signal per verdict_map move, applied through the lifecycle', async () => {
    const hypothesis = hypothesisRow();
    const mock = seededMock(hypothesis);

    const result = await resolveAndLearn(mock.client, hypothesis, SUPPORTED_OBS, { now: NOW });

    expect(result.applied).toBe(true);
    expect(result.status).toBe('supported');
    expect(result.moves.map((m) => m.outcome)).toEqual(['applied', 'applied']);

    // The ledger row is resolved, with the observed snapshot and provenance.
    expect(mock.rows('hypotheses')[0]).toMatchObject({
      status:      'supported',
      resolved_at: NOW.toISOString(),
      resolution:  { resolved_by: 'floor_met' },
    });

    // One learning_signals row per FROZEN move — polarity/weight verbatim.
    const signals = mock.rows('learning_signals');
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      insight_id: ATOM_1, signal_type: 'hypothesis_supported',
      polarity: 'positive', weight: 0.6, processed: true,
      metrics: { hypothesis_id: hypothesis.id },
    });
    expect(signals[1]).toMatchObject({ insight_id: ATOM_2, weight: 0.5, processed: true });

    // Confidence moved by the LIFECYCLE's math (start + STEP×weight), audited.
    expect(mock.rows('client_insights')[0]).toMatchObject({
      confidence:     0.5 + CONFIDENCE.STEP * 0.6,
      evidence_count: 2,
    });
    const events = mock.rows('insight_events');
    expect(events.filter((e) => e.event === 'corroborated')).toHaveLength(2);
    expect(events[0]).toMatchObject({ insight_id: ATOM_1, signal_id: signals[0].id });
  });
});

describe('resolveAndLearn — refuted path', () => {
  it('emits hypothesis_refuted and lets a decisive negative REFUTE the atom (never touching confidence math itself)', async () => {
    const hypothesis = hypothesisRow({
      verdict_map: verdictMap({
        refuted: [{ insight_id: ATOM_1, polarity: 'negative', weight: CONFIDENCE.DECISIVE_WEIGHT }],
      }),
    });
    const mock = seededMock(hypothesis);

    const result = await resolveAndLearn(mock.client, hypothesis, REFUTED_OBS, { now: NOW });

    expect(result.status).toBe('refuted');
    expect(result.moves).toEqual([
      expect.objectContaining({ insight_id: ATOM_1, outcome: 'atom_refuted' }),
    ]);
    expect(mock.rows('learning_signals')[0]).toMatchObject({ signal_type: 'hypothesis_refuted', polarity: 'negative' });
    expect(mock.rows('client_insights')[0]).toMatchObject({ id: ATOM_1, status: 'refuted' });
    expect(mock.rows('insight_events').some((e) => e.event === 'refuted')).toBe(true);
  });
});

describe('resolveAndLearn — inconclusive path', () => {
  it('floor unmet → inconclusive persisted with ZERO emissions', async () => {
    const hypothesis = hypothesisRow();
    const mock = seededMock(hypothesis);

    const result = await resolveAndLearn(mock.client, hypothesis, [obs('A', { clicks: 10, metrics: { cvr: 0.9 } })], { now: NOW });

    expect(result.applied).toBe(true);
    expect(result.status).toBe('inconclusive');
    expect(result.moves).toEqual([]);
    expect(mock.rows('hypotheses')[0]).toMatchObject({ status: 'inconclusive' });
    expect(mock.rows('learning_signals')).toHaveLength(0);
    expect(mock.rows('insight_events')).toHaveLength(0);
  });

  it('a frozen non-empty inconclusive map is surfaced as unsupported_verdict, not silently emitted with a fake signal_type', async () => {
    const hypothesis = hypothesisRow({
      verdict_map: verdictMap({ inconclusive: [{ insight_id: ATOM_1, polarity: 'negative', weight: 0.2 }] }),
    });
    const mock = seededMock(hypothesis);

    const result = await resolveAndLearn(mock.client, hypothesis, [], { now: NOW });

    expect(result.moves).toEqual([
      expect.objectContaining({ insight_id: ATOM_1, outcome: 'unsupported_verdict', signal_id: null }),
    ]);
    expect(mock.rows('learning_signals')).toHaveLength(0);
  });
});

describe('resolveAndLearn — idempotency', () => {
  it('an already-resolved hypothesis is a no-op returning the existing resolution, with zero writes', async () => {
    const resolution = {
      observed: {}, verdict_reason: 'earlier run', resolved_by: 'floor_met',
    } as const;
    const resolved = hypothesisRow({ status: 'supported', resolution: { ...resolution }, resolved_at: '2026-07-05T00:00:00.000Z' });
    const mock = seededMock(resolved);

    const result = await resolveAndLearn(mock.client, resolved, SUPPORTED_OBS, { now: NOW });

    expect(result.applied).toBe(false);
    expect(result.resolution).toEqual({ ...resolution });
    expect(result.moves).toEqual([]);
    expect(mock.log).toEqual([]); // NOT a single insert or update
  });

  it('a lost status CAS (concurrent resolver won) emits nothing and returns the persisted resolution', async () => {
    // The caller holds a stale 'open' copy, but the DB row is already resolved.
    const stale = hypothesisRow(); // status 'open'
    const mock = mockSupabase();
    mock.seed('hypotheses', [{
      ...hypothesisRow({
        status:     'refuted',
        resolution: { observed: {}, verdict_reason: 'rival run', resolved_by: 'floor_met' },
      }),
    }]);
    mock.seed('client_insights', [atomRow(ATOM_1), atomRow(ATOM_2)]);

    const result = await resolveAndLearn(mock.client, stale, SUPPORTED_OBS, { now: NOW });

    expect(result.applied).toBe(false);
    expect(result.status).toBe('refuted');
    expect(result.resolution).toMatchObject({ verdict_reason: 'rival run' });
    expect(mock.rows('learning_signals')).toHaveLength(0);
    expect(mock.rows('insight_events')).toHaveLength(0);
  });
});

describe('resolveAndLearn — partial-failure outcomes are data, the verdict stays durable', () => {
  it('a missing atom is recorded, the other moves still apply', async () => {
    const hypothesis = hypothesisRow();
    const mock = mockSupabase();
    mock.seed('hypotheses', [{ ...hypothesis }]);
    mock.seed('client_insights', [atomRow(ATOM_1)]); // ATOM_2 absent

    const result = await resolveAndLearn(mock.client, hypothesis, SUPPORTED_OBS, { now: NOW });

    expect(result.moves).toEqual([
      expect.objectContaining({ insight_id: ATOM_1, outcome: 'applied' }),
      expect.objectContaining({ insight_id: ATOM_2, outcome: 'atom_missing', signal_id: null }),
    ]);
    expect(mock.rows('learning_signals')).toHaveLength(1);
  });

  it('a failed signal insert is recorded per move; the resolution is already persisted', async () => {
    const mock = seededMock();
    mock.failOn.add('insert:learning_signals');

    const result = await resolveAndLearn(mock.client, hypothesisRow(), SUPPORTED_OBS, { now: NOW });

    expect(result.applied).toBe(true);
    expect(result.moves.every((m) => m.outcome === 'signal_insert_failed')).toBe(true);
    expect(mock.rows('hypotheses')[0]).toMatchObject({ status: 'supported' });
    expect(mock.rows('insight_events')).toHaveLength(0);
  });

  it('a lost signal claim skips the lifecycle apply (at-most-once per signal row)', async () => {
    const mock = seededMock();
    mock.failOn.add('update:learning_signals'); // claimSignal CAS fails → not won

    const result = await resolveAndLearn(mock.client, hypothesisRow(), SUPPORTED_OBS, { now: NOW });

    expect(result.moves.every((m) => m.outcome === 'claim_lost')).toBe(true);
    expect(mock.rows('insight_events')).toHaveLength(0);
    expect(mock.rows('client_insights')[0]).toMatchObject({ confidence: 0.5, evidence_count: 1 }); // untouched
  });
});

describe('registerHypothesisChecked — validation + "already tried" memory', () => {
  it('rejects an invalid registration with structured reasons and inserts NOTHING', async () => {
    const mock = mockSupabase();
    const result = await registerHypothesisChecked(mock.client, registration({ claim: '' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.map((r) => r.code)).toContain('empty_claim');
    expect(mock.rows('hypotheses')).toHaveLength(0);
    expect(mock.log).toEqual([]);
  });

  it('registers a valid hypothesis and surfaces overlapping resolved priors as warnings, not a block', async () => {
    const prior = hypothesisRow({ id: 'hyp-old', status: 'refuted', insight_ids: [ATOM_1] });
    const mock = mockSupabase();
    mock.seed('hypotheses', [{ ...prior }]);

    const result = await registerHypothesisChecked(mock.client, registration());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.priors.map((p) => p.id)).toEqual(['hyp-old']);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('hyp-old');
      expect(result.warnings[0]).toContain('refuted');
      expect(result.hypothesis.status).toBe('open');
    }
    expect(mock.rows('hypotheses')).toHaveLength(2);
  });

  it('an OPEN prior on the same atoms is not a warning — only resolved history counts', async () => {
    const mock = mockSupabase();
    mock.seed('hypotheses', [{ ...hypothesisRow({ id: 'hyp-open', status: 'open' }) }]);

    const result = await registerHypothesisChecked(mock.client, registration());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('priors on disjoint atoms are not warnings', async () => {
    const mock = mockSupabase();
    mock.seed('hypotheses', [{ ...hypothesisRow({ id: 'hyp-other', status: 'supported', insight_ids: ['other-atom'] }) }]);

    const result = await registerHypothesisChecked(mock.client, registration());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('findPriorResolutions with empty insight_ids returns [] without querying', async () => {
    const mock = mockSupabase();
    await expect(findPriorResolutions(mock.client, CLIENT, OWNER, [])).resolves.toEqual([]);
  });
});

describe('supersedeHypothesis — immutability by supersession', () => {
  it('inserts a NEW row and only marks the old one — every frozen field survives untouched', async () => {
    const original = hypothesisRow({ id: 'hyp-old' });
    const frozenSnapshot = structuredClone(original);
    const mock = mockSupabase();
    mock.seed('hypotheses', [{ ...original }]);

    const { superseded, replacement } = await supersedeHypothesis(
      mock.client, 'hyp-old', registration({ claim: 'corrected claim' }),
    );

    expect(replacement.id).not.toBe('hyp-old');
    expect(superseded.status).toBe('superseded');
    expect(superseded.superseded_by).toBe(replacement.id);

    const oldRow = mock.rows('hypotheses').find((r) => r.id === 'hyp-old');
    // Frozen registration fields are byte-identical to the pre-supersede row.
    expect(oldRow).toMatchObject({
      claim:         frozenSnapshot.claim,
      prediction:    frozenSnapshot.prediction,
      floor_spec:    frozenSnapshot.floor_spec,
      horizon:       frozenSnapshot.horizon,
      verdict_map:   frozenSnapshot.verdict_map,
      kill_rules:    frozenSnapshot.kill_rules,
      test_refs:     frozenSnapshot.test_refs,
      insight_ids:   frozenSnapshot.insight_ids,
      registered_at: frozenSnapshot.registered_at,
    });
    const newRow = mock.rows('hypotheses').find((r) => r.id === replacement.id);
    expect(newRow).toMatchObject({ claim: 'corrected claim', status: 'open', superseded_by: null });
  });

  it('refuses to supersede a resolved hypothesis — resolved history is not a draft', async () => {
    const mock = mockSupabase();
    mock.seed('hypotheses', [{ ...hypothesisRow({ id: 'hyp-done', status: 'supported' }) }]);

    await expect(supersedeHypothesis(mock.client, 'hyp-done', registration()))
      .rejects.toThrow(/not open/);
  });
});
