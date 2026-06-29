import { describe, it, expect } from 'vitest';
import {
  aggregatePerformance,
  buildPeriodComparison,
  composeReportPrompt,
  cpaOf,
  roasOf,
  pctChange,
  priorPeriodRange,
  type PerfTotals,
} from '@/lib/report-metrics';

describe('aggregatePerformance', () => {
  it('sums base metrics and derives revenue from per-row roas × spend', () => {
    const t = aggregatePerformance([
      { impressions: 1000, clicks: 50, spend: '100.00', reach: 800, conversions: 5, roas: '2.0' },
      { impressions: 500, clicks: 25, spend: '50.00', reach: 400, conversions: 5, roas: '3.0' },
    ]);
    expect(t.impressions).toBe(1500);
    expect(t.clicks).toBe(75);
    expect(t.spend).toBeCloseTo(150);
    expect(t.reach).toBe(1200);
    expect(t.conversions).toBe(10);
    expect(t.revenue).toBeCloseTo(2 * 100 + 3 * 50); // 350
  });

  it('handles null/empty and non-numeric input safely', () => {
    expect(aggregatePerformance(null)).toEqual({
      impressions: 0, clicks: 0, spend: 0, reach: 0, conversions: 0, revenue: 0,
    });
    const t = aggregatePerformance([{ spend: 'oops', clicks: undefined, roas: null }]);
    expect(t.spend).toBe(0);
    expect(t.revenue).toBe(0);
  });
});

describe('cpaOf / roasOf — zero-conversion & no-revenue safety', () => {
  const base: PerfTotals = { impressions: 0, clicks: 0, spend: 200, reach: 0, conversions: 0, revenue: 0 };
  it('returns null CPA when there are no conversions (never fabricate)', () => {
    expect(cpaOf(base)).toBeNull();
  });
  it('computes CPA when conversions exist', () => {
    expect(cpaOf({ ...base, conversions: 4 })).toBeCloseTo(50);
  });
  it('returns null ROAS without revenue', () => {
    expect(roasOf(base)).toBeNull();
  });
  it('computes spend-weighted ROAS when revenue present', () => {
    expect(roasOf({ ...base, revenue: 400 })).toBeCloseTo(2);
  });
});

describe('pctChange', () => {
  it('computes percent change', () => {
    expect(pctChange(150, 100)).toBeCloseTo(50);
    expect(pctChange(80, 100)).toBeCloseTo(-20);
  });
  it('returns null when prior is zero (no fake infinity)', () => {
    expect(pctChange(100, 0)).toBeNull();
  });
});

describe('buildPeriodComparison', () => {
  const current: PerfTotals = { impressions: 0, clicks: 0, spend: 120, reach: 0, conversions: 6, revenue: 360 };
  const prior:   PerfTotals = { impressions: 0, clicks: 0, spend: 100, reach: 0, conversions: 4, revenue: 200 };

  it('produces current/prior/abs/pct deltas', () => {
    const c = buildPeriodComparison(current, prior);
    expect(c.spend.absChange).toBeCloseTo(20);
    expect(c.spend.pctChange).toBeCloseTo(20);
    expect(c.conversions.absChange).toBeCloseTo(2);
    expect(c.conversions.pctChange).toBeCloseTo(50);
    expect(c.cpa.current).toBeCloseTo(20);   // 120/6
    expect(c.cpa.prior).toBeCloseTo(25);     // 100/4
    expect(c.cpa.absChange).toBeCloseTo(-5); // improved
    expect(c.roas.current).toBeCloseTo(3);
    expect(c.roas.prior).toBeCloseTo(2);
  });

  it('keeps CPA delta null when current period has zero conversions', () => {
    const zeroConv: PerfTotals = { ...current, conversions: 0 };
    const c = buildPeriodComparison(zeroConv, prior);
    expect(c.cpa.current).toBeNull();
    expect(c.cpa.absChange).toBeNull();
    expect(c.cpa.pctChange).toBeNull();
  });
});

describe('priorPeriodRange', () => {
  it('returns an equal-length window immediately before the period', () => {
    // 7-day inclusive period -> prior window is the previous 7 days, lt periodStart
    const r = priorPeriodRange('2026-06-08', '2026-06-14');
    expect(r.endExclusive).toBe('2026-06-08');
    expect(r.start).toBe('2026-06-01');
  });
  it('handles a single-day period', () => {
    const r = priorPeriodRange('2026-06-10', '2026-06-10');
    expect(r.endExclusive).toBe('2026-06-10');
    expect(r.start).toBe('2026-06-09');
  });
});

describe('composeReportPrompt — outcome-led framing', () => {
  const totals: PerfTotals = { impressions: 10000, clicks: 200, spend: 500, reach: 8000, conversions: 25, revenue: 1500 };

  it('leads with outcomes and demotes activity metrics', () => {
    const p = composeReportPrompt({
      clientName: 'בדיקה בעמ', periodStart: '2026-06-01', periodEnd: '2026-06-07',
      totals, avgCtr: '2.00', avgCpc: '2.50', postsPublished: 4, comparison: null,
    });
    expect(p).toMatch(/תוצאות עסקיות/);
    expect(p).toMatch(/ROI/);
    expect(p).toContain('עלות לתוצאה');
    // ROAS reported because revenue present
    expect(p).toContain('ROAS');
    // outcome block appears before the activity block
    expect(p.indexOf('תוצאות עסקיות')).toBeLessThan(p.indexOf('מדדי פעילות'));
  });

  it('states zero-conversion honestly and forbids inventing ROAS', () => {
    const zero: PerfTotals = { impressions: 5000, clicks: 100, spend: 300, reach: 4000, conversions: 0, revenue: 0 };
    const p = composeReportPrompt({
      clientName: 'X', periodStart: '2026-06-01', periodEnd: '2026-06-07',
      totals: zero, avgCtr: '2.00', avgCpc: '3.00', postsPublished: 0, comparison: null,
    });
    expect(p).toContain('אין המרות');
    expect(p).toMatch(/אל תמציא/);
  });

  it('omits comparison gracefully when no prior data', () => {
    const p = composeReportPrompt({
      clientName: 'X', periodStart: '2026-06-01', periodEnd: '2026-06-07',
      totals, avgCtr: '2.00', avgCpc: '2.50', postsPublished: 1, comparison: null,
    });
    expect(p).toContain('אין נתוני תקופה קודמת');
  });

  it('includes period-over-period deltas when comparison provided', () => {
    const prior: PerfTotals = { impressions: 9000, clicks: 180, spend: 400, reach: 7000, conversions: 20, revenue: 800 };
    const comparison = buildPeriodComparison(totals, prior);
    const p = composeReportPrompt({
      clientName: 'X', periodStart: '2026-06-08', periodEnd: '2026-06-14',
      totals, avgCtr: '2.00', avgCpc: '2.50', postsPublished: 1, comparison,
    });
    expect(p).toContain('השוואה לתקופה הקודמת');
    expect(p).toMatch(/מול/); // "X מול Y"
  });
});
