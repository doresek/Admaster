import { describe, it, expect } from 'vitest';
import {
  runCampaign,
  inMemoryCampaignStore,
  ilsToAgorot,
  mapGenders,
  type CampaignStore,
  type GenerateCreative,
  type GeneratedCreative,
} from '@/lib/campaigns';
import { decide } from '@/lib/decision-engine';
import { parseStrategyAnalysis } from '@/lib/validation';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';
import { MetaAdsClient } from '@/lib/meta-ads';
import { MetaPublishClient } from '@/lib/meta-publish';

// ── shared test deps ────────────────────────────────────────────────────────

const CLIENT_ID = 'client_1';
const OWNER = 'owner_1';

const insights = sampleInsights();
// The REAL decision the runner will reach with these fixtures (the moat is NOT
// mocked — we assert the runner faithfully records what `decide` produced).
const expectedDecision = decide({ client: { id: CLIENT_ID, name: 'Acme' }, insights, strategy: null });

function stubGenerate(extra: Partial<GeneratedCreative> = {}): GenerateCreative {
  return async () => ({
    post: 'פוסט שיווקי שנוצר על בסיס התובנות',
    hashtags: ['#x'],
    imageUrl: 'https://cdn.example/img.jpg',
    artifactId: 'artifact_1',
    ...extra,
  });
}

function commonDeps(store: CampaignStore, generate: GenerateCreative) {
  return {
    generate,
    store,
    loadInsights: async () => insights,
    loadStrategy: async () => null,
    loadClient: async () => ({ id: CLIENT_ID, name: 'Acme' }),
    // real decide() (default) — do NOT inject, so the moat runs for real.
  };
}

describe('runCampaign — meta_paid (dry-run)', () => {
  it('records a campaign grounded in exactly the decision insight ids', async () => {
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      { ...commonDeps(store, stubGenerate()), metaAds: ads },
    );

    expect(res.dryRun).toBe(true);
    expect(res.campaign.dry_run).toBe(true);
    expect(res.campaign.status).toBe('assembled');
    expect(res.campaign.channel).toBe('meta_paid');
    // grounded_in == the decision's insight ids
    expect(res.campaign.grounded_in).toEqual(expectedDecision.grounded_in);
    expect(res.campaign.grounded_in.length).toBeGreaterThan(0);
    expect(res.campaign.rationale).toBe(expectedDecision.rationale);
    expect(res.campaign.funnel_stage).toBe(expectedDecision.funnel_stage);
    // meta campaign id is the synthetic dry-run id
    expect(res.campaign.meta_campaign_id).toMatch(/^dryrun_campaign_/);
  });

  it('assembles adset+creative+ad items, all tagged + carrying rationale', async () => {
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      { ...commonDeps(store, stubGenerate()), metaAds: ads },
    );

    const types = res.items.map((i) => i.item_type).sort();
    expect(types).toEqual(['ad', 'adset', 'creative']);
    for (const item of res.items) {
      expect(item.grounded_in).toEqual(expectedDecision.grounded_in);
      expect(item.rationale && item.rationale.length).toBeGreaterThan(0);
      expect(item.artifact_id).toBe('artifact_1');
      expect(item.status).toBe('assembled');
      expect(item.meta_object_id).toMatch(/^dryrun_/);
    }
    // persisted through the store
    expect(store.items).toHaveLength(3);
  });

  it('logs one grounded decision per decision_type', async () => {
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      { ...commonDeps(store, stubGenerate()), metaAds: ads },
    );

    const dtypes = res.decisions.map((d) => d.decision_type).sort();
    expect(dtypes).toEqual(['angle', 'audience', 'budget', 'channel', 'funnel', 'objective', 'platform']);
    for (const d of res.decisions) {
      expect(d.rationale.length).toBeGreaterThan(0);
      expect(d.grounded_in).toEqual(expectedDecision.grounded_in);
    }
    const angle = res.decisions.find((d) => d.decision_type === 'angle')!;
    expect(angle.decision.angle).toBe(expectedDecision.angle);
  });

  it('maps targeting correctly onto the ad set (genders / geo / minor-unit budget)', async () => {
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      { ...commonDeps(store, stubGenerate()), metaAds: ads },
    );

    const adsetCall = ads.calls.find((c) => c.endpoint.endsWith('/adsets'))!;
    expect(adsetCall).toBeDefined();
    const targetingSent = JSON.parse(adsetCall.params.targeting);

    // genders mapped to Graph numbers (sample persona is female ⇒ [2])
    const expGenders = mapGenders(expectedDecision.targeting_spec.genders);
    expect(targetingSent.genders).toEqual(expGenders);
    // geo IL ⇒ countries ['IL']
    expect(targetingSent.geo_locations).toEqual({ countries: ['IL'] });
    // budget converted to MINOR units
    expect(adsetCall.params.daily_budget).toBe(String(ilsToAgorot(expectedDecision.daily_budget)));
    // created PAUSED — never auto-active
    expect(adsetCall.params.status).toBe('PAUSED');
  });

  it('makes ZERO live calls — every Meta call is dry-run', async () => {
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      { ...commonDeps(store, stubGenerate()), metaAds: ads },
    );

    expect(ads.calls.length).toBe(4); // campaign, adset, creative, ad
    expect(ads.calls.every((c) => c.dryRun === true)).toBe(true);
    // every created Meta object is PAUSED
    for (const call of ads.calls) {
      if ('status' in call.params) expect(call.params.status).toBe('PAUSED');
    }
  });
});

