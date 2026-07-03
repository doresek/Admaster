// lib/heartbeat — the MARKETING HEARTBEAT (VISION-DEEP §1.2): the per-client
// scheduled loop that turns the toolbox into a marketer. Public surface:
//
//   runHeartbeat(admin, {tick})   the cron entrypoint — fleet fan-out in
//                                 attention order, claim-lease idempotent
//   runDailyTick / runWeeklyTick / runMonthlyTick
//                                 the tick anatomies (composable, injectable)
//   the ledger                    claim/transition over heartbeat_runs (§6.2)
//
// Deliberately LLM-free orchestration: the composed libraries (attention,
// autonomy, experiments, hypotheses, digest, fleet, campaigns,
// strategy-objects) carry the intelligence.

export {
  type TickContext,
  type TickResult,
  type TickDeps,
  type ObservationsProvider,
  type CampaignRunner,
  type CampaignRunnerParams,
  type CampaignRunOutcome,
  NO_OBSERVATIONS,
  HeartbeatLedgerError,
} from './types';

export {
  HEARTBEAT_RUN_COLUMNS,
  DEFAULT_LEASE_MINUTES,
  claimTick,
  markRunning,
  markSucceeded,
  markFailed,
  markSkipped,
  periodStart,
  utcDayStart,
  isoWeekStart,
  utcMonthStart,
  type ClaimTickOptions,
} from './ledger';

export { runDailyTick } from './ticks/daily';
export {
  runWeeklyTick,
  registerMissingSelections,
  draftRegistrationInput,
  DEFAULT_DAILY_BUDGET_ILS,
  DEFAULT_UNIT_COSTS,
  WEEKLY_BLOCKING_STATUSES,
} from './ticks/weekly';
export { runMonthlyTick } from './ticks/monthly';
export { defaultCampaignRunner } from './ticks/run-campaign-adapter';

export {
  runHeartbeat,
  type HeartbeatSummary,
  type HeartbeatClientOutcome,
  type RunHeartbeatOptions,
  type SchedulerDeps,
} from './scheduler';
