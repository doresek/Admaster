// Render tests for the pulse dashboard components — static markup in the node
// env (no DOM) via react-dom/server, matching tests/intelligence-ui.test.ts.
// The load-bearing assertions: HONESTY LABELS ARE RENDERED on tiles (the
// architecture doc's hard rule), every tile invites "למה?", the pending strip
// LINKS to /approvals (leap 6 — no inline writes), and absent whys render the
// honest "אין אבחנה זמינה עדיין".

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MetricValue } from '@/lib/metrics-layer';
import type { ClientStory } from '@/lib/narration';

// next/link needs the app router context in real renders; a plain anchor is
// enough to assert the href in static markup.
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

import {
  HonestyLabel,
  MarketerLinks,
  MetricTile,
  PendingStrip,
  ReconciliationPanel,
  StoryBlock,
  WhyPopover,
} from '../components';

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

const story: ClientStory = {
  headline_he: '4 לידים · ₪75 לליד · משתלם ✅',
  lines_he:    ['לידים: 4 (↑100% — שיפור)'],
  pending_he:  null,
  forecast_he: null,
  heads_up_he: 'שים לב: עלות לליד ↑8% — טעון תשומת לב',
  sources:     ['metric:leads_total'],
  warnings:    [],
};

describe('StoryBlock (leap 1)', () => {
  it('renders headline, highlight lines and the heads-up', () => {
    const html = renderToStaticMarkup(React.createElement(StoryBlock, { story, shockNote: null }));
    expect(html).toContain('4 לידים · ₪75 לליד · משתלם ✅');
    expect(html).toContain('לידים: 4');
    expect(html).toContain('שים לב: עלות לליד');
  });

  it('renders the forecast line ONLY when the API sent one', () => {
    const without = renderToStaticMarkup(React.createElement(StoryBlock, { story, shockNote: null }));
    expect(without).not.toContain('📈');
    const withForecast = renderToStaticMarkup(React.createElement(StoryBlock, {
      story: { ...story, forecast_he: '📈 בקצב הזה: סביר בין 180 ל-220 לידים עד סוף הרבעון' },
      shockNote: null,
    }));
    expect(withForecast).toContain('סביר בין 180 ל-220');
  });

  it('renders the shock banner when the market moved', () => {
    const html = renderToStaticMarkup(React.createElement(StoryBlock, {
      story, shockNote: 'שוק, לא אתה: זוהתה תנודה כלל-שוקית היום',
    }));
    expect(html).toContain('שוק, לא אתה');
  });
});

describe('MetricTile (leaps 3+4 + honesty)', () => {
  const metric = mv({
    key: 'cost_per_lead', name_he: 'עלות לליד', unit: 'ils', direction: 'down_good',
    value: 75, delta_pct: -8, honesty_label: 'מבוסס קליקים',
    vs_benchmark: { target: 27, met: false },
  });

  it('renders value, direction-aware delta, comparison line AND the honesty label', () => {
    const html = renderToStaticMarkup(React.createElement(MetricTile, {
      metric, why: null, onWhy: () => {},
    }));
    expect(html).toContain('עלות לליד');
    expect(html).toContain('₪75');
    expect(html).toContain('↓8%');           // down on a down_good metric = good
    expect(html).toContain('מול ענף: ₪27');
    expect(html).toContain('מבוסס קליקים');  // the honesty rule — always rendered
    expect(html).toContain('למה?');           // every tile invites the why (leap 3)
  });

  it('a null metric shows the honest empty state, with the reason in marketer mode', () => {
    const empty = mv({
      key: 'spend_total', name_he: 'השקעה בפרסום', unit: 'ils',
      value: null, not_computable_reason: 'אין קמפיינים חיים עם תקציב',
    });
    const owner = renderToStaticMarkup(React.createElement(MetricTile, {
      metric: empty, why: null, onWhy: () => {},
    }));
    expect(owner).toContain('אין נתונים עדיין');
    expect(owner).not.toContain('אין קמפיינים חיים');
    const marketer = renderToStaticMarkup(React.createElement(MetricTile, {
      metric: empty, why: null, showReason: true, onWhy: () => {},
    }));
    expect(marketer).toContain('אין קמפיינים חיים עם תקציב');
  });
});

