import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  publishCampaign,
  inMemoryCampaignStore,
  ilsToAgorot,
  type CampaignStore,
  type PublishPlan,
  type PaidPublishPlan,
  type OrganicPublishPlan,
} from '@/lib/campaigns';
import { MetaAdsClient } from '@/lib/meta-ads';
import { MetaPublishClient } from '@/lib/meta-publish';

// ── fixtures ─────────────────────────────────────────────────────────────────

const CLIENT_ID = 'client_1';
const OWNER = 'owner_1';
const CAMPAIGN_ID = 'campaign_1';

const paidPlan: PaidPublishPlan = {
  channel: 'meta_paid',
  clientId: CLIENT_ID,
  adAccountId: '123',
  pageId: 'page_42',
  name: 'Insight-driven paid',
  metaObjective: 'OUTCOME_LEADS',
  optimizationGoal: 'LEAD_GENERATION',
  billingEvent: 'IMPRESSIONS',
  dailyBudget: 80, // major units (₪80) — under the default 100 cap
  targeting: { geo_locations: { countries: ['IL'] }, genders: [2] },
  message: 'פוסט ממומן מבוסס תובנות',
  link: 'https://example.com/lp',
  imageUrl: 'https://cdn.example/img.jpg',
};

const organicPlan: OrganicPublishPlan = {
  channel: 'meta_organic',
  clientId: CLIENT_ID,
  pageId: 'page_42',
  message: 'פוסט אורגני',
  link: 'https://example.com/lp',
};

/** A store seeded with the campaign + its items, so persistence is observable. */
function seededStore() {
  const store = inMemoryCampaignStore();
  // The runner would have recorded these; publish updates their status.
  store.campaigns.push({
    id: CAMPAIGN_ID,
    client_id: CLIENT_ID,
    owner_user_id: OWNER,
    name: paidPlan.name,
    objective: 'leads',
    channel: 'meta_paid',
    status: 'assembled',
    daily_budget: 80,
    funnel_stage: 'BOFU',
    meta_campaign_id: 'dryrun_campaign_1',
    dry_run: true,
    grounded_in: ['i1'],
    rationale: 'because insights',
  });
  store.items.push(
    { id: 'item_adset', campaign_id: CAMPAIGN_ID, client_id: CLIENT_ID, owner_user_id: OWNER, artifact_id: 'art_1', item_type: 'adset', status: 'assembled', meta_object_id: 'dryrun_adset_1', targeting_spec: {}, ab_parent_id: null, grounded_in: ['i1'], rationale: null },
    { id: 'item_ad', campaign_id: CAMPAIGN_ID, client_id: CLIENT_ID, owner_user_id: OWNER, artifact_id: 'art_1', item_type: 'ad', status: 'assembled', meta_object_id: 'dryrun_ad_1', targeting_spec: {}, ab_parent_id: null, grounded_in: ['i1'], rationale: null },
  );
  return store;
}

function planResolver(plan: PublishPlan | null) {
  return async () => plan;
}

/** Records constructed clients so a test can assert what was built + the calls. */
function adsFactory(sink: MetaAdsClient[]) {
  return (o: { accessToken: string; adAccountId: string; dryRun: boolean }) => {
    const c = new MetaAdsClient(o);
    sink.push(c);
    return c;
  };
}
function publishFactory(sink: MetaPublishClient[]) {
  return (o: { accessToken: string; dryRun: boolean }) => {
    const c = new MetaPublishClient(o);
    sink.push(c);
    return c;
  };
}

// Isolate env between tests.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  delete process.env.LIVE_PUBLISH_ENABLED;
  delete process.env.META_MAX_DAILY_BUDGET;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── dry-run (default) ──────────────────────────────────────────────────────────

