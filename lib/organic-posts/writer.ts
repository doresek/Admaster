// lib/organic-posts/writer.ts
//
// SlotWriter implementations — same graceful-degradation doctrine as
// lib/campaigns/store.ts and lib/organic-calendar/record.ts: the supabase
// write is best-effort (logged false on any failure, never throws), the
// in-memory writer is deterministic for tests.
//
// IMPORTANT OWNERSHIP NOTE: attachment only sets campaign_item_id + message.
// `status` stays 'planned' and `post_kind` stays 'text' — the PUBLISH worker
// (P1-4) owns status transitions and kind upgrades; this module never touches
// them. `image_prompt` from the patch is NOT persisted here (no such column on
// organic_schedule) — it travels on the content artifact instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SlotAttachPatch, SlotWriter } from './types';

/** The real writer. Returns false (never throws) on any failure. */
export function supabaseSlotWriter(admin: SupabaseClient): SlotWriter {
  return {
    async attachToSlot(slotId, patch) {
      try {
        const { error } = await admin
          .from('organic_schedule')
          .update({
            campaign_item_id: patch.campaign_item_id,
            message: patch.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', slotId);
        if (error) throw new Error(error.message);
        return true;
      } catch (e: any) {
        console.error('[organic-posts.writer] attachToSlot failed:', e?.message ?? e);
        return false;
      }
    },
  };
}

/** Deterministic, dependency-free writer for unit tests / no-DB callers. */
export function inMemorySlotWriter(): SlotWriter & {
  attached: ({ slotId: string } & SlotAttachPatch)[];
} {
  const attached: ({ slotId: string } & SlotAttachPatch)[] = [];
  return {
    attached,
    async attachToSlot(slotId, patch) {
      attached.push({ slotId, ...patch });
      return true;
    },
  };
}
