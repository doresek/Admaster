// Render tests for the Leads UI components — static markup in the node env
// (no DOM) via react-dom/server, per tests/intelligence/intelligence-ui.test.ts.
// The load-bearing assertion set: a lead row offers EXACTLY the legal next
// stages as Hebrew buttons (never one that would 409), terminal leads offer
// none, and the microcopy (source badges, consent, empty states) renders.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FunnelLeadRow } from '@/lib/capability-contracts';
import {
  ConsentMark,
  FilterTabs,
  LeadCard,
  LeadsEmptyState,
  LeadsSkeleton,
  SourceBadge,
  StageChip,
} from '../components';

const lead = (over: Partial<FunnelLeadRow> = {}): FunnelLeadRow => ({
  id: 'l1', client_id: 'c1', owner_user_id: 'u1',
  source: 'landing', source_ref: {},
  name: 'דנה כהן', phone: '0501234567', email: 'dana@example.com',
  consent_marketing: true, consent_recorded_at: '2026-07-01T10:00:00Z',
  current_stage: 'new', value: null,
  created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z',
  ...over,
});

const renderCard = (l: FunnelLeadRow, error: string | null = null) =>
  renderToStaticMarkup(React.createElement(LeadCard, {
    lead: l, busy: false, error, onMark: () => {},
  }));

describe('LeadCard', () => {
  it('renders name, contact, source badge, IL date and consent for a new lead', () => {
    const html = renderCard(lead());
    expect(html).toContain('דנה כהן');
    expect(html).toContain('0501234567');
    expect(html).toContain('tel:0501234567');
    expect(html).toContain('dana@example.com');
    expect(html).toContain('דף נחיתה');           // source badge
    expect(html).toContain('01.07.2026');          // IL-formatted created date
    expect(html).toContain('✓ אישר דיוור');        // consent indicator
  });

  it('offers ALL legal next stages from "new" as Hebrew one-tap buttons', () => {
    const html = renderCard(lead());
    for (const label of ['יצרנו קשר', 'רלוונטי', 'נקבעה פגישה', 'נסגר ✓', 'לא נסגר', 'לא רלוונטי']) {
      expect(html).toContain(label);
    }
  });

  it('offers ONLY outcome buttons from "meeting" (no backwards moves)', () => {
    const html = renderCard(lead({ current_stage: 'meeting' }));
    expect(html).toContain('נסגר ✓');
    expect(html).toContain('לא נסגר');
    // "יצרנו קשר" appears neither as chip (stage is meeting) nor as a button:
    expect(html).not.toContain('יצרנו קשר');
  });

  it('terminal lead gets NO action buttons and shows the deal value', () => {
    const html = renderCard(lead({ current_stage: 'closed_won', value: 12000 }));
    expect(html).not.toContain('<button');
    expect(html).toContain('שווי עסקה: ₪12,000');
  });

  it('closed_won without a recorded value shows —', () => {
    const html = renderCard(lead({ current_stage: 'closed_won', value: null }));
    expect(html).toContain('שווי עסקה: —');
  });

  it('closed_lost / irrelevant leads get no buttons either', () => {
    for (const stage of ['closed_lost', 'irrelevant'] as const) {
      expect(renderCard(lead({ current_stage: stage }))).not.toContain('<button');
    }
  });

  it('falls back to phone as the display name when the name is missing', () => {
    const html = renderCard(lead({ name: null }));
    expect(html).toContain('0501234567');
  });

  it('surfaces a per-lead error message in Hebrew', () => {
    const html = renderCard(lead(), 'לא הצלחנו לשמור את העדכון — נסו שוב בעוד רגע.');
    expect(html).toContain('לא הצלחנו לשמור את העדכון');
  });
});

describe('ConsentMark / SourceBadge / StageChip', () => {
  it('consent=false renders the dash, not the confirmation', () => {
    const html = renderToStaticMarkup(React.createElement(ConsentMark, { consent: false }));
    expect(html).toContain('—');
    expect(html).not.toContain('אישר דיוור');
  });

  it('renders every source in Hebrew', () => {
    const cases: readonly [FunnelLeadRow['source'], string][] = [
      ['landing', 'דף נחיתה'], ['site', 'אתר'], ['whatsapp', 'וואטסאפ'],
      ['instant_form', 'טופס'], ['call', 'שיחה'], ['manual', 'ידני'],
    ];
    for (const [source, label] of cases) {
      const html = renderToStaticMarkup(React.createElement(SourceBadge, { source }));
      expect(html).toContain(label);
    }
  });

  it('renders the stage chip with its Hebrew label', () => {
    const html = renderToStaticMarkup(React.createElement(StageChip, { stage: 'qualified' }));
    expect(html).toContain('רלוונטי');
  });
});

describe('FilterTabs', () => {
  it('renders every tab with its count', () => {
    const html = renderToStaticMarkup(React.createElement(FilterTabs, {
      active: 'in_progress',
      counts: { all: 9, new: 3, in_progress: 4, closed: 1, irrelevant: 1 },
      onChange: () => {},
    }));
    expect(html).toContain('הכל (9)');
    expect(html).toContain('חדשים (3)');
    expect(html).toContain('בטיפול (4)');
    expect(html).toContain('נסגרו (1)');
    expect(html).toContain('לא רלוונטיים (1)');
  });
});

describe('empty + loading states', () => {
  it('shows the landing-page promise when there are no leads at all', () => {
    const html = renderToStaticMarkup(React.createElement(LeadsEmptyState, { filtered: false }));
    expect(html).toContain('עדיין אין לידים');
    expect(html).toContain('הם יופיעו כאן ברגע שדף הנחיתה יתחיל לעבוד');
  });

  it('shows the filter-specific message when leads exist but none match', () => {
    const html = renderToStaticMarkup(React.createElement(LeadsEmptyState, { filtered: true }));
    expect(html).toContain('אין לידים בקטגוריה הזו');
  });

  it('skeleton renders pulsing placeholders, hidden from screen readers', () => {
    const html = renderToStaticMarkup(React.createElement(LeadsSkeleton));
    expect(html).toContain('animate-pulse');
    expect(html).toContain('aria-hidden="true"');
  });
});
