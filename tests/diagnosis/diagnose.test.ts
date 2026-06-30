// Tests for lib/diagnosis/diagnose.ts — uses the REAL decision-engine
// diagnoseFailure() over fixture insights (the moat is never mocked); only the
// DB is faked.
import { describe, it, expect } from 'vitest';
import { diagnoseCampaignItem } from '@/lib/diagnosis/diagnose';
import type { Insight } from '@/lib/decision-engine';
import { makeFakeSupabase } from '../performance/fake-supabase';

const insight = (over: Partial<Insight> = {}): Insight => ({
  id: 'i1', client_id: 'c1', owner_user_id: 'u1',
  layer: 'customers', kind: 'objection', content: 'יקר לי מדי',
  structured: null, source: 'brief', source_ref: null,
  confidence: 0.7, evidence_count: 1, status: 'active',
  superseded_by: null, superseded_reason: null,
  first_seen_at: 't', updated_at: 't', ...over,
});

describe('diagnoseCampaignItem', () => {
  it('good CTR + dead conversions + active objection atom → OFFER (not creative), targeting the objection', async () => {
    const fake = makeFakeSupabase();
    const objection = insight({ id: 'ins-obj', kind: 'objection', content: 'המחיר גבוה מדי בשבילי' });

    const res = await diagnoseCampaignItem(
      {
        clientId: 'c1',
        ownerUserId: 'u1',
        scopeArtifactId: 'a1',
        scopeCampaignId: 'camp1',
        performance: { metrics: { impressions: 5000, ctr: 0.02, conversion_rate: 0.002 } },
      },
      { admin: fake.client as any, loadInsights: async () => [objection] },
    );

    // The differentiator: it's the OFFER that failed, not the creative.
    expect(res.diagnosis.failed_link).toBe('offer');
    expect(res.diagnosis.target_insight_ids).toEqual(['ins-obj']);

    // Persisted to diagnoses.
    expect(res.persisted).toBe(true);
    const written = fake.tables['diagnoses'];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      client_id: 'c1', failed_link: 'offer', scope_artifact_id: 'a1', scope_campaign_id: 'camp1',
      target_insight_ids: ['ins-obj'], applied: false,
    });
    expect(written[0].evidence.metrics.ctr).toBe(0.02);
  });

  it('same metrics but NO objection atom → FUNNEL (audit the landing page)', async () => {
    const fake = makeFakeSupabase();
    const res = await diagnoseCampaignItem(
      {
        clientId: 'c1', ownerUserId: 'u1', scopeArtifactId: 'a1',
        performance: { metrics: { impressions: 5000, ctr: 0.02, conversion_rate: 0.002 } },
      },
      { admin: fake.client as any, loadInsights: async () => [] },
    );
    expect(res.diagnosis.failed_link).toBe('funnel');
    expect(res.diagnosis.target_insight_ids).toEqual([]);
  });

  it('high impressions + low CTR with a hook atom → HOOK', async () => {
    const fake = makeFakeSupabase();
    const hook = insight({ id: 'ins-hook', layer: 'bridge', kind: 'hook', content: 'תפסיקו לבזבז כסף' });
    const res = await diagnoseCampaignItem(
      {
        clientId: 'c1', ownerUserId: 'u1', scopeArtifactId: 'a1',
        performance: { metrics: { impressions: 5000, ctr: 0.003 } },
      },
      { admin: fake.client as any, loadInsights: async () => [hook] },
    );
    expect(res.diagnosis.failed_link).toBe('hook');
    expect(res.diagnosis.target_insight_ids).toEqual(['ins-hook']);
  });

  it('is graceful when the diagnoses table is absent — still returns the diagnosis', async () => {
    const fake = makeFakeSupabase({}, { failTables: ['diagnoses'] });
    const res = await diagnoseCampaignItem(
      {
        clientId: 'c1', ownerUserId: 'u1', scopeArtifactId: 'a1',
        performance: { metrics: { impressions: 5000, ctr: 0.02, conversion_rate: 0.002 } },
      },
      { admin: fake.client as any, loadInsights: async () => [insight({ id: 'ins-obj' })] },
    );
    expect(res.diagnosis.failed_link).toBe('offer');
    expect(res.persisted).toBe(false);
    expect(res.row).toBeNull();
  });
});
