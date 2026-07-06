// lib/heartbeat/types.ts
//
// The MARKETING HEARTBEAT (VISION-DEEP §1.2) — module-internal vocabulary.
//
// The heartbeat is THE tool→marketer transformation: a per-client scheduled
// loop that shows up uninvited (J2), watches daily (J4), plans weekly and
// reviews monthly. This MVP is DELIBERATELY DETERMINISTIC orchestration —
// zero LLM calls in the heartbeat itself: the composed libraries (attention,
// autonomy, experiments, hypotheses, digest, fleet, campaigns,
// strategy-objects) carry the intelligence, and every "creative" byte the
// heartbeat surfaces is a read from a recorded row. An LLM planning pass
// (§6.3's model tiering: small model daily, frontier weekly) is a LATER
// enhancement layered on top of these same tick functions.
//
// Row/contract shapes (HeartbeatTick/Status/Action/RunRow, AutonomyMode/…)
// live in lib/capability-contracts (orchestrator-owned, never edited here).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HeartbeatAction,
  HeartbeatTick,
  ShockState,
} from '@/lib/capability-contracts';
import type { ArmObservation } from '@/lib/hypotheses';

export type {
  HeartbeatAction,
  HeartbeatRunRow,
  HeartbeatStatus,
  HeartbeatTick,
  ShockState,
} from '@/lib/capability-contracts';

// ── tick context / result ─────────────────────────────────────────────────────

/**
 * Everything a tick function knows about the run it is executing. The
 * scheduler builds one per claimed run; `shock` is the fleet-wide C-04 state
 * for yesterday's cpm (computed ONCE per daily heartbeat, never per client —
 * see scheduler.ts) so ticks can reframe verdicts as "שוק, לא אתה".
 * `notes` are scheduler-seeded observations the tick must carry into its
 * result (nothing said about a run may be dropped on the floor).
 */
export interface TickContext {
  clientId:    string;
  ownerUserId: string;
  tick:        HeartbeatTick;
  /** The heartbeat_runs row this execution is recorded under. */
  runId:       string;
  shock:       ShockState | null;
  notes:       string[];
}

/**
 * What one tick did. `actions` is the WHY-trail: every entry carries its
 * autonomy route ('execute' actually happened; 'propose' awaits the owner's
 * one-tap in the digest; 'block' was refused with the reason). `skipped` is
 * set when the tick decided there was nothing to do at all (e.g. the client
 * row vanished mid-run) — the reason is persisted, never inferred.
 */
export interface TickResult {
  actions:  HeartbeatAction[];
  notes:    string[];
  skipped?: string;
}

// ── injectable seams ──────────────────────────────────────────────────────────

/**
 * The metrics seam (§1.2 "ingest performance (T10)"). There is NO live
 * metrics pipe in this MVP: the default provider returns null for every
 * hypothesis, and the daily tick notes "no metrics pipe — progress unknown"
 * instead of inventing observations (creative-testing-discipline: nothing
 * observed ≠ enough observed). When T10 lands, a real provider closes over
 * ingested per-arm counts and the whole verdict/kill machinery lights up
 * with ZERO changes to the ticks.
 */
export interface ObservationsProvider {
  /** Per-arm observations for one hypothesis, or null when unknowable. */
  forHypothesis(hypothesisId: string): ArmObservation[] | null;
}

/** The default: no live pipe — progress is unknown, and we say so. */
export const NO_OBSERVATIONS: ObservationsProvider = {
  forHypothesis: () => null,
};

/**
 * What the weekly tick needs back from a campaign creation — a deliberate
 * NARROW projection of RunCampaignResult, so tests inject a runner without
 * stubbing the entire decision-engine output. The real default adapter wraps
 * lib/campaigns runCampaign (dry-run, PAUSED-by-default, pre-registers its
 * own hypothesis, records precedents — all enforced THERE, not re-checked
 * here).
 */
export interface CampaignRunOutcome {
  campaignId: string;
  status:     string;
  dryRun:     boolean;
  notes:      string[];
}

export interface CampaignRunnerParams {
  clientId:    string;
  ownerUserId: string;
  /** The weekly tick only creates paid (PAUSED) campaigns; organic cadence is a later tick concern. */
  channel:     'meta_paid';
}

export type CampaignRunner = (params: CampaignRunnerParams) => Promise<CampaignRunOutcome>;

/**
 * The dependency seam every tick function takes. `supabase` is the ADMIN
 * client (heartbeats run server-side with no cookie session; every composed
 * store still scopes explicitly by owner_user_id per the lib/intelligence
 * doctrine). `now` makes every tick deterministic — no logic path reads
 * Date.now directly.
 */
export interface TickDeps {
  supabase:        SupabaseClient;
  observations?:   ObservationsProvider;
  now?:            Date;
  campaignRunner?: CampaignRunner;
  /**
   * Platform-claimed conversions per channel for a period — the reconciliation
   * input (MEASUREMENT-SPINE-PLAN §6.5). Live numbers arrive at the H4 flip;
   * absent (the default) → the monthly tick SKIPS reconciliation with an
   * honest note instead of writing zero-claim noise rows. Returning null from
   * the provider means "no data for this client/period" (also a skip).
   */
  platformClaims?: (clientId: string, period: { start: string; end: string }) =>
    Promise<Partial<Record<string, number>> | null>;
}

// ── typed errors ──────────────────────────────────────────────────────────────

/**
 * Every ledger persistence failure — carries the operation so the scheduler's
 * per-client failure notes say WHAT broke (claim vs transition vs read), not
 * just that something did.
 */
export class HeartbeatLedgerError extends Error {
  constructor(readonly op: string, detail: string) {
    super(`${op}: ${detail}`);
    this.name = 'HeartbeatLedgerError';
  }
}
