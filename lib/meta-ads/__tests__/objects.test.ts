import { describe, it, expect } from 'vitest';
import {
  MetaAdsClient,
  buildTargeting,
  buildObjectStorySpec,
  buildLookalikeSpec,
  type TargetingSpec,
} from '../index';

function newClient() {
  return new MetaAdsClient({ accessToken: 't', adAccountId: '777' });
}

describe('createCampaign (dry-run payload)', () => {
  it('returns a synthetic id and records objective + PAUSED default + empty categories', async () => {
    const c = newClient();
    const res = await c.createCampaign({ name: 'Launch', objective: 'OUTCOME_LEADS' });

    expect(res).toEqual({ id: 'dryrun_campaign_1', dryRun: true });
    const call = c.calls[0];
    expect(call.method).toBe('POST');
    expect(call.endpoint).toBe(`${c.graphBase}/act_777/campaigns`);
    expect(call.params.name).toBe('Launch');
    expect(call.params.objective).toBe('OUTCOME_LEADS');
    expect(call.params.status).toBe('PAUSED');
    expect(call.params.special_ad_categories).toBe('[]');
    expect(call.dryRun).toBe(true);
  });

  it('increments synthetic ids per create', async () => {
    const c = newClient();
    const a = await c.createCampaign({ name: 'a', objective: 'OUTCOME_SALES' });
    const b = await c.createCampaign({ name: 'b', objective: 'OUTCOME_SALES' });
    expect(a.id).toBe('dryrun_campaign_1');
    expect(b.id).toBe('dryrun_campaign_2');
  });

  it('respects an explicit status and serialises minor-unit budget', async () => {
    const c = newClient();
    await c.createCampaign({
      name: 'x',
      objective: 'OUTCOME_SALES',
      status: 'ACTIVE',
      dailyBudget: 5000,
      bidStrategy: 'COST_CAP',
    });
    const p = c.calls[0].params;
    expect(p.status).toBe('ACTIVE');
    expect(p.daily_budget).toBe('5000');
    expect(p.bid_strategy).toBe('COST_CAP');
  });
});

describe('buildTargeting', () => {
  it('maps the structured spec into the Graph targeting object', () => {
    const spec: TargetingSpec = {
      geo_locations: { countries: ['IL'] },
      age_min: 25,
      age_max: 45,
      genders: [2],
      interests: [{ id: '6003' , name: 'Travel' }],
      custom_audiences: [{ id: 'ca1' }],
      lookalike_audiences: [{ id: 'lal1' }],
      excluded_custom_audiences: [{ id: 'ex1' }],
    };
    const t = buildTargeting(spec);
    expect(t.geo_locations).toEqual({ countries: ['IL'] });
    expect(t.age_min).toBe(25);
    expect(t.age_max).toBe(45);
    expect(t.genders).toEqual([2]);
    // flat interests folded into a flexible_spec OR group
    expect(t.flexible_spec).toEqual([{ interests: [{ id: '6003', name: 'Travel' }] }]);
    // lookalikes merged into custom_audiences
    expect(t.custom_audiences).toEqual([{ id: 'ca1' }, { id: 'lal1' }]);
    expect(t.excluded_custom_audiences).toEqual([{ id: 'ex1' }]);
  });

  it('omits empty fields', () => {
    const t = buildTargeting({ geo_locations: { countries: ['US'] } });
    expect(Object.keys(t)).toEqual(['geo_locations']);
  });
});

describe('createAdSet (dry-run payload)', () => {
  it('records budget (minor units), targeting structure, goals and PAUSED status', async () => {
    const c = newClient();
    const targeting: TargetingSpec = {
      geo_locations: { countries: ['IL'] },
      age_min: 18,
      flexible_spec: [{ interests: [{ id: '1' }] }],
    };
    const res = await c.createAdSet({
      campaignId: 'dryrun_campaign_1',
      name: 'AS',
      dailyBudget: 3000,
      targeting,
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      billingEvent: 'IMPRESSIONS',
    });

    expect(res.id).toBe('dryrun_adset_1');
    const p = c.calls[0].params;
    expect(c.calls[0].endpoint).toBe(`${c.graphBase}/act_777/adsets`);
    expect(p.campaign_id).toBe('dryrun_campaign_1');
    expect(p.daily_budget).toBe('3000');
    expect(p.optimization_goal).toBe('OFFSITE_CONVERSIONS');
    expect(p.billing_event).toBe('IMPRESSIONS');
    expect(p.status).toBe('PAUSED');
    // targeting is JSON-encoded
    const parsed = JSON.parse(p.targeting);
    expect(parsed.geo_locations).toEqual({ countries: ['IL'] });
    expect(parsed.age_min).toBe(18);
    expect(parsed.flexible_spec).toEqual([{ interests: [{ id: '1' }] }]);
  });
});

