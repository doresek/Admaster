// Tests for the pulse dashboard's PURE client helpers: owner tile selection
// (≤4, priority, computable-first), Hebrew formatting, direction-aware delta
// badges, the comparison line, the "why" lookup/lines, mode persistence and
// the payload shape guard. No DOM, no React — plain hand-math.

import { describe, it, expect } from 'vitest';
import type { MetricValue } from '@/lib/metrics-layer';
import type { PulsePayload, PulseWhy } from '@/app/api/pulse/shared';
import {
  comparisonLine,
  deltaBadge,
  formatMetricValue,
  isPulsePayload,
  NO_WHY_TEXT,
  OWNER_TILE_CAP,
  OWNER_TILE_PRIORITY,
  PULSE_MODE_STORAGE_KEY,
  readStoredMode,
  selectOwnerTiles,
  whyFor,
  whyLines,
} from '../helpers';

const mv = (over: Partial<MetricValue> & Pick<MetricValue, 'key'>): MetricValue => ({
  name_he:               'מדד',
  unit:                  'count',
  direction:             'up_good',
  honesty_label:         null,
  value:                 1,
  not_computable_reason: null,
  prev:                  null,
  delta_pct:             null,
  vs_goal:               null,
  vs_benchmark:          null,
  ...over,
});

describe('selectOwnerTiles (§1: ≤4 tiles, wireframe priority)', () => {
  it('picks the wireframe trio + revenue when all are computable', () => {
    const metrics = OWNER_TILE_PRIORITY.map((key) => mv({ key }));
    expect(selectOwnerTiles(metrics).map((m) => m.key)).toEqual([
      'leads_total', 'cost_per_lead', 'roas_vs_breakeven', 'closed_value',
    ]);
  });

  it('computable metrics outrank null ones, order stays by priority', () => {
    const metrics = [
      mv({ key: 'leads_total' }),
      mv({ key: 'cost_per_lead', value: null, not_computable_reason: 'אין נתוני הוצאה' }),
      mv({ key: 'roas_vs_breakeven', value: null, not_computable_reason: 'חסרים נתוני כלכלה' }),
      mv({ key: 'closed_value' }),
      mv({ key: 'leads_qualified' }),
    ];
    expect(selectOwnerTiles(metrics).map((m) => m.key)).toEqual([
      'leads_total', 'closed_value', 'leads_qualified', 'cost_per_lead',
    ]);
  });

  it('never exceeds the cap and never invents a tile for an absent metric', () => {
    expect(selectOwnerTiles([]).length).toBe(0);
    const two = [mv({ key: 'leads_total' }), mv({ key: 'closed_value' })];
    expect(selectOwnerTiles(two).length).toBe(2);
    const all = OWNER_TILE_PRIORITY.map((key) => mv({ key }));
    expect(selectOwnerTiles(all).length).toBe(OWNER_TILE_CAP);
  });

  it('ignores metrics outside the owner priority list (never a tile)', () => {
    const metrics = [mv({ key: 'irrelevant_rate' }), mv({ key: 'leads_total' })];
    expect(selectOwnerTiles(metrics).map((m) => m.key)).toEqual(['leads_total']);
  });
});

describe('formatMetricValue', () => {
  it('dresses each unit without changing the digits', () => {
    expect(formatMetricValue(75, 'ils')).toBe('₪75');
    expect(formatMetricValue(12.5, 'pct')).toBe('12.5%');
    expect(formatMetricValue(1.67, 'ratio')).toBe('פי 1.67');
    expect(formatMetricValue(47, 'count')).toBe('47');
  });

  it('groups whole thousands he-IL style; fractional values stay verbatim', () => {
    expect(formatMetricValue(12000, 'ils')).toBe(`₪${(12000).toLocaleString('he-IL')}`);
    expect(formatMetricValue(1234.56, 'ils')).toBe('₪1234.56');
  });
});

describe('deltaBadge (leap 4, direction-aware)', () => {
  it('up on an up_good metric is good; up on a down_good metric is bad', () => {
    expect(deltaBadge(mv({ key: 'leads_total', delta_pct: 12 })))
      .toEqual({ arrow: '↑', text: '12%', good: true });
    expect(deltaBadge(mv({ key: 'cost_per_lead', direction: 'down_good', delta_pct: 8 })))
      .toEqual({ arrow: '↑', text: '8%', good: false });
    expect(deltaBadge(mv({ key: 'cost_per_lead', direction: 'down_good', delta_pct: -8 })))
      .toEqual({ arrow: '↓', text: '8%', good: true });
  });

  it('no delta / zero delta → no badge (no invented movement)', () => {
    expect(deltaBadge(mv({ key: 'leads_total', delta_pct: null }))).toBeNull();
    expect(deltaBadge(mv({ key: 'leads_total', delta_pct: 0 }))).toBeNull();
  });
});

