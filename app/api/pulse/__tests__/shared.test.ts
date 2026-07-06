// Tests for the pulse API's PURE assembly helpers (app/api/pulse/shared.ts):
// period parsing/derivation, server-side mode filtering (owner never carries
// marketer-only keys — cross-checked BEHAVIORALLY against lib/narration's own
// owner register), the "למה?" mapping (diagnosis links + C-04 shock), and the
// row narrowing guards. No I/O anywhere — hand-math over fixtures.

import { describe, it, expect } from 'vitest';
import type { MetricValue } from '@/lib/metrics-layer';
import { METRIC_REGISTRY } from '@/lib/metrics-layer';
import { narrate } from '@/lib/narration';
import {
  buildWhys,
  DIAGNOSIS_LINK_METRICS,
  filterMetricsForMode,
  FLEET_SHOCK_METRICS,
  isPulseMode,
  narrowDiagnosisRows,
  narrowPendingRows,
  OWNER_HIDDEN_KEYS,
  parsePeriodParam,
  periodEndingOn,
  shockNoteHe,
  type FleetShockFact,
  type PulseDiagnosis,
} from '@/app/api/pulse/shared';

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

/** All 12 registry keys as computed values (value 1 each). */
const allMetrics = (): MetricValue[] =>
  METRIC_REGISTRY.map((d) =>
    mv({ key: d.key, name_he: d.name_he, unit: d.unit, direction: d.direction }));

const diag = (over: Partial<PulseDiagnosis> = {}): PulseDiagnosis => ({
  id:          'd1',
  rationale:   'הקהל מוצה — רענון קריאייטיב יעזור',
  failed_link: 'audience',
  ...over,
});

const shock = (metric: string, over: Partial<FleetShockFact['state']> = {}): FleetShockFact => ({
  metric,
  state: { shocked: true, factor: 0.4, direction: 'up', note: 'ערב חג', ...over },
});

describe('parsePeriodParam / periodEndingOn', () => {
  it('defaults to 30 days on a missing/empty param', () => {
    expect(parsePeriodParam(null)).toBe(30);
    expect(parsePeriodParam('')).toBe(30);
  });

  it('accepts exactly 7d/30d/90d and rejects the rest', () => {
    expect(parsePeriodParam('7d')).toBe(7);
    expect(parsePeriodParam('30d')).toBe(30);
    expect(parsePeriodParam('90d')).toBe(90);
    expect(parsePeriodParam('14d')).toBeNull();
    expect(parsePeriodParam('owner')).toBeNull();
  });

  it('derives an inclusive UTC period ending on the given clock date', () => {
    const now = new Date('2026-07-06T10:30:00.000Z');
    expect(periodEndingOn(30, now)).toEqual({ start: '2026-06-07', end: '2026-07-06' });
    expect(periodEndingOn(7, now)).toEqual({ start: '2026-06-30', end: '2026-07-06' });
    // 1-day period: start === end (inclusive both ends).
    expect(periodEndingOn(1, now)).toEqual({ start: '2026-07-06', end: '2026-07-06' });
  });
});

describe('isPulseMode', () => {
  it('accepts owner/marketer only', () => {
    expect(isPulseMode('owner')).toBe(true);
    expect(isPulseMode('marketer')).toBe(true);
    expect(isPulseMode('admin')).toBe(false);
    expect(isPulseMode(null)).toBe(false);
  });
});

describe('filterMetricsForMode (§1: owner payload carries zero jargon keys)', () => {
  it('owner mode strips exactly the hidden keys; marketer keeps all 12', () => {
    const metrics = allMetrics();
    const owner = filterMetricsForMode('owner', metrics);
    const marketer = filterMetricsForMode('marketer', metrics);

    expect(marketer.map((m) => m.key)).toEqual(metrics.map((m) => m.key));
    for (const hidden of OWNER_HIDDEN_KEYS) {
      expect(owner.some((m) => m.key === hidden)).toBe(false);
    }
    expect(owner.length).toBe(metrics.length - OWNER_HIDDEN_KEYS.length);
  });

  it('OWNER_HIDDEN_KEYS agrees with lib/narration: the owner register never names them', () => {
    // Behavioral cross-check — the narration engine keeps its own owner-hidden
    // set private; if the two sets drift, a hidden metric's Hebrew name will
    // appear in owner text and this test fails.
    const metrics = allMetrics();
    const ownerText = narrate(
      { period: { start: '2026-06-07', end: '2026-07-06' }, metrics, diagnoses: [], atoms: [], pendingActions: [] },
      'owner',
    ).text_he;
    for (const hidden of OWNER_HIDDEN_KEYS) {
      const def = METRIC_REGISTRY.find((d) => d.key === hidden);
      expect(def).toBeDefined();
      if (def !== undefined) expect(ownerText).not.toContain(def.name_he);
    }
  });
});

