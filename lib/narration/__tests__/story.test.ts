// buildClientStory — the dashboard headline block:
//   • deterministic attention ranking (bad movers first, then |delta|, then
//     key) with the ≤3-highlights law enforced;
//   • heads-up = worst wrong-direction mover, diagnosis fallback;
//   • forecast/pending are ECHOED, never derived;
//   • anti-hallucination + sources + determinism, same as the engine.

import { describe, expect, it } from 'vitest';
import type { MetricValue } from '@/lib/metrics-layer';
import { buildClientStory } from '../story';
import type { ClientStory } from '../types';
import { clinicMetrics, makeMetric } from './fixtures';

const numericTokens = (s: string): string[] =>
  [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);

const storyText = (s: ClientStory): string =>
  [s.headline_he, ...s.lines_he, s.pending_he ?? '', s.forecast_he ?? '', s.heads_up_he ?? ''].join('\n');

/** Six movers with hand-picked deltas — the ranking fixture. */
function sixMovers(): MetricValue[] {
  return [
    makeMetric({ key: 'leads_total',    name_he: 'לידים',        unit: 'count', direction: 'up_good',   value: 8,    delta_pct: 12,  prev: 7 }),
    makeMetric({ key: 'cost_per_lead',  name_he: 'עלות לליד',    unit: 'ils',   direction: 'down_good', value: 87.5, delta_pct: 34,  prev: 65 }),   // BAD 34
    makeMetric({ key: 'qualified_rate', name_he: 'אחוז לידים רלוונטיים', unit: 'pct', direction: 'up_good', value: 45, delta_pct: -5, prev: 47 }), // BAD 5
    makeMetric({ key: 'closed_value',   name_he: 'הכנסה מעסקאות שנסגרו', unit: 'ils', direction: 'up_good', value: 7000, delta_pct: 50, prev: 4600 }),
    makeMetric({ key: 'consent_rate',   name_he: 'אחוז הסכמה לדיוור', unit: 'pct', direction: 'up_good', value: 40, delta_pct: 2, prev: 39 }),
    makeMetric({ key: 'contacted_24h_rate', name_he: 'מענה תוך 24 שעות', unit: 'pct', direction: 'up_good', value: 50, delta_pct: 8, prev: 46 }),
  ];
}

describe('buildClientStory — ranking (the "don\'t dump 50 numbers" law)', () => {
  it('wrong-direction movers lead, then biggest |delta|; hard cap at 3 highlights', () => {
    const story = buildClientStory(sixMovers());
    expect(story.lines_he).toHaveLength(3);
    expect(story.lines_he[0]).toContain('עלות לליד');              // bad, |34|
    expect(story.lines_he[1]).toContain('אחוז לידים רלוונטיים');   // bad, |5|
    expect(story.lines_he[2]).toContain('הכנסה מעסקאות שנסגרו');   // good, |50| — biggest good mover
  });

  it('heads-up names the WORST wrong-direction metric with its verdict', () => {
    const story = buildClientStory(sixMovers());
    expect(story.heads_up_he).toBe('שים לב: עלות לליד ↑34% — טעון תשומת לב');
  });

  it('no bad movers → heads-up falls back to the top diagnosis rationale', () => {
    const goodOnly = sixMovers().filter((m) => m.key !== 'cost_per_lead' && m.key !== 'qualified_rate');
    const story = buildClientStory(goodOnly, {
      topDiagnosis: { id: 'diag-1', rationale: 'הקהל מתעייף — מומלץ לרענן קריאייטיב השבוע' },
    });
    expect(story.heads_up_he).toBe('שים לב: הקהל מתעייף — מומלץ לרענן קריאייטיב השבוע');
    expect(story.sources).toContain('diagnosis:diag-1');
  });

  it('no bad movers and no diagnosis → heads-up is null (nothing invented)', () => {
    const goodOnly = sixMovers().filter((m) => m.key !== 'cost_per_lead' && m.key !== 'qualified_rate');
    expect(buildClientStory(goodOnly).heads_up_he).toBeNull();
  });

  it('unchanged metrics (delta 0 / null) never fill highlight slots', () => {
    const story = buildClientStory([
      makeMetric({ key: 'leads_total', name_he: 'לידים', value: 5, delta_pct: 0, prev: 5 }),
      makeMetric({ key: 'closed_value', name_he: 'הכנסה', unit: 'ils', value: 7000 }),
    ]);
    expect(story.lines_he).toEqual([]);
  });
});

