// lib/campaigns/store.ts
//
// Persistence seam for the campaign domain. The runner records rows through a
// `CampaignStore` so it is fully mockable in tests and DEGRADES GRACEFULLY when
// the 030 tables are not yet applied to the database (inserts return null + log,
// never throw — a dry-run assembly must not fail just because recording failed).
//
//   • supabaseCampaignStore(admin)  — the real, owner-scoped store (service client)
//   • inMemoryCampaignStore()       — a deterministic store for tests
//
// Reads are owner-scoped (and RLS-backed under a user client); the service
// client used by the runner bypasses RLS, so we ALSO filter by owner_user_id
// explicitly, matching the convention in lib/clients.ts / lib/intelligence.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Campaign,
  CampaignDecision,
  CampaignDecisionInsert,
  CampaignInsert,
  CampaignItem,
  CampaignItemInsert,
} from './types';

const CAMPAIGN_COLUMNS =
  'id, client_id, owner_user_id, name, objective, channel, status, daily_budget, ' +
  'funnel_stage, meta_campaign_id, dry_run, grounded_in, rationale, created_at, updated_at';

const ITEM_COLUMNS =
  'id, campaign_id, client_id, owner_user_id, artifact_id, item_type, status, ' +
  'meta_object_id, targeting_spec, ab_parent_id, grounded_in, rationale, created_at, updated_at';

const DECISION_COLUMNS =
  'id, campaign_id, client_id, owner_user_id, decision_type, decision, grounded_in, rationale, created_at';

export interface CampaignStore {
  insertCampaign(row: CampaignInsert): Promise<Campaign | null>;
  insertItem(row: CampaignItemInsert): Promise<CampaignItem | null>;
  insertDecision(row: CampaignDecisionInsert): Promise<CampaignDecision | null>;
  updateCampaignStatus(id: string, status: Campaign['status']): Promise<Campaign | null>;
  /**
   * OPTIONAL (T9 live publish): update a single item's status. Optional so
   * partial/inline stores still satisfy the interface; callers use `?.()`.
   */
  updateItemStatus?(id: string, status: CampaignItem['status']): Promise<CampaignItem | null>;
  /**
   * OPTIONAL (T9 live publish): flip a campaign's publish state (status +
   * dry_run + real meta_campaign_id) in one write when it goes live. Optional
   * for the same reason as updateItemStatus.
   */
  updateCampaignPublishState?(
    id: string,
    patch: { status?: Campaign['status']; dry_run?: boolean; meta_campaign_id?: string | null },
  ): Promise<Campaign | null>;
  listCampaigns(ownerUserId: string, clientId?: string): Promise<Campaign[]>;
  getCampaign(id: string, ownerUserId: string): Promise<Campaign | null>;
  listItems(campaignId: string, ownerUserId: string): Promise<CampaignItem[]>;
  listDecisions(campaignId: string, ownerUserId: string): Promise<CampaignDecision[]>;
}

// ── Supabase-backed store ──────────────────────────────────────────────────────

/**
 * The real store. Inserts are BEST-EFFORT: any failure (table absent, RLS, env)
 * is logged and yields null so a dry-run assembly never crashes on recording.
 * Reads return [] / null on error for the same reason.
 */
