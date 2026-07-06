// app/api/organic/plan/helpers.ts
//
// Pure helpers for the P1-5 calendar plan API. No DB, no clock reads (callers
// inject `Date`s), no LLM — everything here is unit-testable in isolation
// (tests/organic-plan-api/).

import type { PlanPostType, PlanSlot } from '@/lib/organic-calendar/types';

/** The post_type values the calendar planner can emit (mirrors PlanPostType). */
const POST_TYPES = new Set<PlanPostType>(['tip', 'story', 'offer', 'engagement', 'holiday']);

/**
 * The next Sunday STRICTLY AFTER `from` (ISO date). Sunday is the natural
 * Israeli week start; "strictly after" means a plan created on a Sunday starts
 * next week, so slot times (10:00) are never already in the past.
 */
export function nextSundayISO(from: Date): string {
  const d = new Date(from.getTime());
  const daysAhead = (7 - d.getUTCDay()) % 7 || 7; // 1..7, never 0
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

/**
 * The ISO date (YYYY-MM-DD) of a schedule row's `scheduled_at` timestamp.
 * Slots are recorded at 10:00 Israel local time (see organic-calendar/record.ts),
 * so the UTC date always equals the local date — a plain UTC slice is exact.
 */
export function slotDateISO(scheduledAt: string): string {
  const ms = Date.parse(scheduledAt);
  if (!Number.isFinite(ms)) return scheduledAt.slice(0, 10); // already YYYY-MM-DD…
  return new Date(ms).toISOString().slice(0, 10);
}

/** The slice of an organic_schedule row the reconstruction needs. */
export interface ScheduleRowLike {
  scheduled_at: string;
  message: string | null;
  grounded_in: string[] | null;
  rationale: string | null;
}

/** The slice of a calendar_slot campaign_decisions row the reconstruction needs. */
export interface CalendarDecisionLike {
  decision: Record<string, unknown>;
  grounded_in?: string[] | null;
  rationale?: string | null;
}

/**
 * Rebuild the PlanSlot for a schedule row from its campaign's calendar_slot
 * decisions (recorded by recordCalendarPlan — decision jsonb carries
 * {date, post_type, topic, angle}). Matching key: the slot's date.
 *
 * DEGRADED PATH: when no matching decision exists (older data, partial
 * recording), the slot still generates — topic falls back to the row's
 * message/rationale, post_type to 'tip'. A useful post beats a hard 404.
 */
export function reconstructPlanSlot(
  row: ScheduleRowLike,
  decisions: readonly CalendarDecisionLike[],
): { slot: PlanSlot; degraded: boolean } {
  const date = slotDateISO(row.scheduled_at);
  const match = decisions.find((d) => d.decision?.date === date);

  if (match) {
    const dec = match.decision;
    const rawType = typeof dec.post_type === 'string' ? dec.post_type : '';
    const post_type = POST_TYPES.has(rawType as PlanPostType) ? (rawType as PlanPostType) : 'tip';
    return {
      degraded: false,
      slot: {
        date,
        post_type,
        topic: typeof dec.topic === 'string' && dec.topic ? dec.topic : 'פוסט ערך לעסק',
        angle: typeof dec.angle === 'string' && dec.angle ? dec.angle : 'ערך מקצועי',
        grounded_in: row.grounded_in ?? match.grounded_in ?? [],
        rationale: row.rationale ?? match.rationale ?? 'תא מלוח התוכן האורגני.',
      },
    };
  }

  // Degrade: derive a topic from what the row itself carries.
  const topicSource = row.message ?? row.rationale ?? '';
  return {
    degraded: true,
    slot: {
      date,
      post_type: 'tip',
      topic: topicSource ? topicSource.slice(0, 80) : 'פוסט ערך לעסק',
      angle: 'ערך מקצועי',
      grounded_in: row.grounded_in ?? [],
      rationale: row.rationale ?? 'תא מלוח התוכן האורגני (ללא החלטת לוח תואמת).',
    },
  };
}
