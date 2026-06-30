// Render tests for the Client Intelligence UI. Rendered to static markup in the
// node env (no DOM) via react-dom/server — enough to assert the wall lays out
// the three layers, the unspoken_want badge, the four strategy sections, and the
// build-in-progress reveal.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONFIDENCE, type ClientInsight } from '@/lib/intelligence/types';
import type { StrategyAnalysis } from '@/lib/analyze-brief';

// BuildingBrain uses useRouter — stub it (useEffect/poll never run in static render).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { KnowledgeWall } from '@/components/intelligence/KnowledgeWall';
import { StrategySnapshot } from '@/components/intelligence/StrategySnapshot';
import { BuildingBrain } from '@/components/intelligence/BuildingBrain';

const insight = (over: Partial<ClientInsight> = {}): ClientInsight => ({
  id: 'i1', client_id: 'c1', owner_user_id: 'u1',
  layer: 'business', kind: 'real_usp', content: 'תוכן ברירת מחדל', structured: null,
  source: 'brief', source_ref: null, confidence: CONFIDENCE.START, evidence_count: 1,
  status: 'active', superseded_by: null, superseded_reason: null,
  first_seen_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z', ...over,
});

describe('KnowledgeWall', () => {
  const insights = [
    insight({ id: 'b1', layer: 'business', content: 'האמת על העסק', confidence: 0.9, source: 'brief' }),
    insight({ id: 'c1', layer: 'customers', kind: 'pain', content: 'כאב הלקוח', confidence: 0.7 }),
    insight({ id: 'c2', layer: 'customers', kind: 'unspoken_want', content: 'מה שהם רוצים בשקט', confidence: 0.6 }),
    insight({ id: 'g1', layer: 'bridge', kind: 'angle', content: 'הזווית המנצחת', confidence: 0.55 }),
  ];
  const html = renderToStaticMarkup(React.createElement(KnowledgeWall, { insights }));

  it('renders the three layer columns', () => {
    expect(html).toContain('🏢 העסק');
    expect(html).toContain('👥 הלקוחות');
    expect(html).toContain('🌉 הגשר');
  });

  it('renders an insight card per layer with its content + confidence %', () => {
    expect(html).toContain('האמת על העסק');
    expect(html).toContain('כאב הלקוח');
    expect(html).toContain('הזווית המנצחת');
    expect(html).toContain('90%'); // business atom confidence 0.9
  });

  it('marks an unspoken_want card with the distinct badge', () => {
    expect(html).toContain('מה שהם לא אומרים');
    expect(html).toContain('מה שהם רוצים בשקט');
  });

  it('renders the source chip and freshness', () => {
    expect(html).toContain('מהבריף');      // source=brief chip
    expect(html).toContain('נוצר/עודכן');   // freshness line
  });
});

describe('StrategySnapshot', () => {
  const analysis: StrategyAnalysis = {
    strategic_summary: { goal: 'יעד המכירה', core_offer: 'ההצעה המרכזית', usp: 'הבידול הייחודי', constraints: ['תקציב מוגבל'] },
    sub_audience: { name: 'אמהות צעירות', awareness_level: 'מודעות לפתרון', persona: 'פרסונה תמציתית', explanation: 'הסבר הקהל' },
    platform_funnel: { platform: 'Instagram', ad_format: 'Reels', funnel_type: 'lead-gen', platform_reason: 'כי שם הקהל', format_reason: 'וידאו ממיר', funnel_reason: 'איסוף לידים' },
    offer_stack: { components: ['רכיב א'], strengths: ['חוזקה א'], assessment: 'הערכה כוללת חזקה' },
    raw_text: '',
  };
  const html = renderToStaticMarkup(React.createElement(StrategySnapshot, {
    analysis, activeCount: 7, coreGeneratedAt: '2026-06-01T00:00:00Z', clientId: 'c1',
  }));

  it('renders the four sections', () => {
    expect(html).toContain('סיכום אסטרטגי');
    expect(html).toContain('הקהל המומלץ');
    expect(html).toContain('פלטפורמה ומשפך');
    expect(html).toContain('הערכת הצעה');
  });

  it('renders field values from the fixture', () => {
    expect(html).toContain('יעד המכירה');
    expect(html).toContain('הבידול הייחודי');
    expect(html).toContain('Instagram');
    expect(html).toContain('הערכה כוללת חזקה');
    expect(html).toContain('מודעות לפתרון');
  });

  it('renders the synthesized-from header', () => {
    expect(html).toContain('מסונתז מ-7 תובנות פעילות');
  });
});

describe('BuildingBrain', () => {
  const html = renderToStaticMarkup(React.createElement(BuildingBrain, { clientId: 'c1' }));
  it('shows the learning state + pipeline ticker', () => {
    expect(html).toContain('המערכת לומדת את הלקוח');
    expect(html).toContain('קוראת את הבריף');
    expect(html).toContain('מחלצת תובנות');
    expect(html).toContain('מסנתזת אסטרטגיה');
  });
});
