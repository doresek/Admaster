import { describe, expect, it } from 'vitest';
import { CONTESTED_BAND, DEFAULT_ARM_COUNT, loadOpenCandidates } from '../load';
import { CLIENT, OWNER, atom, hypothesisRow } from './fixtures';
import { mockSupabase } from './mock-supabase';

function seededHarness() {
  const harness = mockSupabase();
  // Spread into fresh literals so the typed fixtures satisfy MockRow's index
  // signature (same pattern as lib/hypotheses/__tests__).
  harness.seed('hypotheses', [
    // In scope: open, right client + owner.
    { ...hypothesisRow({ id: 'hyp-open-multi', insight_ids: ['a1', 'a2'] }) },
    { ...hypothesisRow({ id: 'hyp-open-contested', insight_ids: ['a-contested'], test_refs: [] }) },
    { ...hypothesisRow({ id: 'hyp-open-settled', insight_ids: ['a-settled'] }) },
    // Out of scope: resolved / other client / other owner.
    { ...hypothesisRow({ id: 'hyp-resolved', status: 'supported' }) },
    { ...hypothesisRow({ id: 'hyp-other-client', client_id: 'client-2' }) },
    { ...hypothesisRow({ id: 'hyp-other-owner', owner_user_id: 'owner-2' }) },
  ]);
  harness.seed('client_insights', [
    { ...atom({ id: 'a1', client_id: CLIENT, confidence: 0.5 }) },
    { ...atom({ id: 'a2', client_id: CLIENT, confidence: 0.6 }) },
    { ...atom({ id: 'a-contested', client_id: CLIENT, confidence: 0.5 }) },
    { ...atom({ id: 'a-settled', client_id: CLIENT, confidence: 0.9 }) },
    // Out of scope: inactive / other client.
    { ...atom({ id: 'a-superseded', client_id: CLIENT, status: 'superseded' }) },
    { ...atom({ id: 'a-foreign', client_id: 'client-2' }) },
  ]);
  return harness;
}

describe('loadOpenCandidates', () => {
  it('returns only OPEN hypotheses scoped to the client + owner', async () => {
    const harness = seededHarness();
    const { candidates } = await loadOpenCandidates(harness.client, CLIENT, OWNER);
    expect(candidates.map((c) => c.id).sort()).toEqual([
      'hyp-open-contested',
      'hyp-open-multi',
      'hyp-open-settled',
    ]);
  });

  it('returns only ACTIVE insights for the client', async () => {
    const harness = seededHarness();
    const { insights } = await loadOpenCandidates(harness.client, CLIENT, OWNER);
    expect(insights.map((i) => i.id).sort()).toEqual(['a-contested', 'a-settled', 'a1', 'a2']);
  });

  it('issues exactly ONE query per table', async () => {
    const harness = seededHarness();
    await loadOpenCandidates(harness.client, CLIENT, OWNER);
    expect(harness.log.filter((q) => q === 'select:hypotheses')).toHaveLength(1);
    expect(harness.log.filter((q) => q === 'select:client_insights')).toHaveLength(1);
    expect(harness.log).toHaveLength(2);
  });

  it('classifies candidate kinds from the ledger view (§5 ladder)', async () => {
    const harness = seededHarness();
    const { candidates } = await loadOpenCandidates(harness.client, CLIENT, OWNER);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    // ≥2 atoms → the verdict gates multiple beliefs.
    expect(byId.get('hyp-open-multi')?.kind).toBe('decision_unblocking');
    // Single mid-band atom (0.5 ∈ [0.35..0.65]) → contested.
    expect(byId.get('hyp-open-contested')?.kind).toBe('contested_atom');
    // Single settled atom (0.9) → wild variant slot.
    expect(byId.get('hyp-open-settled')?.kind).toBe('wild_variant');
    expect(CONTESTED_BAND.min).toBeLessThan(CONTESTED_BAND.max);
  });

  it('carries the frozen registration through (floor, horizon, arms, row)', async () => {
    const harness = seededHarness();
    const { candidates } = await loadOpenCandidates(harness.client, CLIENT, OWNER);
    const multi = candidates.find((c) => c.id === 'hyp-open-multi');
    expect(multi?.floor_spec).toEqual({ metric_grade: 'ctr', per_arm: { impressions: 1000 } });
    expect(multi?.arm_count).toBe(2); // from test_refs
    expect(multi?.hypothesis?.id).toBe('hyp-open-multi');
    // No test_refs yet → a comparison still needs two arms.
    const contested = candidates.find((c) => c.id === 'hyp-open-contested');
    expect(contested?.arm_count).toBe(DEFAULT_ARM_COUNT);
  });

  it('propagates hypothesis-query errors (never swallowed)', async () => {
    const harness = seededHarness();
    harness.failOn.add('select:hypotheses');
    await expect(loadOpenCandidates(harness.client, CLIENT, OWNER)).rejects.toThrow(
      'listHypotheses: forced failure: select:hypotheses',
    );
  });

  it('propagates insight-query errors (never swallowed)', async () => {
    const harness = seededHarness();
    harness.failOn.add('select:client_insights');
    await expect(loadOpenCandidates(harness.client, CLIENT, OWNER)).rejects.toThrow(
      'forced failure: select:client_insights',
    );
  });
});