describe('buildWhys (leap 3 — the למה? mapping)', () => {
  it('attaches a diagnosis to every PRESENT metric its failed link maps to, verbatim', () => {
    const metrics = allMetrics();
    const whys = buildWhys(metrics, [diag()], []);
    // audience → qualified_rate + irrelevant_rate.
    expect(whys.qualified_rate?.diagnosis?.rationale).toBe('הקהל מוצה — רענון קריאייטיב יעזור');
    expect(whys.irrelevant_rate?.diagnosis?.rationale).toBe('הקהל מוצה — רענון קריאייטיב יעזור');
    expect(whys.leads_total).toBeUndefined();
  });

  it('never attaches to a metric absent from the (mode-filtered) list', () => {
    const onlyLeads = [mv({ key: 'leads_total' })];
    const whys = buildWhys(onlyLeads, [diag()], []);
    expect(Object.keys(whys)).toEqual([]);
  });

  it('first (most recent) diagnosis wins per metric', () => {
    const metrics = allMetrics();
    const whys = buildWhys(
      metrics,
      [diag({ id: 'new', rationale: 'חדשה' }), diag({ id: 'old', rationale: 'ישנה' })],
      [],
    );
    expect(whys.qualified_rate?.diagnosis?.id).toBe('new');
  });

  it("failed_link 'none' / unknown / null maps nowhere", () => {
    const metrics = allMetrics();
    expect(Object.keys(buildWhys(metrics, [diag({ failed_link: 'none' })], []))).toEqual([]);
    expect(Object.keys(buildWhys(metrics, [diag({ failed_link: 'mystery' })], []))).toEqual([]);
    expect(Object.keys(buildWhys(metrics, [diag({ failed_link: null })], []))).toEqual([]);
  });

  it('a shocked fleet metric attaches the shock note to its mapped spine metrics', () => {
    const metrics = allMetrics();
    const whys = buildWhys(metrics, [], [shock('cvr')]);
    for (const key of FLEET_SHOCK_METRICS['cvr']) {
      expect(whys[key]?.shock?.note_he).toContain('שוק, לא אתה');
      expect(whys[key]?.shock?.direction).toBe('up');
    }
    expect(whys.close_rate).toBeUndefined();
  });

  it('a metric can carry BOTH a diagnosis and a shock', () => {
    const metrics = allMetrics();
    const whys = buildWhys(metrics, [diag({ failed_link: 'hook' })], [shock('spend')]);
    expect(whys.cost_per_lead?.diagnosis?.id).toBe('d1');
    expect(whys.cost_per_lead?.shock).not.toBeNull();
  });

  it('un-shocked fleet facts contribute nothing', () => {
    const whys = buildWhys(allMetrics(), [], [shock('cvr', { shocked: false })]);
    expect(Object.keys(whys)).toEqual([]);
  });
});

describe('shockNoteHe', () => {
  it('null when the market is calm', () => {
    expect(shockNoteHe([])).toBeNull();
    expect(shockNoteHe([shock('cvr', { shocked: false })])).toBeNull();
  });

  it('names the shocked fleet metrics in Hebrew and echoes factor notes verbatim', () => {
    const note = shockNoteHe([shock('spend'), shock('cvr', { note: null })]);
    expect(note).toContain('שוק, לא אתה');
    expect(note).toContain('הוצאות פרסום בשוק');
    expect(note).toContain('שיעור המרה בשוק');
    expect(note).toContain('ערב חג'); // the recorded note, verbatim
  });

  it('renders no digits (direction + note only — no minted numbers)', () => {
    const note = shockNoteHe([shock('cpm', { factor: 0.37, note: null })]);
    expect(note).not.toBeNull();
    if (note !== null) expect(note).not.toMatch(/\d/);
  });
});

describe('row narrowing guards', () => {
  it('narrowPendingRows keeps well-formed rows and drops malformed ones', () => {
    const rows = narrowPendingRows([
      { id: 'a1', title: 'רענון קריאייטיב', created_at: '2026-07-01T00:00:00Z' },
      { id: 'a2', title: null, created_at: '2026-07-02T00:00:00Z' },
      { id: '', title: 'בלי מזהה', created_at: '2026-07-03T00:00:00Z' },
      { title: 'בלי כלום' },
      'not-a-row',
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('narrowPendingRows / narrowDiagnosisRows return [] on non-array input', () => {
    expect(narrowPendingRows(null)).toEqual([]);
    expect(narrowDiagnosisRows({ rows: [] })).toEqual([]);
  });

  it('narrowDiagnosisRows requires id + rationale; failed_link may be null', () => {
    const rows = narrowDiagnosisRows([
      { id: 'd1', rationale: 'סיבה', failed_link: 'hook' },
      { id: 'd2', rationale: 'עוד סיבה', failed_link: null },
      { id: 'd3', rationale: '', failed_link: 'hook' },
      { id: 'd4', failed_link: 'hook' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['d1', 'd2']);
  });
});

describe('mapping tables stay inside the registry vocabulary', () => {
  it('every mapped MetricKey exists in METRIC_REGISTRY', () => {
    const known = new Set(METRIC_REGISTRY.map((d) => d.key));
    for (const keys of Object.values(DIAGNOSIS_LINK_METRICS)) {
      for (const k of keys) expect(known.has(k)).toBe(true);
    }
    for (const keys of Object.values(FLEET_SHOCK_METRICS)) {
      for (const k of keys) expect(known.has(k)).toBe(true);
    }
  });
});