describe('publishCampaign — dry-run (default)', () => {
  it('assembles the would-be paid objects (all PAUSED) with ZERO live calls', async () => {
    const store = seededStore();
    const ads: MetaAdsClient[] = [];

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER }, // live defaults false
      { store, resolvePlan: planResolver(paidPlan), makeAdsClient: adsFactory(ads) },
    );

    expect(res.refused).toBe(false);
    expect(res.live).toBe(false);
    expect(res.dryRun).toBe(true);
    // adset + creative + ad
    expect(res.objects.map((o) => o.type).sort()).toEqual(['ad', 'adset', 'creative']);
    expect(res.objects.every((o) => o.id.startsWith('dryrun_'))).toBe(true);

    // the constructed client was dry-run and made zero live calls
    expect(ads).toHaveLength(1);
    expect(ads[0].dryRun).toBe(true);
    expect(ads[0].calls.length).toBe(4); // campaign, adset, creative, ad
    expect(ads[0].calls.every((c) => c.dryRun === true)).toBe(true);
  });

  it('persists item statuses without flipping the campaign out of dry-run', async () => {
    const store = seededStore();

    await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER },
      { store, resolvePlan: planResolver(paidPlan), makeAdsClient: adsFactory([]) },
    );

    // items persisted (stay 'assembled' in dry-run), campaign stays dry-run
    expect(store.items.every((i) => i.status === 'assembled')).toBe(true);
    expect(store.campaigns[0].dry_run).toBe(true);
    expect(store.campaigns[0].status).toBe('assembled');
  });

  it('assembles a dry-run organic page post', async () => {
    const store = seededStore();
    const pubs: MetaPublishClient[] = [];

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER },
      { store, resolvePlan: planResolver(organicPlan), makePublishClient: publishFactory(pubs) },
    );

    expect(res.refused).toBe(false);
    expect(res.objects).toEqual([{ type: 'post', id: 'dryrun_post_1' }]);
    expect(pubs[0].dryRun).toBe(true);
    expect(pubs[0].calls[0].path).toBe('/page_42/feed');
  });
});

// ── live path (gated) ────────────────────────────────────────────────────────

describe('publishCampaign — live path (flag + token)', () => {
  // Stub the network so the REAL Meta clients exercise their live (dryRun:false)
  // path against a fake Graph response — no real HTTP, no real spend. Each POST
  // returns a distinct synthetic Graph id.
  let liveSeq = 0;
  beforeEach(() => {
    liveSeq = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      liveSeq += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: `live_${liveSeq}` }),
      } as unknown as Response;
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates real PAUSED paid objects and makes live (non-dry) calls', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    const store = seededStore();
    const ads: MetaAdsClient[] = [];
    let tokenArgs: [string, string] | null = null;

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store,
        resolvePlan: planResolver(paidPlan),
        getToken: async (clientId, uid) => {
          tokenArgs = [clientId, uid];
          return 'LIVE_TOKEN';
        },
        makeAdsClient: adsFactory(ads),
      },
    );

    expect(res.refused).toBe(false);
    expect(res.live).toBe(true);
    expect(res.dryRun).toBe(false);

    // token resolved for the right client/owner
    expect(tokenArgs).toEqual([CLIENT_ID, OWNER]);

    // the client was constructed LIVE with the resolved token + ad account
    expect(ads).toHaveLength(1);
    expect(ads[0].dryRun).toBe(false);
    expect(ads[0].accessToken).toBe('LIVE_TOKEN');
    expect(ads[0].adAccountId).toBe('act_123');

    // 4 live calls, none dry-run
    expect(ads[0].calls.length).toBe(4);
    expect(ads[0].calls.every((c) => c.dryRun === false)).toBe(true);

    // every object carrying a status was created PAUSED — and NEVER ACTIVE
    for (const call of ads[0].calls) {
      if ('status' in call.params) expect(call.params.status).toBe('PAUSED');
    }
    // budget sent in MINOR units
    const adsetCall = ads[0].calls.find((c) => c.endpoint.endsWith('/adsets'))!;
    expect(adsetCall.params.daily_budget).toBe(String(ilsToAgorot(paidPlan.dailyBudget)));

    // persisted: items published, campaign flipped to live-but-paused, real id
    expect(store.items.every((i) => i.status === 'published')).toBe(true);
    expect(store.campaigns[0].dry_run).toBe(false);
    expect(store.campaigns[0].status).toBe('paused');
    expect(store.campaigns[0].meta_campaign_id).toBe(res.metaCampaignId);
  });

  it('NEVER produces an ACTIVE object across every created object', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    const ads: MetaAdsClient[] = [];

    await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store: seededStore(),
        resolvePlan: planResolver(paidPlan),
        getToken: async () => 'LIVE_TOKEN',
        makeAdsClient: adsFactory(ads),
      },
    );

    const anyActive = ads[0].calls.some((c) => c.params.status === 'ACTIVE');
    expect(anyActive).toBe(false);
    // and the result objects only ever advertise PAUSED
    // (defensive: no path can flip these to active)
    expect(ads[0].calls.filter((c) => 'status' in c.params).length).toBe(3); // campaign, adset, ad
  });

  it('publishes a live organic post through a non-dry client', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    const pubs: MetaPublishClient[] = [];

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store: seededStore(),
        resolvePlan: planResolver(organicPlan),
        getToken: async () => 'LIVE_TOKEN',
        makePublishClient: publishFactory(pubs),
      },
    );

    expect(res.live).toBe(true);
    expect(pubs[0].dryRun).toBe(false);
    expect(pubs[0].accessToken).toBe('LIVE_TOKEN');
    expect(pubs[0].calls[0].dryRun).toBe(false);
  });
});

