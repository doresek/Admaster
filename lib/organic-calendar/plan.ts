// lib/organic-calendar/plan.ts
//
// The deterministic planner core: same atoms + same config ⇒ the exact same
// plan, byte for byte. All date math is UTC on ISO date strings (no Date.now(),
// no machine timezone), topics come from the injected TopicExpander (called
// exactly ONCE), and every slot carries grounded_in + a Hebrew rationale so the
// calendar is auditable like every other AI-marketer decision.

import type { ClientInsight } from '@/lib/intelligence/types';
import { IL_HOLIDAYS, type ILHoliday } from './holidays';
import {
  deterministicExpander,
  type CalendarPlan,
  type ExpanderAtom,
  type PlanConfig,
  type PlanPostType,
  type PlanSlot,
  type TopicExpander,
} from './types';

const DAY_MS = 86_400_000;

/**
 * Weekday preference for slot placement (getUTCDay values). Sun/Tue/Thu first —
 * even spacing across the Israeli work week — then the remaining weekdays.
 * Saturday (6) is deliberately absent: we never schedule on Shabbat.
 */
const DOW_PREFERENCE = [0, 2, 4, 1, 3, 5];

/**
 * A slot converts to a 'holiday' post when a holiday falls within this many
 * days AFTER the slot (inclusive of the slot's own date) — holiday marketing
 * runs BEFORE the chag (preparation, offers, "מתארגנים לחג"), not after it.
 */
const HOLIDAY_LOOKAHEAD_DAYS = 14;

/** tip → story → engagement → offer: offer is structurally at most 1-in-4. */
const ROTATION: PlanPostType[] = ['tip', 'story', 'engagement', 'offer'];

/** Customer-layer kinds that seed topics (mirrors the intelligence contract). */
const SEED_KINDS = new Set([
  'pain', 'desire', 'aspiration', 'dream', 'unspoken_want', 'objection', 'awareness', 'persona',
]);

/** Hebrew labels for atom kinds, used in slot rationales. */
const KIND_HE: Record<string, string> = {
  pain: 'כאב',
  desire: 'רצון',
  aspiration: 'שאיפה',
  dream: 'חלום',
  unspoken_want: 'רצון סמוי',
  objection: 'התנגדות',
  awareness: 'מודעות',
  persona: 'פרסונה',
};

// ── UTC date helpers (deterministic, timezone-free) ────────────────────────────

function parseISODate(iso: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) {
    // A missing/garbage startDate is a programmer error, not a data condition —
    // fail loudly instead of silently planning from the epoch.
    throw new Error(`[organic-calendar] invalid ISO date: ${JSON.stringify(iso)}`);
  }
  return ms;
}

function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ── scheduling ─────────────────────────────────────────────────────────────────

/**
 * The dates the plan will post on: for each week (a 7-day window starting at
 * startDate + 7w) pick the `perWeek` most-preferred weekdays, then emit them in
 * chronological order. Deterministic by construction.
 */
function scheduleDates(startISO: string, weeks: number, perWeek: number): string[] {
  const startMs = parseISODate(startISO);
  const dates: string[] = [];
  for (let w = 0; w < weeks; w++) {
    const weekStart = startMs + w * 7 * DAY_MS;
    const candidates: { offset: number; rank: number }[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const dow = new Date(weekStart + offset * DAY_MS).getUTCDay();
      const rank = DOW_PREFERENCE.indexOf(dow);
      if (rank !== -1) candidates.push({ offset, rank }); // rank -1 ⇒ Shabbat, skipped
    }
    candidates.sort((a, b) => a.rank - b.rank);
    const chosen = candidates.slice(0, perWeek).sort((a, b) => a.offset - b.offset);
    for (const c of chosen) dates.push(toISODate(weekStart + c.offset * DAY_MS));
  }
  return dates;
}

/** The nearest UPCOMING holiday within the lookahead window from `dateISO`, if any. */
function holidayForSlot(dateISO: string): ILHoliday | null {
  const slotMs = parseISODate(dateISO);
  let best: ILHoliday | null = null;
  for (const h of IL_HOLIDAYS) {
    const hMs = parseISODate(h.date);
    const diff = hMs - slotMs; // holiday is AHEAD of the slot
    if (diff >= 0 && diff <= HOLIDAY_LOOKAHEAD_DAYS * DAY_MS) {
      if (!best || hMs < parseISODate(best.date)) best = h; // nearest upcoming wins
    }
  }
  return best;
}