describe('WhyPopover (leap 3)', () => {
  it('shows diagnosis + shock lines verbatim when present', () => {
    const html = renderToStaticMarkup(React.createElement(WhyPopover, {
      metric: mv({ key: 'qualified_rate', name_he: 'אחוז לידים רלוונטיים', unit: 'pct' }),
      why: {
        diagnosis: { id: 'd1', rationale: 'הקהל מוצה — רענון יעזור', failed_link: 'audience' },
        shock:     { note_he: 'שוק, לא אתה: תנודה כלל-שוקית', direction: 'down' },
      },
      onClose: () => {},
    }));
    expect(html).toContain('הקהל מוצה — רענון יעזור');
    expect(html).toContain('שוק, לא אתה');
  });

  it('absent why → the honest "אין אבחנה זמינה עדיין"', () => {
    const html = renderToStaticMarkup(React.createElement(WhyPopover, {
      metric: mv({ key: 'leads_total', name_he: 'לידים' }),
      why: null,
      onClose: () => {},
    }));
    expect(html).toContain('אין אבחנה זמינה עדיין');
  });
});

describe('PendingStrip (leap 6 — a LINK, never an inline write)', () => {
  it('links to /approvals with the count and first title', () => {
    const html = renderToStaticMarkup(React.createElement(PendingStrip, {
      pending: [
        { id: 'a1', title: 'אשר רענון קריאייטיב', created_at: '2026-07-05T00:00:00Z' },
        { id: 'a2', title: null, created_at: '2026-07-04T00:00:00Z' },
      ],
      note: null,
    }));
    expect(html).toContain('href="/approvals"');
    expect(html).toContain('2 פעולות לאישור');
    expect(html).toContain('אשר רענון קריאייטיב');
  });

  it('renders nothing when the queue is empty, and the note when the read failed', () => {
    expect(renderToStaticMarkup(React.createElement(PendingStrip, { pending: [], note: null }))).toBe('');
    const failed = renderToStaticMarkup(React.createElement(PendingStrip, {
      pending: [], note: 'לא הצלחנו לקרוא את הפעולות הממתינות כרגע',
    }));
    expect(failed).toContain('לא הצלחנו לקרוא');
  });
});

describe('marketer extras', () => {
  it('ReconciliationPanel shows the ratio against the healthy benchmark', () => {
    const html = renderToStaticMarkup(React.createElement(ReconciliationPanel, {
      metric: mv({
        key: 'reconciliation_ratio', name_he: 'יחס דיווח פלטפורמה מול CRM',
        unit: 'ratio', direction: 'down_good', value: 1.8,
        vs_benchmark: { target: 1.2, met: false },
      }),
    }));
    expect(html).toContain('פי 1.8');
    expect(html).toContain('מעל הטווח הבריא');
    expect(html).toContain('פי 1.2');
  });

  it('ReconciliationPanel surfaces the null reason honestly', () => {
    const html = renderToStaticMarkup(React.createElement(ReconciliationPanel, {
      metric: mv({
        key: 'reconciliation_ratio', unit: 'ratio', value: null,
        not_computable_reason: 'אין נתוני הצלבה לתקופה',
      }),
    }));
    expect(html).toContain('אין נתוני הצלבה לתקופה');
  });

  it('MarketerLinks links to the existing deeper surfaces only', () => {
    const html = renderToStaticMarkup(React.createElement(MarketerLinks));
    expect(html).toContain('href="/command-center"');
    expect(html).toContain('href="/approvals"');
  });

  it('HonestyLabel renders nothing for a null label', () => {
    expect(renderToStaticMarkup(React.createElement(HonestyLabel, { label: null }))).toBe('');
  });
});
