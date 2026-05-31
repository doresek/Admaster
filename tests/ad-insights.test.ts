import { describe, it, expect } from 'vitest';
import { normalizeInsights } from '@/lib/ad-insights';

// ad-insights-ai instantiates Anthropic at import → dummy key + dynamic import.
process.env.ANTHROPIC_API_KEY ||= 'test-key';

describe('normalizeInsights', () => {
  it('coerces strings to numbers and picks link_click as the result', () => {
    const i = normalizeInsights({
      impressions: '1000', clicks: '50', spend: '120.5', ctr: '5', cpc: '2.41', cpm: '120', reach: '800', frequency: '1.25',
      actions: [{ action_type: 'link_click', value: '50' }, { action_type: 'post_engagement', value: '90' }],
      cost_per_action_type: [{ action_type: 'link_click', value: '2.41' }],
    });
    expect(i.impressions).toBe(1000);
    expect(i.spend).toBeCloseTo(120.5);
    expect(i.results).toBe(50);
    expect(i.costPerResult).toBeCloseTo(2.41);
  });

  it('prefers a lead action over link_click', () => {
    const i = normalizeInsights({
      spend: '100',
      actions: [{ action_type: 'link_click', value: '40' }, { action_type: 'lead', value: '8' }],
      cost_per_action_type: [{ action_type: 'lead', value: '12.5' }],
    });
    expect(i.results).toBe(8);
    expect(i.costPerResult).toBeCloseTo(12.5);
  });

  it('returns zeros and null costPerResult for an empty row', () => {
    const i = normalizeInsights({});
    expect(i.impressions).toBe(0);
    expect(i.results).toBe(0);
    expect(i.costPerResult).toBeNull();
  });

  it('derives costPerResult from spend when not provided', () => {
    const i = normalizeInsights({ spend: '100', actions: [{ action_type: 'link_click', value: '25' }] });
    expect(i.results).toBe(25);
    expect(i.costPerResult).toBeCloseTo(4); // 100 / 25
  });
});

describe('parseAnalysis', () => {
  it('validates a well-formed response and keeps valid recommendations', async () => {
    const { parseAnalysis } = await import('@/lib/ad-insights-ai');
    const a = parseAnalysis(JSON.stringify({
      verdict: 'winning', summary: 'ביצועים מצוינים',
      recommendations: [
        { action: 'scale', severity: 'high', title: 'הגדל תקציב', why: 'CTR גבוה' },
        { action: 'bogus', severity: 'high', title: 'x', why: 'y' }, // dropped — invalid action
      ],
    }));
    expect(a.verdict).toBe('winning');
    expect(a.recommendations).toHaveLength(1);
    expect(a.recommendations[0].action).toBe('scale');
  });

  it('strips code fences', async () => {
    const { parseAnalysis } = await import('@/lib/ad-insights-ai');
    const a = parseAnalysis('```json\n{"verdict":"promising","summary":"ok","recommendations":[]}\n```');
    expect(a.verdict).toBe('promising');
  });

  it('falls back to too_early on garbage', async () => {
    const { parseAnalysis } = await import('@/lib/ad-insights-ai');
    const a = parseAnalysis('not json at all');
    expect(a.verdict).toBe('too_early');
    expect(a.recommendations).toEqual([]);
  });

  it('defaults an invalid severity to medium', async () => {
    const { parseAnalysis } = await import('@/lib/ad-insights-ai');
    const a = parseAnalysis(JSON.stringify({
      verdict: 'underperforming', summary: 's',
      recommendations: [{ action: 'pause', severity: 'critical', title: 't', why: 'w' }],
    }));
    expect(a.recommendations[0].severity).toBe('medium');
  });
});
