// lib/organic-calendar/types.ts
//
// P1-2 organic content calendar — domain types + the two seams the planner
// depends on: LLM topic expansion (`TopicExpander`) and schedule persistence
// (`ScheduleStore`). The planner core (plan.ts) is fully deterministic; every
// non-deterministic concern (LLM, DB, clock) lives BEHIND these seams so unit
// tests never touch the network and never read Date.now().

import type { ClientInsight } from '@/lib/intelligence/types';

// ── plan shapes ────────────────────────────────────────────────────────────────

/**
 * What a slot is for. The rotation tip → story → engagement → offer is the
 * "trust ladder": we earn attention three times before we ask for anything.
 * 'holiday' is not part of the rotation — it is a conversion applied when an
 * Israeli holiday falls close to the slot (see plan.ts).
 */
export type PlanPostType = 'tip' | 'story' | 'offer' | 'engagement' | 'holiday';

/** One planned Facebook post. `date` is an ISO date (YYYY-MM-DD). */
export interface PlanSlot {
  date: string;
  post_type: PlanPostType;
  topic: string;
  angle: string;
  /** client_insights atom ids this slot's topic drew from ([] for generic topics). */
  grounded_in: string[];
  /** Hebrew, names the atom kind the slot draws from — the auditable WHY. */
  rationale: string;
}

/** The full 2–4-week plan. `grounded_in` is the dedup union of all slots'. */
export interface CalendarPlan {
  slots: PlanSlot[];
  grounded_in: string[];
  rationale: string;
}

/**
 * Planner config. `startDate` is REQUIRED (ISO date) — the planner never
 * defaults to Date.now(), so the same inputs always produce the same plan.
 */
export interface PlanConfig {
  weeks: 2 | 3 | 4;
  /** 1..7, default 3. Effectively capped at 6 — Shabbat is never scheduled. */
  postsPerWeek?: number;
  startDate: string;
}

// ── LLM seam ───────────────────────────────────────────────────────────────────

/** The slice of an insight atom the expander is allowed to see. */
export type ExpanderAtom = Pick<ClientInsight, 'id' | 'kind' | 'content' | 'confidence'>;

/**
 * The ONLY LLM touchpoint of the calendar generator. plan.ts calls it exactly
 * once per plan (with the total slot count); a later task wires a real model
 * behind it. Tests + the zero/failure fallback use `deterministicExpander`.
 */
export type TopicExpander = (input: {
  atoms: ExpanderAtom[];
  slotCount: number;
}) => Promise<{ topics: { topic: string; angle: string; atomIds: string[] }[] }>;

/** Hebrew angle per atom kind — the editorial stance a post takes on the atom. */
function angleForKind(kind: string): string {
  if (kind === 'pain') return 'פתרון הכאב';
  if (kind === 'objection') return 'טיפול בהתנגדות';
  if (kind === 'desire' || kind === 'aspiration' || kind === 'dream') return 'חיזוק הרצון';
  return 'ערך מקצועי';
}

/**
 * Generic Hebrew topics for clients with zero usable atoms — the calendar must
 * still produce a valid, postable plan (consistent presence beats silence).
 */
const GENERIC_TOPICS: { topic: string; angle: string }[] = [
  { topic: 'טיפ מקצועי מהתחום שלנו', angle: 'ערך מקצועי' },
  { topic: 'שאלה לקהל: מה הכי מאתגר אתכם בתחום?', angle: 'ערך מקצועי' },
  { topic: 'הצצה קטנה מאחורי הקלעים של העסק', angle: 'ערך מקצועי' },
  { topic: 'טעות נפוצה שכדאי להימנע ממנה', angle: 'ערך מקצועי' },
];

/**
 * Deterministic topic expansion — the test double AND the runtime fallback
 * (zero atoms / expander failure). Derives topics straight from atom contents:
 * round-robin over atoms sorted by confidence desc (id asc as a stable
 * tie-break), topic = first 80 chars of the content, angle from the kind.
 */
export const deterministicExpander: TopicExpander = async ({ atoms, slotCount }) => {
  const n = Math.max(0, slotCount);
  const sorted = [...atoms].sort(
    (a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id),
  );
  if (sorted.length === 0) {
    return {
      topics: Array.from({ length: n }, (_, i) => ({
        ...GENERIC_TOPICS[i % GENERIC_TOPICS.length],
        atomIds: [],
      })),
    };
  }
  return {
    topics: Array.from({ length: n }, (_, i) => {
      const atom = sorted[i % sorted.length];
      return {
        topic: atom.content.slice(0, 80),
        angle: angleForKind(atom.kind),
        atomIds: [atom.id],
      };
    }),
  };
};

// ── schedule persistence seam ──────────────────────────────────────────────────

/**
 * Insert shape for a `public.organic_schedule` row (migration 051 — already
 * applied). Mirrors the table's insertable columns exactly; id/published_at/
 * meta_post_id are DB-assigned or owned by the publisher task.
 */
export interface OrganicScheduleInsert {
  client_id: string;
  owner_user_id: string;
  campaign_id: string | null;
  campaign_item_id: string | null;
  page_id: string | null;
  post_kind: 'text' | 'photo' | 'link';
  message: string | null;
  image_url: string | null;
  link_url: string | null;
  scheduled_at: string;
  status: 'planned' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  grounded_in: string[];
  rationale: string | null;
}

/**
 * Persistence seam for organic_schedule. Same doctrine as CampaignStore:
 * inserts are best-effort (null on failure, never throw) so a dry-run plan
 * never crashes on recording. Implementations live in record.ts.
 */
export interface ScheduleStore {
  insertSlot(row: OrganicScheduleInsert): Promise<{ id: string } | null>;
}
