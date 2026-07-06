// lib/organic-posts/types.ts
//
// P1-3 organic post generator — domain types + the ONE new seam this module
// introduces: `SlotWriter`, which attaches a generated post back onto its
// `organic_schedule` slot row. Everything else is composed from existing
// contracts (master-studio pipeline, brand-lint, campaigns store, intelligence
// artifacts) — imported, never edited.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanSlot } from '@/lib/organic-calendar/types';
import type { StageRunner } from '@/lib/master-studio/pipeline';
import type { CampaignStore } from '@/lib/campaigns/store';
import type { LintResult } from '@/lib/brand-lint';
import type { ClientInsight } from '@/lib/intelligence/types';

// ── slot attachment seam ───────────────────────────────────────────────────────

/**
 * What a generated post contributes back to its schedule slot. `image_prompt`
 * is part of the seam contract (in-memory/test writers keep it observable) but
 * the supabase impl does NOT persist it on organic_schedule — the prompt lives
 * on the content artifact; the slot row only carries the final `message`.
 */
export interface SlotAttachPatch {
  campaign_item_id: string;
  message: string;
  image_prompt: string;
}

/**
 * Persistence seam for attaching a generated post to its organic_schedule row.
 * Same graceful-degradation doctrine as CampaignStore / ScheduleStore: the
 * write is best-effort (false on failure, never throw). Status/post_kind are
 * intentionally NOT touched — the PUBLISH worker (P1-4) owns status
 * transitions; the slot stays 'planned' / 'text' after attachment.
 */
export interface SlotWriter {
  attachToSlot(slotId: string, patch: SlotAttachPatch): Promise<boolean>;
}

// ── generate inputs / outputs ──────────────────────────────────────────────────

export interface GenerateOrganicPostParams {
  slot: PlanSlot;
  /** organic_schedule row id to attach the result to. null/absent ⇒ skip attach. */
  slotId?: string | null;
  clientId: string;
  ownerUserId: string;
  /** The anchoring campaigns row (the calendar's campaign, from P1-2 recording). */
  campaignId: string;
  /** Injected LLM seam — callers provide the Anthropic-backed runner. */
  run: StageRunner;
  store: Pick<CampaignStore, 'insertItem'>;
  slotWriter: SlotWriter;
  /** Admin client for artifact recording. Absent ⇒ artifact skipped (null). */
  admin?: SupabaseClient | null;
  /** Client insight atoms (kind 'brand_voice') to lint the winning post against. */
  brandAtoms?: readonly ClientInsight[];
}

export type OrganicPostResult =
  | {
      ok: true;
      /** The winning, edited Facebook post text (Hebrew). */
      post: string;
      /** The image GENERATION PROMPT (never empty — pipeline guarantees it). */
      imagePrompt: string;
      hashtags: string[];
      /** C-07 verdict — advisory only, NEVER blocks (flag-only doctrine). */
      lint: LintResult;
      /** campaign_items id; null when the (best-effort) insert failed. */
      itemId: string | null;
      /** content_artifacts id; null when no admin / insert failed (best-effort). */
      artifactId: string | null;
      /** true when the schedule slot was updated with the item + message. */
      attached: boolean;
    }
  | { ok: false; reason: string };

/** A plan slot paired with its organic_schedule row id (from P1-2 recording). */
export interface PlanSlotRef {
  slot: PlanSlot;
  slotId?: string | null;
}

export interface GenerateForPlanParams
  extends Omit<GenerateOrganicPostParams, 'slot' | 'slotId'> {
  slots: readonly PlanSlotRef[];
}

export interface GenerateForPlanResult {
  results: { slot: PlanSlot; result: OrganicPostResult }[];
  generated: number;
  failed: number;
}
