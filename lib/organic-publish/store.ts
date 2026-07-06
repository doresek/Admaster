// lib/organic-publish/store.ts
//
// SlotStore implementations (see types.ts for the contract):
//   • supabaseSlotStore(admin) — the real, owner-scoped store (service client).
//   • inMemorySlotStore(seed)  — deterministic store for unit tests / no-DB.
//
// Doctrine (same as lib/campaigns/store): NEVER throw. Reads degrade to []/null,
// the claim degrades to false (= do not publish), updates degrade to null — the
// worker decides how loud to be. The service client bypasses RLS, so every read
// ALSO filters owner_user_id explicitly, matching the repo convention.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrganicSlot, OrganicSlotPatch, SlotStore } from './types';

const SLOT_COLUMNS =
  'id, client_id, owner_user_id, campaign_id, campaign_item_id, page_id, post_kind, ' +
  'message, image_url, link_url, scheduled_at, published_at, meta_post_id, status, ' +
  'grounded_in, rationale, created_at, updated_at';

export function supabaseSlotStore(admin: SupabaseClient): SlotStore {
  return {
    async listDue({ ownerUserId, clientId, dueBeforeIso }) {
      try {
        let q = admin
          .from('organic_schedule')
          .select(SLOT_COLUMNS)
          .eq('owner_user_id', ownerUserId)
          .eq('status', 'planned')            // 'publishing' rows are claimed — never re-picked
          .lte('scheduled_at', dueBeforeIso);
        if (clientId) q = q.eq('client_id', clientId);
        const { data, error } = await q.order('scheduled_at', { ascending: true });
        if (error) throw new Error(error.message);
        return (data as unknown as OrganicSlot[]) ?? [];
      } catch (e: any) {
        console.error('[organic-publish.store] listDue failed:', e?.message ?? e);
        return [];
      }
    },

    async getSlot(id, ownerUserId) {
      try {
        const { data, error } = await admin
          .from('organic_schedule')
          .select(SLOT_COLUMNS)
          .eq('id', id)
          .eq('owner_user_id', ownerUserId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as unknown as OrganicSlot) ?? null;
      } catch (e: any) {
        console.error('[organic-publish.store] getSlot failed:', e?.message ?? e);
        return null;
      }
    },

    async claimSlot(id) {
      // The idempotency latch: a conditional UPDATE that only fires while the
      // row is still 'planned'. Zero rows updated ⇒ someone else holds it (or
      // it already advanced) ⇒ the caller must not publish.
      try {
        const { data, error } = await admin
          .from('organic_schedule')
          .update({ status: 'publishing', updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'planned')
          .select('id');
        if (error) throw new Error(error.message);
        return ((data as { id: string }[] | null) ?? []).length > 0;
      } catch (e: any) {
        console.error('[organic-publish.store] claimSlot failed:', e?.message ?? e);
        return false; // unknown claim state = do not publish
      }
    },

    async updateSlot(id, patch) {
      try {
        const { data, error } = await admin
          .from('organic_schedule')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select(SLOT_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as OrganicSlot;
      } catch (e: any) {
        console.error('[organic-publish.store] updateSlot failed:', e?.message ?? e);
        return null;
      }
    },
  };
}

// ── in-memory store (tests / no-DB) ───────────────────────────────────────────

/**
 * Deterministic, dependency-free SlotStore over a seeded array. Mirrors the
 * supabase store's semantics exactly (owner scoping, planned-only listDue,
 * conditional claim). `slots` is exposed for assertions.
 */
export function inMemorySlotStore(seed: OrganicSlot[] = []): SlotStore & { slots: OrganicSlot[] } {
  const slots = seed.map((s) => ({ ...s }));
  return {
    slots,

    async listDue({ ownerUserId, clientId, dueBeforeIso }) {
      const due = Date.parse(dueBeforeIso);
      return slots
        .filter(
          (s) =>
            s.owner_user_id === ownerUserId &&
            (!clientId || s.client_id === clientId) &&
            s.status === 'planned' &&
            Date.parse(s.scheduled_at) <= due,
        )
        .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    },

    async getSlot(id, ownerUserId) {
      return slots.find((s) => s.id === id && s.owner_user_id === ownerUserId) ?? null;
    },

    async claimSlot(id) {
      const s = slots.find((x) => x.id === id);
      if (!s || s.status !== 'planned') return false;
      s.status = 'publishing';
      return true;
    },

    async updateSlot(id, patch) {
      const s = slots.find((x) => x.id === id);
      if (!s) return null;
      Object.assign(s, patch);
      return s;
    },
  };
}
