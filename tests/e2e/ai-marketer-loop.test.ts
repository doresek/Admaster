// END-TO-END (in-process, dry-run) — the full "AI marketer" loop wired from the
// REAL modules, no network, no live Meta, no real DB:
//
//   living understanding (atoms)
//      → decide()                         the moat: insight-driven plan
//      → runCampaign() [dry-run]          assemble a PAUSED campaign, grounded
//      → ingestPerformance()              measure (simulated: good CTR, dead conversions)
//      → diagnoseCampaignItem()           which LINK failed — reasoned from the insight
//      → autoImprove()                    regenerate that link + A/B + fold the loss back
//      → the SAME atom's confidence drops the understanding updated itself
//
// The point this proves: the system does NOT guess from metrics. It grounds the
// decision in living atoms, and when the ad underperforms it blames the OFFER (not
// the creative) *because an active objection atom is unresolved* — then weakens
// that exact atom. Understanding drives the decision AND the diagnosis, and the
// failure teaches the brain.
import { describe, it, expect } from 'vitest';
import { decide } from '@/lib/decision-engine';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';
import { runCampaign, inMemoryCampaignStore, type GenerateCreative } from '@/lib/campaigns';
import { MetaAdsClient } from '@/lib/meta-ads';
import { ingestPerformance } from '@/lib/performance';
import { diagnoseCampaignItem } from '@/lib/diagnosis';
import { autoImprove, type DiagnosisRecord } from '@/lib/diagnosis/auto-improve';
import { makeFakeSupabase } from '../performance/fake-supabase';

const CLIENT = 'client_1';
const OWNER = 'owner_1';
const AD_ARTIFACT = 'ad_artifact_1';

describe('AI-marketer closed loop (dry-run, real modules)', () => {
  it('understanding → decision → campaign → measure → diagnosis → auto-improve → atom update', async () => {
    const insights = sampleInsights(); // includes the active "objection_1" atom @0.8
    const objectionBefore = insights.find((i) => i.id === 'objection_1')!.confidence;
    expect(objectionBefore).toBe(0.8);

    // ── 1. DECISION (the moat — real) ────────────────────────────────────────
    const decision = decide({ client: { id: CLIENT, name: 'Acme' }, insights, strategy: null });
    expect(decision.grounded_in.length).toBeGreaterThan(0); // insight-driven, not blank
    expect(decision.rationale).toMatch(/\S/);

    // ── 2. CAMPAIGN (dry-run; runner calls the real decide internally) ───────
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });
    const generate: GenerateCreative = async () => ({
      post: 'פוסט שמבוסס על התובנות החיות של הלקוח',
      imageUrl: 'https://cdn.example/ad.jpg',
      artifactId: AD_ARTIFACT,
    });
    const camp = await runCampaign(
      { clientId: CLIENT, channel: 'meta_paid', ownerUserId: OWNER },
      { generate, store, loadInsights: async () => insights, loadStrategy: async () => null, loadClient: async () => ({ id: CLIENT, name: 'Acme' }), metaAds: ads },
    );
    // assembled, grounded, and — critically — NOTHING went live / nothing spent.
    expect(camp.campaign.dry_run).toBe(true);
    expect(camp.campaign.status).toBe('assembled');
    expect(camp.campaign.grounded_in).toEqual(decision.grounded_in);
    expect(ads.calls.length).toBeGreaterThan(0);
    expect(ads.calls.every((c) => c.dryRun === true)).toBe(true);
    for (const c of ads.calls) if ('status' in c.params) expect(c.params.status).toBe('PAUSED');

    // The shared brain store the diagnosis + lifecycle will read/update.
    const fake = makeFakeSupabase({
      client_insights: insights,                                         // the living atoms
      campaign_items: [{ id: 'ci1', artifact_id: AD_ARTIFACT, campaign_id: 'camp1' }],
      diagnoses: [],
    });

    // ── 3. MEASURE — simulate the ad ran: good CTR, dead conversions ─────────
    const perf = await ingestPerformance(
      [{ artifact_id: AD_ARTIFACT, campaign_item_id: 'ci1', ad_id: 'ad_1', client_id: CLIENT, owner_user_id: OWNER,
         metrics: { impressions: 5000, clicks: 100, ctr: 0.02, conversions: 1, conversion_rate: 0.002, spend: 400 } }],
      { admin: fake.client as any },
    );
    expect(['failed', 'underperformed']).toContain(perf.rows[0].verdict);

    // ── 4. DIAGNOSE — reasoned THROUGH the living insight ────────────────────
    const diag = await diagnoseCampaignItem(
      { clientId: CLIENT, ownerUserId: OWNER, scopeArtifactId: AD_ARTIFACT, scopeCampaignId: 'camp1',
        performance: { metrics: { impressions: 5000, ctr: 0.02, conversion_rate: 0.002 } } },
      { admin: fake.client as any, loadInsights: async () => insights },
    );
    // The differentiator: OFFER failed (an unresolved objection), NOT the creative.
    expect(diag.diagnosis.failed_link).toBe('offer');
    expect(diag.diagnosis.target_insight_ids).toContain('objection_1');
    expect(diag.persisted).toBe(true);

    // ── 5. AUTO-IMPROVE — regenerate the offer link, A/B, fold the loss back ──
    const record: DiagnosisRecord = {
      id: diag.row?.id ?? 'd1',
      client_id: CLIENT, owner_user_id: OWNER,
      failed_link: 'offer', target_insight_ids: ['objection_1'],
      recommended_action: diag.diagnosis.recommended_action ?? {},
      scope_artifact_id: AD_ARTIFACT, scope_campaign_id: 'camp1',
    };
    const improve = await autoImprove(record, {
      admin: fake.client as any,
      regenerate: async (input) => ({
        artifactId: 'ad_artifact_2', itemType: 'ad',
        content: { headline: `new ${input.failedLink} framing that handles the price objection` },
        rationale: `regenerated ${input.failedLink}`,
      }),
    });

    // ── 6. LOOP CLOSED — the brain updated itself from the failure ───────────
    expect(improve.signalId).not.toBeNull();
    expect(improve.polarity).toBe('negative');           // a performance loss
    expect(improve.appliedToInsights).toBe(1);
    // the SAME atom that explains the customer's real concern was weakened + audited
    const objectionAfter = fake.tables['client_insights'].find((i: any) => i.id === 'objection_1').confidence;
    expect(objectionAfter).toBeLessThan(objectionBefore);
    expect(fake.tables['insight_events'].some((e: any) => e.insight_id === 'objection_1')).toBe(true);
    // and an A/B challenger was queued against the original ad
    const challenger = fake.tables['campaign_items'].find((i: any) => i.id === improve.newItemId);
    expect(challenger).toBeTruthy();
    expect(challenger.ab_parent_id).toBe('ci1');
    expect(challenger.artifact_id).toBe('ad_artifact_2');
  });
});
