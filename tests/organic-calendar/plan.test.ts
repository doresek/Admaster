// tests/organic-calendar/plan.test.ts
//
// P1-2 planner core. Fully deterministic: fixed startDate (never Date.now()),
// deterministicExpander only, no network. Date facts used below:
//   2026-07-05 = Sunday, 2026-07-08 = Wednesday, 2026-09-13 = Sunday,
//   2026-06-07 = Sunday. Holidays: ראש השנה 2026-09-11, יום כיפור 2026-09-20.

import { describe, expect, it, vi } from 'vitest';
import type { ClientInsight } from '@/lib/intelligence/types';
import { buildCalendarPlan } from '@/lib/organic-calendar/plan';
import { holidaysInRange } from '@/lib/organic-calendar/holidays';
import { deterministicExpander, type TopicExpander } from '@/lib/organic-calendar/types';

let seq = 0;
function makeAtom(overrides: Partial<ClientInsight> = {}): ClientInsight {
  seq += 1;
  return {
    id: `atom_${seq}`,
    client_id: 'client_1',
    owner_user_id: 'user_1',
    layer: 'customers',
    kind: 'pain',
    content: `תוכן תובנה מספר ${seq} — הלקוחות מתקשים למצוא זמן לשיווק`,
    structured: null,
    source: 'brief',
    source_ref: null,
    confidence: 0.8,
    evidence_count: 1,
    status: 'active',
    superseded_by: null,
    superseded_reason: null,
    first_seen_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const SATURDAY = 6;
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe('buildCalendarPlan — scheduling', () => {
  it('produces weeks×postsPerWeek slots on Sun/Tue/Thu, never Saturday, ascending', async () => {
    const plan = await buildCalendarPlan({
      atoms: [makeAtom(), makeAtom(), makeAtom()],
      config: { weeks: 2, postsPerWeek: 3, startDate: '2026-07-05' },
      expander: deterministicExpander,
    });

    expect(plan.slots.map((s) => s.date)).toEqual([
      '2026-07-05', '2026-07-07', '2026-07-09', // Sun/Tue/Thu week 1
      '2026-07-12', '2026-07-14', '2026-07-16', // Sun/Tue/Thu week 2
    ]);
    for (const s of plan.slots) expect(dow(s.date)).not.toBe(SATURDAY);
  });

  it('handles a mid-week start: still Sun/Tue/Thu preference inside each 7-day window', async () => {
    const plan = await buildCalendarPlan({
      atoms: [makeAtom()],
      config: { weeks: 2, postsPerWeek: 3, startDate: '2026-07-08' }, // Wednesday
    });
    // Window 07-08..07-14 holds Thu 07-09, Sun 07-12, Tue 07-14.
    expect(plan.slots.slice(0, 3).map((s) => s.date)).toEqual([
      '2026-07-09', '2026-07-12', '2026-07-14',
    ]);
    for (const s of plan.slots) expect(dow(s.date)).not.toBe(SATURDAY);
  });

  it('never schedules Saturday even at the 7-posts-per-week extreme (capped at 6)', async () => {
    const plan = await buildCalendarPlan({
      atoms: [makeAtom()],
      config: { weeks: 2, postsPerWeek: 7, startDate: '2026-07-05' },
    });
    expect(plan.slots).toHaveLength(12); // 6 postable days per week
    for (const s of plan.slots) expect(dow(s.date)).not.toBe(SATURDAY);
  });
});

describe('buildCalendarPlan — post-type rotation (trust ladder)', () => {
  it('keeps offers to at most 1 in any 4 consecutive slots', async () => {
    // 2026-06-07 (Sunday) start: >14 days after שבועות, well before ראש השנה —
    // no holiday conversions can eat into the rotation under test.
    const plan = await buildCalendarPlan({
      atoms: [makeAtom(), makeAtom()],
      config: { weeks: 4, postsPerWeek: 4, startDate: '2026-06-07' },
    });

    expect(plan.slots).toHaveLength(16);
    expect(plan.slots.every((s) => s.post_type !== 'holiday')).toBe(true);
    const offers = plan.slots.filter((s) => s.post_type === 'offer').length;
    expect(offers).toBe(4); // exactly 1-in-4 from the rotation
    for (let i = 0; i + 4 <= plan.slots.length; i++) {
      const window = plan.slots.slice(i, i + 4);
      expect(window.filter((s) => s.post_type === 'offer').length).toBeLessThanOrEqual(1);
    }
    // The ladder itself: tip → story → engagement → offer.
    expect(plan.slots.slice(0, 4).map((s) => s.post_type)).toEqual([
      'tip', 'story', 'engagement', 'offer',
    ]);
  });
});

describe('buildCalendarPlan — holiday conversion', () => {
  it('converts a slot to a holiday-prep post when a holiday is UPCOMING within 14 days', async () => {
    const plan = await buildCalendarPlan({
      atoms: [makeAtom()],
      config: { weeks: 2, postsPerWeek: 3, startDate: '2026-09-13' }, // יום כיפור 09-20 and סוכות 09-25 ahead
    });

    // First slot (09-13): the nearest upcoming holiday in the 14-day window is יום כיפור (09-20).
    const first = plan.slots[0];
    expect(first.date).toBe('2026-09-13');
    expect(first.post_type).toBe('holiday');
    expect(first.topic).toContain('יום כיפור');
    expect(first.rationale).toContain('יום כיפור');
    // A slot after יום כיפור but at/before סוכות preps for סוכות (nearest upcoming wins).
    const beforeSukkot = plan.slots.find((s) => s.date > '2026-09-20' && s.date <= '2026-09-25');
    expect(beforeSukkot?.post_type).toBe('holiday');
    expect(beforeSukkot?.topic).toContain('סוכות');
  });

  it('leaves the rotation untouched when no holiday is in range', async () => {
    const plan = await buildCalendarPlan({
      atoms: [makeAtom()],
      config: { weeks: 2, postsPerWeek: 3, startDate: '2026-07-05' },
    });
    expect(plan.slots.every((s) => s.post_type !== 'holiday')).toBe(true);
  });
});

describe('buildCalendarPlan — atoms and grounding', () => {
  it('zero atoms ⇒ valid generic plan, empty grounding, no throw', async () => {
    const plan = await buildCalendarPlan({
      atoms: [],
      config: { weeks: 2, postsPerWeek: 3, startDate: '2026-07-05' },
    });

    expect(plan.slots).toHaveLength(6);
    expect(plan.grounded_in).toEqual([]);
    for (const s of plan.slots) {
      expect(s.grounded_in).toEqual([]);
      expect(s.topic.length).toBeGreaterThan(0);
      expect(s.rationale.length).toBeGreaterThan(0);
    }
  });

  it('only active customers/bridge atoms participate; each slot is grounded in its topic atom', async () => {
    const usable = makeAtom({ id: 'atom_pain', kind: 'pain', confidence: 0.9 });
    const bridge = makeAtom({ id: 'atom_bridge', layer: 'bridge', kind: 'positioning', confidence: 0.7 });
    const superseded = makeAtom({ id: 'atom_dead', status: 'superseded', confidence: 0.99 });
    const business = makeAtom({ id: 'atom_biz', layer: 'business', confidence: 0.99 });
    const wrongKind = makeAtom({ id: 'atom_review', kind: 'review_quote', confidence: 0.99 });

    const plan = await buildCalendarPlan({
      atoms: [usable, bridge, superseded, business, wrongKind],
      config: { weeks: 2, postsPerWeek: 3, startDate: '2026-07-05' },
    });

    expect(plan.grounded_in.sort()).toEqual(['atom_bridge', 'atom_pain']);
    for (const s of plan.slots) {
      expect(s.grounded_in.length).toBe(1);
      expect(['atom_pain', 'atom_bridge']).toContain(s.grounded_in[0]);
      expect(s.rationale).toMatch(/מבוסס על תובנת/);
    }
    // pain atom has higher confidence ⇒ leads the round-robin; Hebrew kind label.
    expect(plan.slots[0].grounded_in).toEqual(['atom_pain']);
    expect(plan.slots[0].rationale).toContain('כאב');
    expect(plan.slots[0].angle).toBe('פתרון הכאב');
  });

  it('calls the expander exactly once with the full slot count, and survives expander failure', async () => {
    const spy = vi.fn<TopicExpander>(async ({ slotCount }) => ({
      topics: Array.from({ length: slotCount }, (_, i) => ({
        topic: `נושא ${i}`, angle: 'ערך מקצועי', atomIds: [],
      })),
    }));
    const plan = await buildCalendarPlan({
      atoms: [makeAtom()],
      config: { weeks: 3, postsPerWeek: 2, startDate: '2026-07-05' },
      expander: spy,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].slotCount).toBe(6);
    expect(plan.slots.map((s) => s.topic)).toEqual(['נושא 0', 'נושא 1', 'נושא 2', 'נושא 3', 'נושא 4', 'נושא 5']);

    // A throwing expander degrades to the deterministic fallback — never throws.
    const broken: TopicExpander = async () => { throw new Error('LLM down'); };
    const fallback = await buildCalendarPlan({
      atoms: [makeAtom({ id: 'atom_x', content: 'תוכן ייחודי לפולבק' })],
      config: { weeks: 2, postsPerWeek: 2, startDate: '2026-07-05' },
      expander: broken,
    });
    expect(fallback.slots).toHaveLength(4);
    expect(fallback.slots[0].topic).toContain('תוכן ייחודי לפולבק');
  });
});

describe('holidaysInRange', () => {
  it('returns holidays inside the inclusive range, and nothing outside it', () => {
    expect(holidaysInRange('2026-09-11', '2026-09-25').map((h) => h.name)).toEqual([
      'ראש השנה', 'יום כיפור', 'סוכות',
    ]);
    expect(holidaysInRange('2026-06-01', '2026-08-31')).toEqual([]);
  });
});
