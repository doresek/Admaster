// lib/organic-publish/types.ts
//
// P1-4 organic publishing worker — domain types + the persistence seam.
// One row of `public.organic_schedule` (migration 051) is the unit of work:
// the worker takes 'planned' slots whose content is attached (message NOT
// null), routes each through the autonomy gate ('publish_organic'), publishes
// via lib/meta-publish (DRY-RUN by default), and reflects the outcome back on
// the slot + its campaign item. Everything non-deterministic (DB, clock, Meta,
// autonomy audit) lives behind seams so unit tests run fully offline.

// ── the slot row (mirrors migration 051 exactly) ───────────────────────────────

export type OrganicPostKind = 'text' | 'photo' | 'link';

export type OrganicSlotStatus =
  | 'planned'      // calendar wrote it; content may or may not be attached yet
  | 'scheduled'    // publish intent recorded for a future time (Meta-native at live)
  | 'publishing'   // claimed by a worker — the idempotency latch
  | 'published'
  | 'failed'
  | 'cancelled';

/** One `public.organic_schedule` row. */
export interface OrganicSlot {
  id:               string;
  client_id:        string;
  owner_user_id:    string;
  campaign_id:      string | null;
  campaign_item_id: string | null;
  page_id:          string | null;
  post_kind:        OrganicPostKind;
  message:          string | null;   // null ⇒ P1-3 has not attached content yet
  image_url:        string | null;
  link_url:         string | null;
  scheduled_at:     string;          // ISO timestamptz
  published_at:     string | null;
  meta_post_id:     string | null;   // dryrun_* in dry-run
  status:           OrganicSlotStatus;
  grounded_in:      string[];        // client_insights atoms — the WHY-trail
  rationale:        string | null;
  created_at?:      string;
  updated_at?:      string;
}

/** The columns the worker is allowed to write back. */
export type OrganicSlotPatch = Partial<
  Pick<OrganicSlot, 'status' | 'meta_post_id' | 'published_at'>
>;

// ── persistence seam ───────────────────────────────────────────────────────────

/**
 * The slot store the worker runs against. Same graceful-degradation doctrine
 * as lib/campaigns/store: the supabase impl never throws (reads → [] / null,
 * claim → false, update → null, all logged), so a publish batch degrades
 * per-slot instead of crashing. Implementations live in store.ts.
 */
export interface SlotStore {
  /**
   * Due = status 'planned' AND scheduled_at <= dueBeforeIso, owner-scoped
   * (optionally client-scoped). 'publishing' rows are NEVER returned — the
   * claim latch is what makes a crashed/parallel worker unable to double-post.
   */
  listDue(params: {
    ownerUserId: string;
    clientId?: string;
    dueBeforeIso: string;
  }): Promise<OrganicSlot[]>;

  getSlot(id: string, ownerUserId: string): Promise<OrganicSlot | null>;

  /**
   * Atomically move 'planned' → 'publishing'. Returns false when the row is
   * no longer 'planned' (another worker claimed it, or it already moved on) —
   * the caller MUST NOT publish on false.
   */
  claimSlot(id: string): Promise<boolean>;

  /** Best-effort write-back; null on failure (the worker logs LOUDLY). */
  updateSlot(id: string, patch: OrganicSlotPatch): Promise<OrganicSlot | null>;
}

// ── worker result shapes ───────────────────────────────────────────────────────

export type SlotOutcome =
  | 'published'   // posted (dry-run: synthetic id) — slot 'published'
  | 'scheduled'   // future-dated intent recorded — slot 'scheduled'
  | 'proposed'    // autonomy verdict 'propose' — slot stays 'planned', owner approves
  | 'blocked'     // autonomy verdict 'block' — slot 'failed' with the reason
  | 'skipped'     // not actionable (no message / not 'planned' / claim lost)
  | 'failed';     // publish or precondition error — slot 'failed'

export interface SlotResult {
  slotId:      string;
  outcome:     SlotOutcome;
  metaPostId?: string | null;
  /** Human-readable WHY for every outcome — the audit surface of the batch. */
  reason:      string;
}

export interface PublishDueSlotsResult {
  /** True only when the gated live path actually ran (never from the API route yet). */
  live:    boolean;
  /** True whenever no live Meta write could have happened. */
  dryRun:  boolean;
  /** True when live was requested but the LIVE_PUBLISH_ENABLED gate refused. */
  refused: boolean;
  message: string;
  results: SlotResult[];
}
