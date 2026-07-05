// tests/organic-calendar/record.test.ts
//
// P1-2 recording: one campaigns row + one calendar_slot decision per slot +
// one organic_schedule row per slot — and graceful degradation when the
// campaign anchor cannot be written. In-memory stores only, fixed dates.

import { describe, expect, it } from 'vitest';
import { inMemoryCampaignStore } from '@/lib/campaigns/store';
import { buildCalendarPlan } from '@/lib/organic-calendar/plan';
import { inMemoryScheduleStore, recordCalendarPlan } from '@/lib/organic-calendar/record';
import type { ClientInsight } from '@/lib/intelligence/types';

function makeAtom(id: string): ClientInsight {
  return {
    id,
    client_id: 'client_1',
    owner_user_id: 'user_1',
    layer: 'customers',
    kind: 'desire',
    content: `הלקוחות רוצים לראות תוצאות מהר (${id})`,
    structured: null,
    source: 'brief',
    source_ref: null,
    confidence: 0.75,
    evidence_count: 1,
    status: 'active',
    superseded_by: null,
    superseded_reason: null,
    first_seen_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

async function fixturePlan() {
  return buildCalendarPlan({
    atoms: [makeAtom('atom_a'), makeAtom('atom_b')],
    config: { weeks: 2, postsPerWeek: 3, startDate: '2026-07-05' },
  });
}

describe('recordCalendarPlan', () => {
  it('writes 1 campaign + N decisions + N schedule slots with correct grounding', async () => {
    const plan = await fixturePlan();
    const store = inMemoryCampaignStore();
    const scheduleStore = inMemoryScheduleStore();

    const result = await recordCalendarPlan({
      plan,
      clientId: 'client_1',
      ownerUserId: 'user_1',
      store,
      scheduleStore,
    });

    // ONE anchoring campaign, organic + dry-run + planned.
    expect(result.persisted).toBe(true);
    expect(store.campaigns).toHaveLength(1);
    const campaign = store.campaigns[0];
    expect(result.campaignId).toBe(campaign.id);
    expect(campaign).toMatchObject({
      client_id: 'client_1',
      owner_user_id: 'user_1',
      channel: 'meta_organic',
      status: 'planned',
      objective: 'engagement',
      dry_run: true,
      daily_budget: null,
      funnel_stage: null,
      meta_campaign_id: null,
    });
    expect(campaign.name).toBe(`לוח תוכן אורגני · 2026-07-05 · ${plan.slots.length} פוסטים`);
    expect(campaign.grounded_in).toEqual(plan.grounded_in);
    expect(campaign.rationale).toBe(plan.rationale);

    // One calendar_slot decision per slot, grounded like its slot.
    expect(result.decisionsInserted).toBe(plan.slots.length);
    expect(store.decisions).toHaveLength(plan.slots.length);
    store.decisions.forEach((d, i) => {
      const slot = plan.slots[i];
      expect(d.campaign_id).toBe(campaign.id);
      expect(d.decision_type).toBe('calendar_slot');
      expect(d.decision).toEqual({
        date: slot.date,
        post_type: slot.post_type,
        topic: slot.topic,
        angle: slot.angle,
      });
      expect(d.grounded_in).toEqual(slot.grounded_in);
      expect(d.rationale).toBe(slot.rationale);
    });

    // One planned organic_schedule row per slot, at 10:00 Israel time.
    expect(result.slotsInserted).toBe(plan.slots.length);
    expect(scheduleStore.slots).toHaveLength(plan.slots.length);
    scheduleStore.slots.forEach((row, i) => {
      const slot = plan.slots[i];
      expect(row).toMatchObject({
        client_id: 'client_1',
        owner_user_id: 'user_1',
        campaign_id: campaign.id,
        campaign_item_id: null,
        post_kind: 'text',
        status: 'planned',
        message: null,
      });
      expect(row.scheduled_at).toBe(`${slot.date}T10:00:00+03:00`); // July = IDT
      expect(row.grounded_in).toEqual(slot.grounded_in);
      expect(row.rationale).toBe(slot.rationale);
    });
  });

  it('campaign insert failure ⇒ persisted:false and zero decisions/slots (graceful, no throw)', async () => {
    const plan = await fixturePlan();
    const scheduleStore = inMemoryScheduleStore();
    // A store whose campaign insert fails the way the supabase store fails: null.
    const failingStore = {
      insertCampaign: async () => null,
      insertDecision: async () => {
        throw new Error('must not be called when the campaign anchor failed');
      },
    };

    const result = await recordCalendarPlan({
      plan,
      clientId: 'client_1',
      ownerUserId: 'user_1',
      store: failingStore,
      scheduleStore,
    });

    expect(result).toMatchObject({
      persisted: false,
      campaignId: null,
      decisionsInserted: 0,
      slotsInserted: 0,
    });
    expect(result.plan).toBe(plan); // caller still gets the plan back
    expect(scheduleStore.slots).toHaveLength(0);
  });
});