export function supabaseCampaignStore(admin: SupabaseClient): CampaignStore {
  return {
    async insertCampaign(row) {
      try {
        const { data, error } = await admin
          .from('campaigns')
          .insert(row)
          .select(CAMPAIGN_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as Campaign;
      } catch (e: any) {
        console.error('[campaigns.store] insertCampaign failed:', e?.message ?? e);
        return null;
      }
    },

    async insertItem(row) {
      try {
        const { data, error } = await admin
          .from('campaign_items')
          .insert(row)
          .select(ITEM_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as CampaignItem;
      } catch (e: any) {
        console.error('[campaigns.store] insertItem failed:', e?.message ?? e);
        return null;
      }
    },

    async insertDecision(row) {
      try {
        const { data, error } = await admin
          .from('campaign_decisions')
          .insert(row)
          .select(DECISION_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as CampaignDecision;
      } catch (e: any) {
        console.error('[campaigns.store] insertDecision failed:', e?.message ?? e);
        return null;
      }
    },

    async updateCampaignStatus(id, status) {
      try {
        const { data, error } = await admin
          .from('campaigns')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select(CAMPAIGN_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as Campaign;
      } catch (e: any) {
        console.error('[campaigns.store] updateCampaignStatus failed:', e?.message ?? e);
        return null;
      }
    },

    async updateItemStatus(id, status) {
      try {
        const { data, error } = await admin
          .from('campaign_items')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select(ITEM_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as CampaignItem;
      } catch (e: any) {
        console.error('[campaigns.store] updateItemStatus failed:', e?.message ?? e);
        return null;
      }
    },

    async updateCampaignPublishState(id, patch) {
      try {
        const { data, error } = await admin
          .from('campaigns')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select(CAMPAIGN_COLUMNS)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as Campaign;
      } catch (e: any) {
        console.error('[campaigns.store] updateCampaignPublishState failed:', e?.message ?? e);
        return null;
      }
    },

    async listCampaigns(ownerUserId, clientId) {
      try {
        let q = admin
          .from('campaigns')
          .select(CAMPAIGN_COLUMNS)
          .eq('owner_user_id', ownerUserId);
        if (clientId) q = q.eq('client_id', clientId);
        const { data, error } = await q.order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data as unknown as Campaign[]) ?? [];
      } catch (e: any) {
        console.error('[campaigns.store] listCampaigns failed:', e?.message ?? e);
        return [];
      }
    },

    async getCampaign(id, ownerUserId) {
      try {
        const { data, error } = await admin
          .from('campaigns')
          .select(CAMPAIGN_COLUMNS)
          .eq('id', id)
          .eq('owner_user_id', ownerUserId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as unknown as Campaign) ?? null;
      } catch (e: any) {
        console.error('[campaigns.store] getCampaign failed:', e?.message ?? e);
        return null;
      }
    },

    async listItems(campaignId, ownerUserId) {
      try {
        const { data, error } = await admin
          .from('campaign_items')
          .select(ITEM_COLUMNS)
          .eq('campaign_id', campaignId)
          .eq('owner_user_id', ownerUserId)
          .order('created_at', { ascending: true });
        if (error) throw new Error(error.message);
        return (data as unknown as CampaignItem[]) ?? [];
      } catch (e: any) {
        console.error('[campaigns.store] listItems failed:', e?.message ?? e);
        return [];
      }
    },

    async listDecisions(campaignId, ownerUserId) {
      try {
        const { data, error } = await admin
          .from('campaign_decisions')
          .select(DECISION_COLUMNS)
          .eq('campaign_id', campaignId)
          .eq('owner_user_id', ownerUserId)
          .order('created_at', { ascending: true });
        if (error) throw new Error(error.message);
        return (data as unknown as CampaignDecision[]) ?? [];
      } catch (e: any) {
        console.error('[campaigns.store] listDecisions failed:', e?.message ?? e);
        return [];
      }
    },
  };
}

// ── In-memory store (tests / no-DB) ──────────────────────────────────────────

let memSeq = 0;
function memId(prefix: string): string {
  memSeq += 1;
  return `${prefix}_${memSeq}`;
}

/**
 * A deterministic, dependency-free store for unit tests and for any caller that
 * wants to exercise the runner without a database. Mirrors the supabase store's
 * owner-scoping behaviour.
 */
export function inMemoryCampaignStore(): CampaignStore & {
  campaigns: Campaign[];
  items: CampaignItem[];
  decisions: CampaignDecision[];
} {
  const campaigns: Campaign[] = [];
  const items: CampaignItem[] = [];
  const decisions: CampaignDecision[] = [];
  const nowIso = () => new Date().toISOString();

  return {
    campaigns,
    items,
    decisions,

    async insertCampaign(row) {
      const c: Campaign = { id: memId('campaign'), ...row, created_at: nowIso(), updated_at: nowIso() };
      campaigns.push(c);
      return c;
    },
    async insertItem(row) {
      const it: CampaignItem = {
        id: memId('item'),
        ab_parent_id: row.ab_parent_id ?? null,
        ...row,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      items.push(it);
      return it;
    },
    async insertDecision(row) {
      const d: CampaignDecision = { id: memId('decision'), ...row, created_at: nowIso() };
      decisions.push(d);
      return d;
    },
    async updateCampaignStatus(id, status) {
      const c = campaigns.find((x) => x.id === id);
      if (!c) return null;
      c.status = status;
      c.updated_at = nowIso();
      return c;
    },
    async updateItemStatus(id, status) {
      const it = items.find((x) => x.id === id);
      if (!it) return null;
      it.status = status;
      it.updated_at = nowIso();
      return it;
    },
    async updateCampaignPublishState(id, patch) {
      const c = campaigns.find((x) => x.id === id);
      if (!c) return null;
      if (patch.status !== undefined) c.status = patch.status;
      if (patch.dry_run !== undefined) c.dry_run = patch.dry_run;
      if (patch.meta_campaign_id !== undefined) c.meta_campaign_id = patch.meta_campaign_id;
      c.updated_at = nowIso();
      return c;
    },
    async listCampaigns(ownerUserId, clientId) {
      return campaigns.filter(
        (c) => c.owner_user_id === ownerUserId && (!clientId || c.client_id === clientId),
      );
    },
    async getCampaign(id, ownerUserId) {
      return campaigns.find((c) => c.id === id && c.owner_user_id === ownerUserId) ?? null;
    },
    async listItems(campaignId, ownerUserId) {
      return items.filter((i) => i.campaign_id === campaignId && i.owner_user_id === ownerUserId);
    },
    async listDecisions(campaignId, ownerUserId) {
      return decisions.filter((d) => d.campaign_id === campaignId && d.owner_user_id === ownerUserId);
    },
  };
}