describe('buildClientStory — headline', () => {
  it('composes leads · cost-per-lead · worth-it from the metric values', () => {
    const story = buildClientStory(clinicMetrics());
    expect(story.headline_he).toBe('8 לידים · ₪87.5 לליד · משתלם ✅');
  });

  it('below break-even flips the worth-it verdict', () => {
    const metrics = clinicMetrics().map((m) =>
      m.key === 'roas_vs_breakeven' ? { ...m, value: 0.8 } : m);
    expect(buildClientStory(metrics).headline_he).toContain('עדיין לא משתלם ⚠️');
  });

  it('singular agreement in the headline: 1 → "ליד אחד"', () => {
    const story = buildClientStory([makeMetric({ key: 'leads_total', name_he: 'לידים', value: 1 })]);
    expect(story.headline_he).toBe('ליד אחד');
  });

  it('nothing computable → the honest empty story', () => {
    const story = buildClientStory([makeMetric({ key: 'leads_total', name_he: 'לידים' })]);
    expect(story.headline_he).toContain('עוד אין מספיק נתונים');
    expect(story.lines_he).toEqual([]);
    expect(story.sources).toEqual([]);
  });
});

describe('buildClientStory — extras are echoed, never derived', () => {
  it('forecast range renders verbatim as a range (leap 5: ranges, not points)', () => {
    const story = buildClientStory(clinicMetrics(), {
      forecastRange: { low: 180, high: 220, label_he: 'לידים עד סוף הרבעון' },
    });
    expect(story.forecast_he).toBe('📈 בקצב הזה: סביר בין 180 ל-220 לידים עד סוף הרבעון');
  });

  it('pending actions: singular vs plural agreement + first rationale verbatim', () => {
    const one = buildClientStory([], {
      pendingActions: [{ id: 'a-1', kind: 'create_paid_paused', rationale: 'אשר רענון קריאייטיב' }],
    });
    expect(one.pending_he).toBe('⚡ ממתין לך: אשר רענון קריאייטיב');

    const three = buildClientStory([], {
      pendingActions: [
        { id: 'a-2', kind: 'pause_paid', rationale: 'עצירת קמפיין מבזבז' },
        { id: 'a-1', kind: 'create_paid_paused', rationale: 'אשר רענון קריאייטיב' },
        { id: 'a-3', kind: 'reallocate_budget', rationale: 'הסטת תקציב' },
      ],
    });
    expect(three.pending_he).toBe('⚡ ממתינות לך 3 פעולות — הראשונה: אשר רענון קריאייטיב'); // a-1 first by id
    expect(three.sources).toEqual(['action:a-1', 'action:a-2', 'action:a-3']);
  });
});

describe('buildClientStory — audit trail + determinism', () => {
  it('anti-hallucination: every numeric token in the story exists in the inputs', () => {
    const metrics = sixMovers();
    const extras = { forecastRange: { low: 180, high: 220, label_he: 'לידים עד סוף הרבעון' } };
    const whitelist = new Set(numericTokens(JSON.stringify({ metrics, extras })));
    const story = buildClientStory(metrics, extras);
    const scanned = numericTokens(storyText(story));
    expect(scanned.length).toBeGreaterThan(0);
    for (const n of scanned) {
      expect(whitelist.has(n), `rendered ${n} is not present in any input`).toBe(true);
    }
  });

  it('sources are exactly the facts that contributed clauses', () => {
    const story = buildClientStory(sixMovers());
    expect(story.sources).toEqual([
      'metric:closed_value',   // highlight
      'metric:cost_per_lead',  // highlight + heads-up
      'metric:leads_total',    // headline
      'metric:qualified_rate', // highlight
    ]);
  });

  it('deterministic and shuffle-invariant', () => {
    const a = buildClientStory(sixMovers());
    const b = buildClientStory([...sixMovers()].reverse());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