describe('runCampaign — meta_organic (dry-run)', () => {
  it('publishes a single dry-run page post and records it as a post item', async () => {
    const store = inMemoryCampaignStore();
    const publisher = new MetaPublishClient({ accessToken: 't', dryRun: true });

    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_organic', ownerUserId: OWNER },
      { ...commonDeps(store, stubGenerate({ post: 'אורגני!' })), metaPublish: publisher, pageId: 'page_42' },
    );

    expect(res.campaign.channel).toBe('meta_organic');
    expect(res.campaign.daily_budget).toBeNull(); // organic carries no budget
    expect(res.items).toHaveLength(1);
    expect(res.items[0].item_type).toBe('post');
    expect(res.items[0].grounded_in).toEqual(expectedDecision.grounded_in);

    expect(publisher.calls).toHaveLength(1);
    expect(publisher.calls[0].dryRun).toBe(true);
    expect(publisher.calls[0].path).toBe('/page_42/feed');
    expect(publisher.calls[0].payload.message).toBe('אורגני!');
    // decision log is still complete
    expect(res.decisions).toHaveLength(7);
  });
});

describe('runCampaign — H1 boundary: malformed strategy degrades to the fallback', () => {
  it('does NOT throw and produces a coherent decision when business_analysis is malformed', async () => {
    const store = inMemoryCampaignStore();
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    // A partially-null LLM object of the WRONG shape, exactly as it could be
    // read off client_strategy.business_analysis. The runner's validated read
    // (parseStrategyAnalysis) rejects it → strategy = null → decide() fallback.
    const malformed = { strategic_summary: { goal: 'only a goal' }, platform_funnel: null } as unknown;
    expect(parseStrategyAnalysis(malformed)).toBeNull();

    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      {
        ...commonDeps(store, stubGenerate()),
        // Mirror defaultLoadStrategy's validated read: garbage → null.
        loadStrategy: async () => parseStrategyAnalysis(malformed),
        metaAds: ads,
      },
    );

    // Same decision as strategy:null (the fallback path) — never a crash.
    expect(res.decision.grounded_in).toEqual(expectedDecision.grounded_in);
    expect(res.campaign.rationale).toBe(expectedDecision.rationale);
    expect(res.items).toHaveLength(3);
    expect(res.decisions).toHaveLength(7);
  });
});

describe('runCampaign — graceful when persistence is unavailable', () => {
  it('still returns a coherent result when the store cannot save', async () => {
    // A store whose writes all fail (simulates the 030 tables not yet applied).
    const deadStore: CampaignStore = {
      insertCampaign: async () => null,
      insertItem: async () => null,
      insertDecision: async () => null,
      updateCampaignStatus: async () => null,
      listCampaigns: async () => [],
      getCampaign: async () => null,
      listItems: async () => [],
      listDecisions: async () => [],
    };
    const ads = new MetaAdsClient({ accessToken: 't', adAccountId: '123', dryRun: true });

    const res = await runCampaign(
      { clientId: CLIENT_ID, channel: 'meta_paid', ownerUserId: OWNER },
      { ...commonDeps(deadStore, stubGenerate()), metaAds: ads },
    );

    // synthesized local rows so the dry-run assembly never crashes
    expect(res.campaign.id).toMatch(/^unsaved_/);
    expect(res.campaign.grounded_in).toEqual(expectedDecision.grounded_in);
    expect(res.items).toHaveLength(3);
    expect(res.decisions).toHaveLength(7);
    // assembly still happened (dry-run)
    expect(ads.calls.every((c) => c.dryRun)).toBe(true);
  });
});