// ── refusals (never a silent no-op) ─────────────────────────────────────────────

describe('publishCampaign — refusals', () => {
  it('refuses the live path when the flag is off (makes NO Meta client)', async () => {
    // LIVE_PUBLISH_ENABLED unset
    const ads: MetaAdsClient[] = [];
    let tokenCalled = false;

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store: seededStore(),
        resolvePlan: planResolver(paidPlan),
        getToken: async () => {
          tokenCalled = true;
          return 'LIVE_TOKEN';
        },
        makeAdsClient: adsFactory(ads),
      },
    );

    expect(res.refused).toBe(true);
    expect(res.reason).toBe('live_disabled');
    expect(res.live).toBe(false);
    expect(res.objects).toEqual([]);
    // no client built, token never even consulted, nothing spent
    expect(ads).toHaveLength(0);
    expect(tokenCalled).toBe(false);
  });

  it('refuses when the flag is on but no token resolves', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    const ads: MetaAdsClient[] = [];

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store: seededStore(),
        resolvePlan: planResolver(paidPlan),
        getToken: async () => null, // no connection / no token
        makeAdsClient: adsFactory(ads),
      },
    );

    expect(res.refused).toBe(true);
    expect(res.reason).toBe('no_token');
    expect(res.objects).toEqual([]);
    expect(ads).toHaveLength(0); // never built a client → never published
  });

  it('refuses (spend cap) when a live daily budget exceeds META_MAX_DAILY_BUDGET', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    process.env.META_MAX_DAILY_BUDGET = '100';
    const ads: MetaAdsClient[] = [];

    const overBudget: PaidPublishPlan = { ...paidPlan, dailyBudget: 250 };
    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store: seededStore(),
        resolvePlan: planResolver(overBudget),
        getToken: async () => 'LIVE_TOKEN',
        makeAdsClient: adsFactory(ads),
      },
    );

    expect(res.refused).toBe(true);
    expect(res.reason).toBe('over_budget');
    expect(res.objects).toEqual([]);
    expect(ads).toHaveLength(0); // refused before any object is created
  });

  it('respects a custom (lower) spend cap from the env', async () => {
    process.env.LIVE_PUBLISH_ENABLED = 'true';
    process.env.META_MAX_DAILY_BUDGET = '50'; // ₪80 plan now exceeds it

    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER, live: true },
      {
        store: seededStore(),
        resolvePlan: planResolver(paidPlan), // dailyBudget 80 > 50
        getToken: async () => 'LIVE_TOKEN',
      },
    );

    expect(res.refused).toBe(true);
    expect(res.reason).toBe('over_budget');
  });

  it('refuses cleanly when no plan resolves', async () => {
    const res = await publishCampaign(
      { campaignId: 'missing', ownerUserId: OWNER },
      { store: seededStore(), resolvePlan: planResolver(null) },
    );
    expect(res.refused).toBe(true);
    expect(res.reason).toBe('not_found');
  });

  it('refuses an unsupported (whatsapp) channel', async () => {
    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER },
      {
        store: seededStore(),
        resolvePlan: async () => ({ channel: 'whatsapp' } as unknown as PublishPlan),
      },
    );
    expect(res.refused).toBe(true);
    expect(res.reason).toBe('unsupported_channel');
  });

  it('a dry-run over-budget plan is NOT refused (dry-run never spends)', async () => {
    // No flag, live not requested → the cap does not gate dry-run assembly.
    const overBudget: PaidPublishPlan = { ...paidPlan, dailyBudget: 9999 };
    const res = await publishCampaign(
      { campaignId: CAMPAIGN_ID, ownerUserId: OWNER },
      { store: seededStore(), resolvePlan: planResolver(overBudget), makeAdsClient: adsFactory([]) },
    );
    expect(res.refused).toBe(false);
    expect(res.dryRun).toBe(true);
  });
});
