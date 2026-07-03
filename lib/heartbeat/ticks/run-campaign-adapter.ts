// lib/heartbeat/ticks/run-campaign-adapter.ts
//
// The default CampaignRunner: the real lib/campaigns runCampaign behind the
// narrow CampaignRunner seam. Kept in its own file so the tick modules stay
// import-light for tests (tests inject their own runner and never load the
// master-studio / Anthropic stack).
//
// Everything the vision demands of a heartbeat-created campaign is enforced
// INSIDE runCampaign, not re-implemented here: dry-run always, PAUSED by
// default, the decision pre-registered as a falsifiable hypothesis (C-01),
// episodic precedents recorded (C-02). The creative generation inside
// master-studio does use an LLM — that is the composed library carrying the
// intelligence; the heartbeat's own orchestration stays deterministic.

import type { SupabaseClient } from '@supabase/supabase-js';
import { masterStudioGenerator, runCampaign } from '@/lib/campaigns';
import type { CampaignRunner } from '../types';

/**
 * Build the production runner over the admin client. Lazy by call — the
 * Anthropic client behind masterStudioGenerator is only constructed when the
 * weekly tick actually executes a creation, so daily/monthly ticks (and
 * weekly ticks that propose instead) never touch the LLM stack or its env.
 */
export function defaultCampaignRunner(admin: SupabaseClient): CampaignRunner {
  return async ({ clientId, ownerUserId, channel }) => {
    const result = await runCampaign(
      { clientId, ownerUserId, channel },
      { generate: masterStudioGenerator({ supabase: admin, userId: ownerUserId }) },
    );
    return {
      campaignId: result.campaign.id,
      status:     result.campaign.status,
      dryRun:     result.dryRun,
      notes:      result.notes,
    };
  };
}