describe('buildObjectStorySpec & createAdCreative', () => {
  it('builds link_data with image_hash and call_to_action', () => {
    const spec = buildObjectStorySpec({
      pageId: 'PAGE',
      message: 'hi',
      link: 'https://e.com',
      imageHash: 'HASH',
      callToAction: { type: 'SHOP_NOW', value: { link: 'https://e.com' } },
    });
    expect(spec.page_id).toBe('PAGE');
    const ld = spec.link_data as Record<string, unknown>;
    expect(ld.image_hash).toBe('HASH');
    expect(ld.picture).toBeUndefined();
    expect(ld.call_to_action).toEqual({ type: 'SHOP_NOW', value: { link: 'https://e.com' } });
  });

  it('uses picture when given imageUrl', () => {
    const spec = buildObjectStorySpec({
      pageId: 'P',
      message: 'm',
      link: 'https://e.com',
      imageUrl: 'https://img/x.png',
    });
    const ld = spec.link_data as Record<string, unknown>;
    expect(ld.picture).toBe('https://img/x.png');
    expect(ld.image_hash).toBeUndefined();
  });

  it('rejects zero or two image sources', () => {
    expect(() =>
      buildObjectStorySpec({ pageId: 'P', message: 'm', link: 'l' }),
    ).toThrow(/one of imageHash or imageUrl/);
    expect(() =>
      buildObjectStorySpec({ pageId: 'P', message: 'm', link: 'l', imageHash: 'h', imageUrl: 'u' }),
    ).toThrow(/only one/);
  });

  it('createAdCreative records object_story_spec to the adcreatives edge', async () => {
    const c = newClient();
    const res = await c.createAdCreative({
      pageId: 'P',
      message: 'm',
      link: 'https://e.com',
      imageHash: 'H',
    });
    expect(res.id).toBe('dryrun_creative_1');
    expect(c.calls[0].endpoint).toBe(`${c.graphBase}/act_777/adcreatives`);
    const oss = JSON.parse(c.calls[0].params.object_story_spec);
    expect(oss.page_id).toBe('P');
  });
});

describe('createAd (dry-run payload)', () => {
  it('links adset+creative, defaults to PAUSED, returns synthetic id', async () => {
    const c = newClient();
    const res = await c.createAd({
      adsetId: 'dryrun_adset_1',
      creativeId: 'dryrun_creative_1',
      name: 'Ad 1',
    });
    expect(res.id).toBe('dryrun_ad_1');
    const p = c.calls[0].params;
    expect(c.calls[0].endpoint).toBe(`${c.graphBase}/act_777/ads`);
    expect(p.adset_id).toBe('dryrun_adset_1');
    expect(p.status).toBe('PAUSED');
    expect(JSON.parse(p.creative)).toEqual({ creative_id: 'dryrun_creative_1' });
  });
});

describe('audiences', () => {
  it('createCustomAudience defaults subtype CUSTOM', async () => {
    const c = newClient();
    const res = await c.createCustomAudience({ name: 'Seed' });
    expect(res.id).toBe('dryrun_audience_1');
    expect(c.calls[0].endpoint).toBe(`${c.graphBase}/act_777/customaudiences`);
    expect(c.calls[0].params.subtype).toBe('CUSTOM');
  });

  it('buildLookalikeSpec encodes country + ratio + similarity type', () => {
    const spec = buildLookalikeSpec({
      name: 'LAL',
      originAudienceId: 'src',
      country: 'IL',
      ratio: 0.03,
    });
    expect(spec).toEqual({ country: 'IL', ratio: 0.03, type: 'similarity' });
  });

  it('createLookalikeAudience records LOOKALIKE subtype + origin + spec', async () => {
    const c = newClient();
    const res = await c.createLookalikeAudience({
      name: 'LAL',
      originAudienceId: 'src',
      country: 'IL',
      ratio: 0.05,
    });
    expect(res.id).toBe('dryrun_lookalike_1');
    const p = c.calls[0].params;
    expect(p.subtype).toBe('LOOKALIKE');
    expect(p.origin_audience_id).toBe('src');
    expect(JSON.parse(p.lookalike_spec)).toEqual({ country: 'IL', ratio: 0.05, type: 'similarity' });
  });
});

describe('full campaign assembly stays entirely dry', () => {
  it('builds campaign → adset → creative → ad with synthetic ids and no network', async () => {
    const c = newClient();
    const camp = await c.createCampaign({ name: 'C', objective: 'OUTCOME_SALES' });
    const as = await c.createAdSet({
      campaignId: camp.id,
      name: 'AS',
      dailyBudget: 2000,
      targeting: { geo_locations: { countries: ['IL'] } },
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      billingEvent: 'IMPRESSIONS',
    });
    const cr = await c.createAdCreative({
      pageId: 'P',
      message: 'm',
      link: 'https://e.com',
      imageHash: 'H',
    });
    const ad = await c.createAd({ adsetId: as.id, creativeId: cr.id, name: 'Ad' });

    expect([camp.id, as.id, cr.id, ad.id]).toEqual([
      'dryrun_campaign_1',
      'dryrun_adset_1',
      'dryrun_creative_1',
      'dryrun_ad_1',
    ]);
    expect(c.calls).toHaveLength(4);
    expect(c.calls.every((x) => x.dryRun)).toBe(true);
  });
});
