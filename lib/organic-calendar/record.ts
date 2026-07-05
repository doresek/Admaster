// lib/organic-calendar/record.ts
//
// Records a CalendarPlan into the ONE decision trace: a campaigns row (channel
// meta_organic, dry_run) + one campaign_decisions row per slot + one
// organic_schedule row per slot. Persistence is BEST-EFFORT throughout —
// mirroring lib/campaigns/store.ts doctrine, a recording failure must never
// crash the planning flow; the caller still gets the plan back.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignStore } from '@/lib/campaigns/store';
import type { CalendarPlan, OrganicScheduleInsert, ScheduleStore } from './types';

// ── scheduled_at helper ────────────────────────────────────────────────────────

/**
 * Slot date at 10:00 Israel local time, as an ISO timestamp. HONESTY NOTE: the
 * Asia/Jerusalem UTC offset is APPROXIMATED by month (Apr–Oct ⇒ IDT +03:00,
 * otherwise IST +02:00). The real DST boundaries are the last weekends of
 * March/October, so a handful of edge days each year are off by one hour —
 * acceptable for a 10:00 organic post, and it keeps this module dependency-free
 * and deterministic. Replace with a tz-db lookup if minute-accuracy ever matters.
 */
function scheduledAtISO(dateISO: string): string {
  const month = Number(dateISO.slice(5, 7));
  const offset = month >= 4 && month <= 10 ? '+03:00' : '+02:00';
  return `${dateISO}T10:00:00${offset}`;
}

// ── schedule stores (same graceful-degradation doctrine as campaigns/store) ────

/**
 * The real organic_schedule store. Insert is best-effort: any failure (table
 * absent, RLS, env) is logged and yields null — NEVER throws.
 */
export function supabaseScheduleStore(admin: SupabaseClient): ScheduleStore {
  return {
    async insertSlot(row) {
      try {
        const { data, error } = await admin
          .from('organic_schedule')
          .insert(row)
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        return data as { id: string };
      } catch (e: any) {
        console.error('[organic-calendar.record] insertSlot failed:', e?.message ?? e);
        return null;
      }
    },
  };
}

let memSeq = 0;

/** Deterministic, dependency-free store for unit tests / no-DB callers. */
export function inMemoryScheduleStore(): ScheduleStore & {
  slots: (OrganicScheduleInsert & { id: string })[];
} {
  const slots: (OrganicScheduleInsert & { id: string })[] = [];
  return {
    slots,
    async insertSlot(row) {
      memSeq += 1;
      const slot = { id: `slot_${memSeq}`, ...row };
      slots.push(slot);
      return { id: slot.id };
    },
  };
}

// ── recording ──────────────────────────────────────────────────────────────────

export interface RecordCalendarPlanResult {
  plan: CalendarPlan;
  /** false ⇒ the campaign row could not be written; decisions/slots were skipped. */
  persisted: boolean;
  campaignId: string | null;
  decisionsInserted: number;
  slotsInserted: number;
}

export async function recordCalendarPlan({
  plan,
  clientId,
  ownerUserId,
  store,
  scheduleStore,
}: {
  plan: CalendarPlan;
  clientId: string;
  ownerUserId: string;
  store: Pick<CampaignStore, 'insertCampaign' | 'insertDecision'>;
  scheduleStore: ScheduleStore;
}): Promise<RecordCalendarPlanResult> {
  const startDate = plan.slots[0]?.date ?? '—';

  // The anchoring campaign row: dry_run + planned — nothing publishes from here;
  // this exists so the calendar shows up in the same auditable trace as paid.
  const campaign = await store.insertCampaign({
    client_id: clientId,
    owner_user_id: ownerUserId,
    name: `לוח תוכן אורגני · ${startDate} · ${plan.slots.length} פוסטים`,
    objective: 'engagement',
    channel: 'meta_organic',
    status: 'planned',
    daily_budget: null,
    funnel_stage: null,
    meta_campaign_id: null,
    dry_run: true,
    grounded_in: plan.grounded_in,
    rationale: plan.rationale,
  });

  if (!campaign) {
    // Campaign is the anchor of the whole trace — without it, decisions and
    // schedule rows would be orphans. Skip them and report gracefully.
    return { plan, persisted: false, campaignId: null, decisionsInserted: 0, slotsInserted: 0 };
  }

  let decisionsInserted = 0;
  let slotsInserted = 0;

  for (const slot of plan.slots) {
    // One auditable decision per slot choice…
    const decision = await store.insertDecision({
      campaign_id: campaign.id,
      client_id: clientId,
      owner_user_id: ownerUserId,
      decision_type: 'calendar_slot',
      decision: {
        date: slot.date,
        post_type: slot.post_type,
        topic: slot.topic,
        angle: slot.angle,
      },
      grounded_in: slot.grounded_in,
      rationale: slot.rationale,
    });
    if (decision) decisionsInserted += 1;

    // …and one schedule row the (later) content/publish tasks will fill in.
    const inserted = await scheduleStore.insertSlot({
      client_id: clientId,
      owner_user_id: ownerUserId,
      campaign_id: campaign.id,
      campaign_item_id: null,
      page_id: null,
      post_kind: 'text',
      message: null,
      image_url: null,
      link_url: null,
      scheduled_at: scheduledAtISO(slot.date),
      status: 'planned',
      grounded_in: slot.grounded_in,
      rationale: slot.rationale,
    });
    if (inserted) slotsInserted += 1;
  }

  return { plan, persisted: true, campaignId: campaign.id, decisionsInserted, slotsInserted };
}
