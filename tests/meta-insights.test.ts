import { describe, it, expect } from 'vitest';
import {
  buildInsightsUrl,
  mapInsightsRowToPerformance,
  extractConversions,
  type GraphInsightsRow,
} from '@/lib/meta-insights';

const ctx = {
  userId: 'user-1',
  clientId: 'client-1',
  adAccountId: 'act_123',
  fetchedAt: '2026-06-29T00:00:00.000Z',
};

// A representative daily row as the Graph Insights endpoint returns it:
// every metric is a STRING, conversions live inside `actions`.
const sampleRow: GraphInsightsRow = {
  date_start: '2026-06-01',
  date_stop: '2026-06-01',
  impressions: '10234',
  clicks: '356',
  spend: '412.55',
  reach: '8800',
  frequency: '1.163',
  ctr: '3.4789',
  cpc: '1.16',
  cpm: '40.31',
  actions: [
    { action_type: 'link_click', value: '356' },       // not a conversion
    { action_type: 'post_engagement', value: '900' },   // not a conversion
    { action_type: 'purchase', value: '5' },             // conversion
    { action_type: 'lead', value: '3' },                 // conversion
  ],
};

describe('mapInsightsRowToPerformance', () => {
  it('maps a daily Graph row to an ad_performance record with numeric coercion', () => {
    const rec = mapInsightsRowToPerformance(sampleRow, ctx);

    expect(rec).toMatchObject({
      user_id: 'user-1',
      client_id: 'client-1',
      ad_account_id: 'act_123',
      date: '2026-06-01',
      fetched_at: '2026-06-29T00:00:00.000Z',
    });

    // Strings coerced to numbers, with correct int/float handling.
    expect(rec.impressions).toBe(10234);
    expect(rec.clicks).toBe(356);
    expect(rec.spend).toBeCloseTo(412.55);
    expect(rec.reach).toBe(8800);
    expect(rec.frequency).toBeCloseTo(1.163);
    expect(rec.ctr).toBeCloseTo(3.4789);
    expect(rec.cpc).toBeCloseTo(1.16);
    expect(rec.cpm).toBeCloseTo(40.31);

    // Types are numbers, not strings.
    expect(typeof rec.impressions).toBe('number');
    expect(typeof rec.spend).toBe('number');
  });

  it('extracts conversions by summing only conversion action types', () => {
    const rec = mapInsightsRowToPerformance(sampleRow, ctx);
    expect(rec.conversions).toBe(8); // purchase(5) + lead(3), ignoring clicks/engagement
  });

  it('derives cost_per_result from spend / conversions', () => {
    const rec = mapInsightsRowToPerformance(sampleRow, ctx);
    expect(rec.cost_per_result).toBeCloseTo(412.55 / 8, 2);
  });

  it('defaults conversions and cost_per_result to 0 when no actions present', () => {
    const rec = mapInsightsRowToPerformance(
      { date_start: '2026-06-02', impressions: '100' },
      ctx,
    );
    expect(rec.conversions).toBe(0);
    expect(rec.cost_per_result).toBe(0);
  });

  it('coerces missing/garbage numeric fields to 0', () => {
    const rec = mapInsightsRowToPerformance(
      { date_start: '2026-06-03', impressions: undefined, spend: 'NaN', clicks: '' },
      ctx,
    );
    expect(rec.impressions).toBe(0);
    expect(rec.spend).toBe(0);
    expect(rec.clicks).toBe(0);
  });

  it('falls back to date_stop when date_start is absent', () => {
    const rec = mapInsightsRowToPerformance({ date_stop: '2026-06-04' }, ctx);
    expect(rec.date).toBe('2026-06-04');
  });
});

describe('buildInsightsUrl', () => {
  const url = buildInsightsUrl({
    graphBase: 'https://graph.facebook.com/v21.0',
    adAccountId: 'act_123',
    since: '2026-06-01',
    until: '2026-06-29',
  });

  it('builds the insights endpoint with the expected non-secret params', () => {
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v21.0/act_123/insights');
    expect(parsed.searchParams.get('level')).toBe('account');
    expect(parsed.searchParams.get('time_increment')).toBe('1');
    expect(parsed.searchParams.get('limit')).toBe('500');
    expect(parsed.searchParams.get('time_range')).toBe(
      JSON.stringify({ since: '2026-06-01', until: '2026-06-29' }),
    );
  });

  it('NEVER includes the access token in the URL', () => {
    const secret = 'EAATESTTOKEN_super_secret_value';
    const u = buildInsightsUrl({
      graphBase: 'https://graph.facebook.com/v21.0',
      adAccountId: 'act_123',
      since: '2026-06-01',
      until: '2026-06-29',
    });
    expect(u).not.toContain('access_token');
    expect(u).not.toContain(secret);
    expect(new URL(u).searchParams.has('access_token')).toBe(false);
  });
});

describe('extractConversions', () => {
  it('returns 0 for a missing or non-array actions field', () => {
    expect(extractConversions(undefined)).toBe(0);
    expect(extractConversions([])).toBe(0);
  });

  it('sums pixel-prefixed conversion variants too', () => {
    expect(
      extractConversions([
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
        { action_type: 'offsite_conversion.fb_pixel_lead', value: '4' },
        { action_type: 'video_view', value: '999' },
      ]),
    ).toBe(6);
  });
});
