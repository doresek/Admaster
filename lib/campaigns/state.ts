// lib/campaigns/state.ts
//
// The campaign state machine. PURE: `canTransition(from, to)` answers whether a
// status change is legal; `assertTransition` throws on an illegal move; the
// helpers below describe the graph for callers/tests.
//
// The happy path the runner walks (dry-run):
//   draft → planned → generating → assembled
// the (gated) live publish path continues:
//   assembled → scheduled → publishing → live → (paused) → completed
// any step may go → failed.

import type { CampaignStatus } from './types';

/** Every status, in lifecycle order. */
export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'draft',
  'planned',
  'generating',
  'assembled',
  'scheduled',
  'publishing',
  'live',
  'paused',
  'completed',
  'failed',
] as const;

/**
 * Legal next-states for each status. A campaign can always move to `failed`
 * (an error at any step); terminal states (`completed`, `failed`) go nowhere.
 * `paused` ⇄ `live` so the owner can pause and resume an active campaign.
 */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft:      ['planned', 'failed'],
  planned:    ['generating', 'failed'],
  generating: ['assembled', 'failed'],
  assembled:  ['scheduled', 'publishing', 'failed'],
  scheduled:  ['publishing', 'failed'],
  publishing: ['live', 'failed'],
  live:       ['paused', 'completed', 'failed'],
  paused:     ['live', 'completed', 'failed'],
  completed:  [],
  failed:     [],
};

/** Pure predicate: is moving `from → to` allowed? Same-state is a no-op (true). */
export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** The legal next-states from a status (excludes the same-state no-op). */
export function nextStates(from: CampaignStatus): readonly CampaignStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Terminal statuses cannot transition anywhere else. */
export function isTerminal(status: CampaignStatus): boolean {
  return (TRANSITIONS[status] ?? []).length === 0;
}

/** Guard: throw if `from → to` is illegal; otherwise return `to`. */
export function assertTransition(from: CampaignStatus, to: CampaignStatus): CampaignStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal campaign transition: ${from} → ${to}`);
  }
  return to;
}

/**
 * The ordered dry-run assembly path. The runner advances a campaign through
 * these (validating each hop) and stops at `assembled` — it never schedules,
 * publishes, or goes live (that path is gated by the money/H4 gates).
 */
export const DRY_RUN_PATH: readonly CampaignStatus[] = [
  'draft',
  'planned',
  'generating',
  'assembled',
] as const;
