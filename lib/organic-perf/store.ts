// lib/organic-perf/store.ts
//
// Seam implementations:
//   • supabasePublishedSlotSource(admin) — published organic_schedule rows.
//   • supabasePerfStore(admin)           — content_performance writes/reads.
//   • inMemoryPerfStore(seed)            — deterministic store for unit tests.
//
// Doctrine (same as lib/organic-publish/store + lib/campaigns/store): NEVER
// throw. Reads degrade to []/false, writes to false — the ingester decides how
// loud to be. The service client bypasses RLS, so every query ALSO filters
// owner_user_id explicitly, matching the repo convention.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrganicSlot } from '@/lib/organic-publish/types';
import type { ItemLookup, OrganicPerfRow, PerfStore, SlotSource } from './types';

const SLOT_COLUMNS =
  'id, client_id, owner_user_id, campaign_id, campaign_item_id, page_id, post_kind, ' +
  'message, image_url, link_url, scheduled_at, published_at, meta_post_id, status, ' +
  'grounded_in, rationale, created_at, updated_at';

const PERF_COLUMNS =
  'id, artifact_id, campaign_item_id, client_id, owner_user_id, source, ad_id, ' +
  'metrics, period_start, period_end, verdict, created_at';

// ── slot source ────────────────────────────────────────────────────────────────

export function supabasePublishedSlotSource(admin: SupabaseClient): SlotSource {
  return {
    async listPublished({ ownerUserId, clientId }) {
      try {
        const { data, error } = await admin
          .from('organic_schedule')
          .select(SLOT_COLUMNS)
          .eq('owner_user_id', ownerUserId)
          .eq('client_id', clientId)
          .eq('status', 'published')
          .not('meta_post_id', 'is', null)
          .order('published_at', { ascending: true });
        if (error) throw new Error(error.message);
        return (data as unknown as OrganicSlot[]) ?? [];
      } catch (e: any) {
        console.error('[organic-perf.store] listPublished failed:', e?.message ?? e);
        return [];
      }
    },
  };
}

// ── perf store (content_performance) ──────────────────────────────────────────

export function supabasePerfStore(admin: SupabaseClient): PerfStore {
  return {
    async existsForDay({ ownerUserId, campaignItemId, adId, day }) {
      try {
        let q = admin
          .from('content_performance')
          .select('id')
          .eq('owner_user_id', ownerUserId)
          .eq('period_start', day)
          .limit(1);
        // Dedupe key: campaign_item_id when present, else the meta post id.
        if (campaignItemId) q = q.eq('campaign_item_id', campaignItemId);
        else if (adId) q = q.eq('ad_id', adId);
        else return false; // nothing to key on — let the insert proceed
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return ((data as { id: string }[] | null) ?? []).length > 0;
      } catch (e: any) {
        console.error('[organic-perf.store] existsForDay failed:', e?.message ?? e);
        return false; // unknown ⇒ attempt insert; mig-033 uniq index backstops meta rows
      }
    },

    async insert(row) {
      try {
        const { error } = await admin.from('content_performance').insert(row as any);
        if (error) throw new Error(error.message);
        return true;
      } catch (e: any) {
        console.error('[organic-perf.store] insert failed:', e?.message ?? e);
        return false;
      }
    },

    async listRecent({ ownerUserId, clientId, limit = 20 }) {
      try {
        // Organic scope, kept simple: rows tied to the client's 'post' items,
        // plus manual rows (which may carry no campaign_item linkage at all).
        const { data: items, error: itemsErr } = await admin
          .from('campaign_items')
          .select('id')
          .eq('owner_user_id', ownerUserId)
          .eq('client_id', clientId)
          .eq('item_type', 'post');
        if (itemsErr) throw new Error(itemsErr.message);
        const postItemIds = ((items as { id: string }[] | null) ?? []).map((r) => r.id);

        let q = admin
          .from('content_performance')
          .select(PERF_COLUMNS)
          .eq('owner_user_id', ownerUserId)
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(limit);
        q = postItemIds.length > 0
          ? q.or(`campaign_item_id.in.(${postItemIds.join(',')}),source.eq.manual`)
          : q.eq('source', 'manual');
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data as unknown as Array<OrganicPerfRow & { id?: string; created_at?: string }>) ?? [];
      } catch (e: any) {
        console.error('[organic-perf.store] listRecent failed:', e?.message ?? e);
        return [];
      }
    },
  };
}

/** campaign_item id → artifact_id, one batched query. */
export function supabaseItemLookup(admin: SupabaseClient): ItemLookup {
  return async (campaignItemIds) => {
    const map = new Map<string, string | null>();
    if (campaignItemIds.length === 0) return map;
    try {
      const { data, error } = await admin
        .from('campaign_items')
        .select('id, artifact_id')
        .in('id', campaignItemIds);
      if (error) throw new Error(error.message);
      for (const r of (data as Array<{ id: string; artifact_id: string | null }> | null) ?? []) {
        map.set(r.id, r.artifact_id ?? null);
      }
    } catch (e: any) {
      console.error('[organic-perf.store] itemLookup failed:', e?.message ?? e);
    }
    return map; // best-effort: missing linkage ⇒ artifact_id null, row still lands
  };
}

// ── in-memory perf store (tests / no-DB) ──────────────────────────────────────

/**
 * Deterministic, dependency-free PerfStore over an array. Mirrors the supabase
 * store's dedupe semantics exactly. `rows` is exposed for assertions.
 */
export function inMemoryPerfStore(
  seed: OrganicPerfRow[] = [],
): PerfStore & { rows: OrganicPerfRow[] } {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,

    async existsForDay({ ownerUserId, campaignItemId, adId, day }) {
      return rows.some((r) => {
        if (r.owner_user_id !== ownerUserId || r.period_start !== day) return false;
        if (campaignItemId) return r.campaign_item_id === campaignItemId;
        if (adId) return r.ad_id === adId;
        return false;
      });
    },

    async insert(row) {
      rows.push({ ...row });
      return true;
    },

    async listRecent({ ownerUserId, clientId, limit = 20 }) {
      return rows
        .filter((r) => r.owner_user_id === ownerUserId && r.client_id === clientId)
        .slice(-limit)
        .reverse();
    },
  };
}
