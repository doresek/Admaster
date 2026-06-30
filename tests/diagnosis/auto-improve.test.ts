// Tests for lib/diagnosis/auto-improve.ts — regenerate ONLY the failed link,
// queue an A/B campaign_items challenger, and emit EXACTLY ONE learning_signal
// fed through the REAL lib/intelligence lifecycle path.
import { describe, it, expect, vi } from 'vitest';
import { autoImprove, type DiagnosisRecord, type RegenerateFn } from '@/lib/diagnosis/auto-improve';
import type { Insight } from '@/lib/decision-engine';
import { makeFakeSupabase } from '../performance/fake-supabase';

const objection = (over: Partial<Insight> = {}): Insight => ({
  id: 'ins-obj', client_id: 'c1', owner_user_id: 'u1',
  layer: 'customers', kind: 'objection', content: 'המחיר גבוה מדי בשבילי',
  structured: null, source: 'brief', source_ref: null,
  confidence: 0.7, evidence_count: 3, status: 'active',
  superseded_by: null, superseded_reason: null,
  first_seen_at: 't', updated_at: 't', ...over,
});

const offerDiagnosis = (over: Partial<DiagnosisRecord> = {}): DiagnosisRecord => ({
  id: 'd1', client_id: 'c1', owner_user_id: 'u1',
  failed_link: 'offer', target_insight_ids: ['ins-obj'],
  recommended_action: { action: 'address_objection' },
  scope_artifact_id: 'a1', scope_campaign_id: 'camp1', ...over,
});

const regenStub: RegenerateFn = async (input) => ({
  artifactId: 'a2new',
  itemType: 'ad',
  content: { headline: `new ${input.failedLink} framing` },
  rationale: `regenerated ${input.failedLink}`,
});

describe('autoImprove', () => {
  it('regenerates ONLY the failed link and queues an A/B campaign_items challenger', async () => {
    const fake = makeFakeSupabase({
      // the original item, so ab_parent_id can be resolved by scope_artifact_id
      campaign_items: [{ id: 'ci1', artifact_id: 'a1', campaign_id: 'camp1' }],
      client_insights: [objection()],
      diagnoses: [{ id: 'd1', applied: false }],
    });
    const regenerate = vi.fn(regenStub);

    const res = await autoImprove(offerDiagnosis(), { admin: fake.client as any, regenerate });

    // Only the failed link was regenerated.
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate.mock.calls[0][0].failedLink).toBe('offer');

    // A/B challenger queued with ab_parent_id → the original item.
    const items = fake.tables['campaign_items'];
    const challenger = items.find((i) => i.id === res.newItemId);
    expect(challenger).toBeTruthy();
    expect(challenger.ab_parent_id).toBe('ci1');
    expect(challenger.campaign_id).toBe('camp1');
    expect(challenger.item_type).toBe('ad');
    expect(challenger.artifact_id).toBe('a2new');
    expect(challenger.grounded_in).toEqual(['ins-obj']);

    // Diagnosis marked applied with the new item id.
    expect(res.diagnosisApplied).toBe(true);
    const diag = fake.tables['diagnoses'].find((d) => d.id === 'd1');
    expect(diag.applied).toBe(true);
    expect(diag.applied_item_id).toBe(res.newItemId);
  });

  it('emits EXACTLY ONE learning_signal with the correct polarity and feeds it through the lifecycle', async () => {
    const fake = makeFakeSupabase({
      campaign_items: [{ id: 'ci1', artifact_id: 'a1', campaign_id: 'camp1' }],
      client_insights: [objection({ confidence: 0.7 })],
      diagnoses: [{ id: 'd1', applied: false }],
    });

    const res = await autoImprove(offerDiagnosis(), { admin: fake.client as any, regenerate: regenStub });

    // Exactly one learning_signals row, negative (a performance loss).
    const signals = fake.tables['learning_signals'];
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      client_id: 'c1', signal_type: 'performance_loss', polarity: 'negative',
      insight_id: 'ins-obj', artifact_id: 'a1', processed: true,
    });
    expect(res.polarity).toBe('negative');

    // The REAL lifecycle path ran: the target atom was weakened + audited.
    expect(res.appliedToInsights).toBe(1);
    const atom = fake.tables['client_insights'].find((i) => i.id === 'ins-obj');
    expect(atom.confidence).toBeLessThan(0.7);
    expect(fake.tables['insight_events'].some((e) => e.insight_id === 'ins-obj')).toBe(true);
  });

  it('uses the injectable signal writer / applier without touching the moat lifecycle', async () => {
    const fake = makeFakeSupabase({
      campaign_items: [{ id: 'ci1', artifact_id: 'a1', campaign_id: 'camp1' }],
      client_insights: [objection()],
      diagnoses: [{ id: 'd1', applied: false }],
    });
    const applySignal: typeof import('@/lib/intelligence/lifecycle').applyLearningSignal =
      vi.fn(async () => null);
    const applySpy = applySignal as unknown as ReturnType<typeof vi.fn>;

    const res = await autoImprove(offerDiagnosis(), {
      admin: fake.client as any,
      regenerate: regenStub,
      applySignal,
      loadInsights: async () => [objection()],
    });

    expect(applySpy).toHaveBeenCalledTimes(1);
    const [, atom, signal] = applySpy.mock.calls[0];
    expect((atom as any).id).toBe('ins-obj');
    expect((signal as any).polarity).toBe('negative');
    expect(res.appliedToInsights).toBe(1);
  });

  it('is graceful when the 030 tables are absent — still emits the learning_signal (Phase A)', async () => {
    // campaign_items + diagnoses are 030 (absent here); learning_signals +
    // client_insights are Phase-A (028) and remain available.
    const fake = makeFakeSupabase(
      { client_insights: [objection()] },
      { failTables: ['campaign_items', 'diagnoses'] },
    );

    const res = await autoImprove(offerDiagnosis(), { admin: fake.client as any, regenerate: regenStub });

    expect(res.newItemId).toBeNull();        // couldn't queue the A/B item
    expect(res.diagnosisApplied).toBe(false); // couldn't mark the diagnosis
    expect(res.signalId).not.toBeNull();      // but the loop still closed
    expect(fake.tables['learning_signals']).toHaveLength(1);
    expect(res.appliedToInsights).toBe(1);
  });

  it('emits a positive performance_win signal when the diagnosis is "none"', async () => {
    const fake = makeFakeSupabase({
      client_insights: [objection()],
      diagnoses: [{ id: 'd1', applied: false }],
    });
    const res = await autoImprove(
      offerDiagnosis({ failed_link: 'none', target_insight_ids: [] }),
      { admin: fake.client as any, regenerate: regenStub },
    );
    expect(res.polarity).toBe('positive');
    expect(fake.tables['learning_signals'][0]).toMatchObject({ signal_type: 'performance_win', polarity: 'positive' });
  });
});