describe('comparisonLine', () => {
  it('roas_vs_breakeven gets the break-even framing from its own value', () => {
    expect(comparisonLine(mv({ key: 'roas_vs_breakeven', unit: 'ratio', value: 1.67 })))
      .toBe('מעל נקודת האיזון');
    expect(comparisonLine(mv({ key: 'roas_vs_breakeven', unit: 'ratio', value: 0.8 })))
      .toBe('מתחת לנקודת האיזון');
  });

  it('goal beats benchmark; benchmark is the fallback; else nothing', () => {
    const both = mv({
      key: 'leads_total',
      vs_goal:      { target: 50, met: false },
      vs_benchmark: { target: 40, met: true },
    });
    expect(comparisonLine(both)).toBe('מול יעד: 50');
    const benchOnly = mv({
      key: 'cost_per_lead', unit: 'ils', direction: 'down_good',
      vs_benchmark: { target: 27, met: true },
    });
    expect(comparisonLine(benchOnly)).toBe('מול ענף: ₪27 ✓');
    expect(comparisonLine(mv({ key: 'leads_total' }))).toBeNull();
  });
});

describe('whyFor / whyLines (leap 3)', () => {
  const why: PulseWhy = {
    diagnosis: { id: 'd1', rationale: 'הקהל מוצה', failed_link: 'audience' },
    shock:     { note_he: 'שוק, לא אתה: תנודה כלל-שוקית', direction: 'down' },
  };

  it('whyFor returns the entry for a mapped key and null otherwise', () => {
    const whys: PulsePayload['whys'] = { qualified_rate: why };
    expect(whyFor('qualified_rate', whys)).toBe(why);
    expect(whyFor('leads_total', whys)).toBeNull();
  });

  it('whyLines renders reason + diagnosis + shock, all verbatim', () => {
    const m = mv({ key: 'qualified_rate', value: null, not_computable_reason: 'אין לידים בתקופה' });
    expect(whyLines(m, why)).toEqual([
      'אין לידים בתקופה',
      'הקהל מוצה',
      'שוק, לא אתה: תנודה כלל-שוקית',
    ]);
  });

  it('nothing to say → the honest "אין אבחנה זמינה עדיין"', () => {
    expect(whyLines(mv({ key: 'leads_total' }), null)).toEqual([NO_WHY_TEXT]);
    expect(whyLines(mv({ key: 'leads_total' }), { diagnosis: null, shock: null }))
      .toEqual([NO_WHY_TEXT]);
  });
});

describe('readStoredMode (localStorage persistence)', () => {
  const storageWith = (value: string | null): Pick<Storage, 'getItem'> => ({
    getItem: (key: string) => (key === PULSE_MODE_STORAGE_KEY ? value : null),
  });

  it('reads a persisted marketer mode', () => {
    expect(readStoredMode(storageWith('marketer'))).toBe('marketer');
    expect(readStoredMode(storageWith('owner'))).toBe('owner');
  });

  it('defaults to owner on absence, junk, no storage, or a throwing storage', () => {
    expect(readStoredMode(storageWith(null))).toBe('owner');
    expect(readStoredMode(storageWith('admin'))).toBe('owner');
    expect(readStoredMode(null)).toBe('owner');
    expect(readStoredMode({ getItem: () => { throw new Error('denied'); } })).toBe('owner');
  });
});

describe('isPulsePayload (shape guard — no blind casts of fetched JSON)', () => {
  const valid: Record<string, unknown> = {
    mode:         'owner',
    period:       { start: '2026-06-07', end: '2026-07-06', days: 30 },
    story:        { headline_he: 'ok', lines_he: [], pending_he: null, forecast_he: null, heads_up_he: null, sources: [], warnings: [] },
    narration_he: 'טקסט',
    metrics:      [],
    whys:         {},
    pending:      [],
    pending_note: null,
    diagnoses:    [],
    shock_note:   null,
    warnings:     [],
    generated_at: '2026-07-06T00:00:00.000Z',
  };

  it('accepts a well-formed payload', () => {
    expect(isPulsePayload(valid)).toBe(true);
    expect(isPulsePayload({ ...valid, mode: 'marketer', shock_note: 'שוק' })).toBe(true);
  });

  it('rejects junk, missing fields and wrong field types', () => {
    expect(isPulsePayload(null)).toBe(false);
    expect(isPulsePayload('payload')).toBe(false);
    expect(isPulsePayload({ ...valid, mode: 'admin' })).toBe(false);
    expect(isPulsePayload({ ...valid, metrics: 'none' })).toBe(false);
    expect(isPulsePayload({ ...valid, generated_at: undefined })).toBe(false);
    expect(isPulsePayload({ ...valid, pending_note: 5 })).toBe(false);
  });
});