// ── the planner ────────────────────────────────────────────────────────────────

export async function buildCalendarPlan({
  atoms,
  config,
  expander,
}: {
  atoms: ClientInsight[];
  config: PlanConfig;
  /** Defaults to the deterministic fallback until the LLM task wires a real one. */
  expander?: TopicExpander;
}): Promise<CalendarPlan> {
  // Clamp to the legal ranges rather than throwing — a slightly-off config from
  // a UI slider should degrade to a sane plan, not a 500. Cap at 6/week because
  // Shabbat leaves only 6 postable days.
  const weeks = Math.min(4, Math.max(2, Math.floor(config.weeks))) as PlanConfig['weeks'];
  const perWeek = Math.min(6, Math.max(1, Math.floor(config.postsPerWeek ?? 3)));
  const dates = scheduleDates(config.startDate, weeks, perWeek);

  // Only living, audience-facing knowledge seeds topics: active atoms from the
  // customers layer (seed kinds only) or the bridge layer.
  const usable: ExpanderAtom[] = atoms
    .filter(
      (a) =>
        a.status === 'active' &&
        (a.layer === 'bridge' || (a.layer === 'customers' && SEED_KINDS.has(a.kind))),
    )
    .map((a) => ({ id: a.id, kind: a.kind, content: a.content, confidence: a.confidence }));
  const kindById = new Map(usable.map((a) => [a.id, a.kind]));

  // ONE expander call for the whole plan (that is the LLM budget); any failure
  // or empty result degrades to the deterministic fallback — never throw.
  let topics: Awaited<ReturnType<TopicExpander>>['topics'];
  try {
    const out = await (expander ?? deterministicExpander)({ atoms: usable, slotCount: dates.length });
    topics = out.topics;
  } catch {
    topics = [];
  }
  if (topics.length === 0) {
    topics = (await deterministicExpander({ atoms: usable, slotCount: dates.length })).topics;
  }

  const slots: PlanSlot[] = dates.map((date, i) => {
    const t = topics[i % topics.length];
    const kind = t.atomIds.length > 0 ? kindById.get(t.atomIds[0]) ?? null : null;
    const kindHe = kind ? KIND_HE[kind] ?? kind : null;

    let post_type: PlanPostType = ROTATION[i % ROTATION.length];
    let topic = t.topic;
    let rationale = kindHe
      ? `מבוסס על תובנת ${kindHe} מהמודיעין של הלקוח; הזווית: ${t.angle}.`
      : `אין תובנות פעילות מתאימות — נושא כללי לשמירת נוכחות עקבית בעמוד.`;

    // Holiday conversion: an UPCOMING holiday inside the 14-day lookahead window trumps
    // the rotation — timely beats evergreen.
    const holiday = holidayForSlot(date);
    if (holiday) {
      post_type = 'holiday';
      topic = `${holiday.emoji} ${holiday.name} · ${t.topic}`;
      rationale = `${rationale} הוסב לפוסט הכנה לחג לקראת ${holiday.name} (${holiday.date}).`;
    }

    return { date, post_type, topic, angle: t.angle, grounded_in: [...t.atomIds], rationale };
  });

  // Plan-level grounding = dedup union of the slots' grounding, in first-use order.
  const grounded_in = [...new Set(slots.flatMap((s) => s.grounded_in))];
  const rationale =
    usable.length > 0
      ? `לוח תוכן אורגני ל-${weeks} שבועות (${slots.length} פוסטים, ${perWeek} בשבוע) שנבנה מ-${usable.length} תובנות פעילות משכבות הלקוחות/גשר, ברוטציית אמון של טיפ → סיפור → מעורבות → הצעה (הצעה לכל היותר 1 מתוך 4), ללא פרסום בשבת.`
      : `לוח תוכן אורגני ל-${weeks} שבועות (${slots.length} פוסטים, ${perWeek} בשבוע) עם נושאים כלליים — אין עדיין תובנות פעילות ללקוח, והנוכחות העקבית קודמת לשלמות.`;

  return { slots, grounded_in, rationale };
}
