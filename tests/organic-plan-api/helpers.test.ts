// tests/organic-plan-api/helpers.test.ts
//
// P1-5 — pure helpers of the calendar plan API (app/api/organic/plan/helpers.ts).
// Fully offline: injected dates, no DB, no network.

import { describe, expect, it } from 'vitest';
import {
  nextSundayISO,
  reconstructPlanSlot,
  slotDateISO,
} from '@/app/api/organic/plan/helpers';

// ── nextSundayISO ──────────────────────────────────────────────────────────────

describe('nextSundayISO', () => {
  it('returns the upcoming Sunday for a mid-week date', () => {
    // 2026-07-01 is a Wednesday → next Sunday is 2026-07-05
    expect(nextSundayISO(new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-05');
  });

  it('is STRICTLY after: a Sunday maps to the following Sunday', () => {
    // 2026-07-05 is a Sunday → 2026-07-12, never "today"
    expect(nextSundayISO(new Date('2026-07-05T08:00:00Z'))).toBe('2026-07-12');
  });

  it('handles Saturday (the day before)', () => {
    // 2026-07-04 is a Saturday → 2026-07-05
    expect(nextSundayISO(new Date('2026-07-04T23:00:00Z'))).toBe('2026-07-05');
  });

  it('crosses month boundaries', () => {
    // 2026-07-31 is a Friday → Sunday 2026-08-02
    expect(nextSundayISO(new Date('2026-07-31T00:00:00Z'))).toBe('2026-08-02');
  });

  it('always lands on a Sunday', () => {
    for (let d = 1; d <= 7; d++) {
      const iso = nextSundayISO(new Date(Date.UTC(2026, 6, d)));
      expect(new Date(`${iso}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });
});

// ── slotDateISO ────────────────────────────────────────────────────────────────

describe('slotDateISO', () => {
  it('extracts the date from the IDT-offset form record.ts writes', () => {
    expect(slotDateISO('2026-07-12T10:00:00+03:00')).toBe('2026-07-12');
  });

  it('extracts the date from the UTC-normalized form Postgres returns', () => {
    // 10:00+03:00 stored ⇒ 07:00Z returned — same calendar date
    expect(slotDateISO('2026-07-12T07:00:00+00:00')).toBe('2026-07-12');
  });

  it('handles the winter (IST +02:00) offset', () => {
    expect(slotDateISO('2026-12-06T10:00:00+02:00')).toBe('2026-12-06');
    expect(slotDateISO('2026-12-06T08:00:00+00:00')).toBe('2026-12-06');
  });

  it('falls back to a plain slice for a bare ISO date', () => {
    expect(slotDateISO('2026-07-12')).toBe('2026-07-12');
  });
});

// ── reconstructPlanSlot ────────────────────────────────────────────────────────

const row = {
  scheduled_at: '2026-07-12T10:00:00+03:00',
  message: null as string | null,
  grounded_in: ['atom_1'],
  rationale: 'מבוסס על תובנת כאב.',
};

describe('reconstructPlanSlot', () => {
  it('rebuilds the PlanSlot from the matching calendar_slot decision', () => {
    const { slot, degraded } = reconstructPlanSlot(row, [
      { decision: { date: '2026-07-10', post_type: 'story', topic: 'אחר', angle: 'א' } },
      { decision: { date: '2026-07-12', post_type: 'offer', topic: 'הצעת קיץ', angle: 'חיזוק הרצון' } },
    ]);
    expect(degraded).toBe(false);
    expect(slot).toEqual({
      date: '2026-07-12',
      post_type: 'offer',
      topic: 'הצעת קיץ',
      angle: 'חיזוק הרצון',
      grounded_in: ['atom_1'],
      rationale: 'מבוסס על תובנת כאב.',
    });
  });

  it('matches by date even when scheduled_at comes back UTC-normalized', () => {
    const { slot, degraded } = reconstructPlanSlot(
      { ...row, scheduled_at: '2026-07-12T07:00:00+00:00' },
      [{ decision: { date: '2026-07-12', post_type: 'tip', topic: 'טיפ', angle: 'ערך מקצועי' } }],
    );
    expect(degraded).toBe(false);
    expect(slot.topic).toBe('טיפ');
  });

  it('sanitizes an unknown post_type in the decision to tip', () => {
    const { slot } = reconstructPlanSlot(row, [
      { decision: { date: '2026-07-12', post_type: 'meme', topic: 'נושא', angle: 'זווית' } },
    ]);
    expect(slot.post_type).toBe('tip');
  });

  it('degrades to the row rationale when no decision matches', () => {
    const { slot, degraded } = reconstructPlanSlot(row, []);
    expect(degraded).toBe(true);
    expect(slot.post_type).toBe('tip');
    expect(slot.angle).toBe('ערך מקצועי');
    expect(slot.topic).toBe('מבוסס על תובנת כאב.');
    expect(slot.grounded_in).toEqual(['atom_1']);
  });

  it('prefers the message over the rationale in the degraded topic', () => {
    const { slot } = reconstructPlanSlot({ ...row, message: 'פוסט קיים שכבר נכתב' }, []);
    expect(slot.topic).toBe('פוסט קיים שכבר נכתב');
  });

  it('caps the degraded topic at 80 chars', () => {
    const long = 'א'.repeat(200);
    const { slot } = reconstructPlanSlot({ ...row, rationale: long, message: null }, []);
    expect(slot.topic).toHaveLength(80);
  });

  it('survives a fully empty row (generic topic, empty grounding)', () => {
    const { slot, degraded } = reconstructPlanSlot(
      { scheduled_at: '2026-07-12T10:00:00+03:00', message: null, grounded_in: null, rationale: null },
      [],
    );
    expect(degraded).toBe(true);
    expect(slot.topic).toBe('פוסט ערך לעסק');
    expect(slot.grounded_in).toEqual([]);
    expect(slot.rationale).toBeTruthy();
  });
});
