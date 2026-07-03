// lib/heartbeat/ticks/weekly.ts
//
// The WEEKLY tick — "the Monday morning plan" (VISION-DEEP §1.2): read the
// living understanding, plan the experiment slate at the client's real
// budget, register what the slate selected, create AT MOST ONE new (dry-run,
// PAUSED) campaign, and compose the weekly digest — which IS the approval
// surface (§1.3: the one-tap loop lives there).
//
// ONE-CAMPAIGN-PER-WEEK DISCIPLINE: an SMB budget (₪50–100/day, vision risk
// R4) cannot parallelize campaign creation weekly — two simultaneous new
// campaigns split a sample that is already statistically tiny, so neither
// test resolves. The slate may select several tests; the tick launches the
// TOP one and queues the rest as notes for next week. planSlate already
// enforces the same physics inside the explore budget; this rule enforces it
// across weeks.
//
// DETERMINISTIC, LLM-free: the "plan" is planSlate's information-per-shekel
// arithmetic over registered candidates + the digest's templated narration of
// recorded rows. The frontier-model weekly planning pass (§6.3) layers on
// later without changing this skeleton.

import type { HeartbeatAction } from '@/lib/capability-contracts';
import { routeAndLog } from '@/lib/autonomy';
import { getClient } from '@/lib/clients';
import { composeAndSave, type ApprovalRequest } from '@/lib/digest';
import {
  loadOpenCandidates,
  planSlate,
  type HypothesisCandidate,
  type SlateSelection,
  type UnitCosts,
} from '@/lib/experiments';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  registerHypothesisChecked,
  DEFAULT_DECISION_CONFIDENCE,
  SUPPORTED_WEIGHT,
  REFUTED_WEIGHT,
  type RegisterHypothesisInput,
} from '@/lib/hypotheses';
import type { HeartbeatRunRow } from '@/lib/capability-contracts';
import { isoWeekStart } from '../ledger';
import { defaultCampaignRunner } from './run-campaign-adapter';
import type { TickContext, TickDeps, TickResult } from '../types';

/** No spend ledger yet → the tick has moved ₪0 (see daily.ts money doctrine). */
const ZERO_SPEND = { todaySpendIls: 0, monthSpendIls: 0 } as const;

/**
 * Conservative daily budget (ILS) when the client declares none.
 * `clients.monthly_budget` is ABSENT on prod (SECURITY-AUDIT L1) so today this
 * default applies to everyone — the tick still notes the assumption on every
 * run so the gap stays visible until the column lands.
 */
export const DEFAULT_DAILY_BUDGET_ILS = 50;

/**
 * PLANNING ASSUMPTIONS for the Israeli SMB Meta market — expected unit costs
 * used ONLY to project spend → sample for slate resolvability math. These are
 * assumptions, not measurements; when the metrics pipe lands they are
 * replaced by per-client baselines (ExpectedRateProvenance 'client_baseline').
 */
export const DEFAULT_UNIT_COSTS: UnitCosts = {
  expected_cpm:                  40,
  expected_cpc:                  4,
  expected_cpa:                  80,
  expected_cost_per_marked_lead: 150,
};

/**
 * Campaign states that block a new creation regardless of age: work already
 * on the shelf or in flight. 'paused' does NOT block — a PAUSED campaign
 * awaiting the owner's unpause is the propose_approve steady state, and
 * refusing to plan around it would deadlock the weekly loop.
 */
export const WEEKLY_BLOCKING_STATUSES: readonly string[] = [
  'assembled', 'scheduled', 'publishing', 'live',
];

const fmtDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Extract monthly_budget if the clients row carries one (absent on prod — see DEFAULT_DAILY_BUDGET_ILS). */
function monthlyBudgetOf(client: unknown): number | null {
  if (typeof client !== 'object' || client === null || !('monthly_budget' in client)) return null;
  const v: unknown = client.monthly_budget;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Build the frozen registration for a slate candidate that reached selection
 * WITHOUT a registered hypothesis (a draft from a future candidate source —
 * loadOpenCandidates only emits registered ones today). The prediction is the
 * canonical minimal A/B claim: "the variant beats control on the floor
 * grade" (ratio 1.0, DEFAULT_DECISION_CONFIDENCE) — honest and falsifiable
 * without inventing effect sizes the planner does not know.
 */
export function draftRegistrationInput(
  candidate:   HypothesisCandidate,
  clientId:    string,
  ownerUserId: string,
): RegisterHypothesisInput {
  const lowerIsBetter = candidate.floor_spec.metric_grade === 'cpa';
  return {
    clientId,
    ownerUserId,
    insightIds: candidate.insight_ids,
    claim:      candidate.claim,
    prediction: {
      metric:       candidate.floor_spec.metric_grade,
      comparator:   lowerIsBetter ? 'ratio_lte' : 'ratio_gte',
      value:        1.0,
      arm:          'variant',
      baseline_arm: 'control',
      confidence:   DEFAULT_DECISION_CONFIDENCE,
    },
    floorSpec: candidate.floor_spec,
    horizon:   candidate.horizon,
    verdictMap: {
      supported:    candidate.insight_ids.map((id) => ({ insight_id: id, polarity: 'positive' as const, weight: SUPPORTED_WEIGHT })),
      refuted:      candidate.insight_ids.map((id) => ({ insight_id: id, polarity: 'negative' as const, weight: REFUTED_WEIGHT })),
      inconclusive: [],
    },
    killRules: {},
    testRefs:  [{ arm_label: 'variant' }, { arm_label: 'control' }],
    domain:    candidate.domain,
  };
}

/**
 * Register every selected test that lacks a frozen registration (C-01: no
 * unregistered tests run). Priors from the "already tried" memory surface as
 * notes — repeating a settled question must be a visible choice, never an
 * accident.
 */
export async function registerMissingSelections(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  selected:    readonly SlateSelection[],
  notes:       string[],
): Promise<void> {
  for (const sel of selected) {
    if (sel.candidate.hypothesis) continue; // already in the ledger — the normal path
    const result = await registerHypothesisChecked(
      supabase,
      draftRegistrationInput(sel.candidate, clientId, ownerUserId),
    );
    if (!result.ok) {
      notes.push(
        `slate candidate '${sel.candidate.id}' could not be registered: ` +
        result.reasons.map((r) => `${r.code}: ${r.message}`).join('; '),
      );
      continue;
    }
    notes.push(`registered hypothesis ${result.hypothesis.id} for slate candidate '${sel.candidate.id}'`);
    for (const w of result.warnings) notes.push(`prior: ${w}`);
  }
}

/** True when a campaign already blocks this week's creation (see WEEKLY_BLOCKING_STATUSES). */
async function campaignBlocksThisWeek(
  supabase:     SupabaseClient,
  clientId:     string,
  ownerUserId:  string,
  weekStartIso: string,
  notes:        string[],
): Promise<boolean> {
  const { data: active, error: activeErr } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .in('status', [...WEEKLY_BLOCKING_STATUSES])
    .limit(1);
  if (activeErr) throw new Error(`weekly.campaignCheck(active): ${activeErr.message}`);
  if ((active ?? []).length > 0) {
    const row: unknown = (active ?? [])[0];
    const status = typeof row === 'object' && row !== null && 'status' in row ? String(row.status) : '?';
    notes.push(`one-per-week discipline: a campaign is already ${status} — no new creation this week`);
    return true;
  }

  const { data: thisWeek, error: weekErr } = await supabase
    .from('campaigns')
    .select('id')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .gte('created_at', weekStartIso)
    .limit(1);
  if (weekErr) throw new Error(`weekly.campaignCheck(week): ${weekErr.message}`);
  if ((thisWeek ?? []).length > 0) {
    notes.push('one-per-week discipline: a campaign was already created this ISO week — no new creation');
    return true;
  }
  return false;
}

/**
 * Unresolved 'propose' actions from this ISO week's succeeded DAILY runs —
 * the digest is the approval surface, so anything the watchdog proposed
 * during the week must reach the owner Monday. "Unresolved" today means
 * "proposed this week": the approvals ledger that would mark them decided is
 * the one-tap surface itself (C2-gated) — until it lands we re-surface
 * everything, which errs on the side of asking.
 */
async function weekDailyProposals(
  supabase:     SupabaseClient,
  clientId:     string,
  ownerUserId:  string,
  weekStartIso: string,
): Promise<ApprovalRequest[]> {
  const { data, error } = await supabase
    .from('heartbeat_runs')
    .select('actions')
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .eq('tick_type', 'daily')
    .eq('status', 'succeeded')
    .gte('created_at', weekStartIso)
    .overrideTypes<Array<Pick<HeartbeatRunRow, 'actions'>>, { merge: false }>();
  if (error) throw new Error(`weekly.dailyProposals: ${error.message}`);

  const approvals: ApprovalRequest[] = [];
  for (const run of data ?? []) {
    for (const action of run.actions) {
      if (action.route !== 'propose') continue;
      approvals.push({ kind: action.kind, rationale: action.rationale, ref: action.ref ?? '' });
    }
  }
  return approvals;
}

/**
 * The Monday morning plan:
 *   1. loadOpenCandidates → planSlate at the client's daily budget
 *      (monthly_budget/30 when declared; DEFAULT_DAILY_BUDGET_ILS otherwise,
 *      noted).
 *   2. selected tests lacking a registration → registerHypothesisChecked
 *      (priors surfaced as notes).
 *   3. AT MOST ONE new campaign (top slate pick), routed through autonomy as
 *      'create_paid_paused' — no money moves (creation is PAUSED-reversible
 *      shelf-work) so it EXECUTES at propose_approve+ and proposes in
 *      draft_only. Execution goes through deps.campaignRunner (dry-run;
 *      runCampaign enforces PAUSED + pre-registers its own hypothesis +
 *      records precedents).
 *   4. composeAndSave the WEEKLY digest with approvalsNeeded = this run's
 *      'propose' actions + the week's unresolved daily proposals.
 */
export async function runWeeklyTick(ctx: TickContext, deps: TickDeps): Promise<TickResult> {
  const now = deps.now ?? new Date();
  const notes: string[] = [...ctx.notes];
  const actions: HeartbeatAction[] = [];

  const weekStart = isoWeekStart(now);
  const weekStartIso = weekStart.toISOString();

  // 0) the client must still exist (deleted mid-fanout is a normal race).
  const client = await getClient(deps.supabase, ctx.clientId, ctx.ownerUserId);
  if (!client) {
    return { actions, notes, skipped: `client ${ctx.clientId} not found for owner — nothing to plan` };
  }

  // 1) plan the slate at the client's information capacity.
  const monthly = monthlyBudgetOf(client);
  const dailyBudgetIls = monthly !== null
    ? Math.round((monthly / 30) * 100) / 100
    : DEFAULT_DAILY_BUDGET_ILS;
  if (monthly === null) {
    notes.push(`no declared monthly budget — planning at the conservative default ₪${DEFAULT_DAILY_BUDGET_ILS}/day`);
  }

  const { candidates, insights } = await loadOpenCandidates(deps.supabase, ctx.clientId, ctx.ownerUserId);
  const slate = planSlate({ candidates, insights, dailyBudgetIls, unitCosts: DEFAULT_UNIT_COSTS });
  notes.push(`slate: ${slate.selected.length} selected, ${slate.deferred.length} deferred — ${slate.capacity_note}`);
  for (const d of slate.deferred) notes.push(`deferred '${d.candidate.id}': ${d.reason}`);

  // 2) freeze registrations for anything selected but unregistered.
  await registerMissingSelections(deps.supabase, ctx.clientId, ctx.ownerUserId, slate.selected, notes);

  // 3) at most ONE new campaign this week.
  if (slate.selected.length > 0) {
    const blocked = await campaignBlocksThisWeek(deps.supabase, ctx.clientId, ctx.ownerUserId, weekStartIso, notes);
    if (!blocked) {
      const top = slate.selected[0];
      const rationale =
        `weekly slate top pick: "${top.candidate.claim}" ` +
        `(info-value ${top.score.info_value}, ₪${top.daily_budget}/day of the explore budget)`;

      const routed = await routeAndLog(deps.supabase, {
        clientId:    ctx.clientId,
        ownerUserId: ctx.ownerUserId,
        action: {
          kind:        'create_paid_paused',
          ref:         top.candidate.id,
          rationale,
          grounded_in: top.candidate.insight_ids,
        },
        spendContext: ZERO_SPEND,
      });
      actions.push({ kind: 'create_paid_paused', ref: top.candidate.id, rationale, route: routed.route.route });
      notes.push(`create_paid_paused routed '${routed.route.route}' (${routed.route.reason})`);

      if (routed.route.route === 'execute') {
        const runner = deps.campaignRunner ?? defaultCampaignRunner(deps.supabase);
        try {
          const outcome = await runner({ clientId: ctx.clientId, ownerUserId: ctx.ownerUserId, channel: 'meta_paid' });
          notes.push(
            `campaign ${outcome.campaignId} created (status ${outcome.status}, dryRun=${String(outcome.dryRun)})` +
            (outcome.notes.length > 0 ? `; runner notes: ${outcome.notes.join(' | ')}` : ''),
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          notes.push(`campaign creation FAILED after routing 'execute': ${message} — nothing was created; will retry next week`);
        }
      }
    }

    if (slate.selected.length > 1) {
      const queued = slate.selected.slice(1).map((s) => `'${s.candidate.claim}'`).join(', ');
      notes.push(
        `one-per-week discipline: ${slate.selected.length - 1} further selected test(s) queued for next week — ${queued} ` +
        `(an SMB budget cannot parallelize weekly campaign creation; splitting the sample resolves nothing)`,
      );
    }
  }

  // 4) the weekly digest — THE approval surface.
  const approvalsNeeded: ApprovalRequest[] = [
    ...actions
      .filter((a) => a.route === 'propose')
      .map((a) => ({ kind: a.kind, rationale: a.rationale, ref: a.ref ?? '' })),
    ...(await weekDailyProposals(deps.supabase, ctx.clientId, ctx.ownerUserId, weekStartIso)),
  ];

  const digest = await composeAndSave(deps.supabase, {
    clientId:    ctx.clientId,
    ownerUserId: ctx.ownerUserId,
    kind:        'weekly',
    periodStart: fmtDay(weekStart),
    periodEnd:   fmtDay(new Date(weekStart.getTime() + 6 * 86_400_000)),
    approvalsNeeded,
  });
  if (digest.ok) {
    notes.push(`weekly digest ${digest.digest.id} composed (${approvalsNeeded.length} approvals pending)`);
    for (const w of digest.warnings) notes.push(`digest warning: ${w}`);
  } else {
    notes.push(`weekly digest not recomposed: period digest already ${digest.status} (immutable)`);
  }

  return { actions, notes };
}
