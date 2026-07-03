// lib/autonomy/policy.ts
//
// The PURE routing policy of the autonomy modes (VISION-DEEP §1.4; D1
// DECIDED) — the single gate every system action routes through. Zero I/O:
// routeAction and assessModeSuggestion are total functions over their inputs
// (any input produces a verdict, never a throw), so the safety core is
// exhaustively testable as a table and can never crash the caller into an
// un-routed action.
//
// The 3 USER-SELECTABLE modes (the owner picks; the system NEVER self-promotes):
//   draft_only                — system prepares, user does everything;
//                               every action routes 'propose' (even pause)
//   propose_approve (DEFAULT) — executes organic + builds paid PAUSED; owner
//                               approves every money move (one tap); protective
//                               pause executes
//   act_within_caps           — unpause/pause/reallocate/send execute within
//                               the user-set daily+monthly spend caps and the
//                               per-change delta cap; over-cap → propose
//
// Two rules sit above the mode table:
//   • PROTECTIVE BYPASS — 'pause_paid' executes in propose_approve and
//     act_within_caps, past caps AND past the rate limit. A pause can only
//     stop money, never start it. In draft_only even pause proposes — that
//     mode grants no execution authority at all.
//   • RATE LIMIT — at ≥ MAX_ACTIONS_PER_DAY auto-executions today, everything
//     except protective pause is blocked (runaway-loop protection, §6.5), in
//     every mode.

import type { AutonomyAction, AutonomyMode, AutonomyRoute, ClientAutonomyRow } from '@/lib/capability-contracts';
import type { ModeSuggestionAssessment, RouteContext } from './types';

// ── Exported policy constants ─────────────────────────────────────────────────
//
// The cap defaults are CONSERVATIVE BY DESIGN: they bound what an
// act_within_caps client with an empty caps object can lose to a bug or a bad
// judgment in one day / one month. Owners raise them explicitly; the system
// never does. (R2 in the vision's risk table: one runaway campaign at a
// design partner ends the relationship — defaults must make that impossible,
// not merely unlikely.)

/** Default per-day spend bound (ILS) when caps.daily_spend_cap is absent. */
export const DEFAULT_DAILY_SPEND_CAP_ILS = 100;

/** Default per-month spend bound (ILS) when caps.monthly_spend_cap is absent. */
export const DEFAULT_MONTHLY_SPEND_CAP_ILS = 2000;

/** Default per-change budget-delta bound (%) when caps.max_daily_delta_pct is absent. */
export const DEFAULT_MAX_DAILY_DELTA_PCT = 25;

/**
 * Hard ceiling on auto-executed actions per client per day (§6.5). A healthy
 * heartbeat takes a handful of actions per tick; twenty in one day means a
 * loop, not a marketer — quarantine everything except the kill-switch.
 */
export const MAX_ACTIONS_PER_DAY = 20;

// ── Mode-suggestion thresholds (exported so the UI can show progress) ─────────

/** Minimum days in the current mode before a switch is suggested. */
export const SUGGESTION_MIN_DAYS = 14;

/** Minimum decided approvals before the approval rate means anything. */
export const SUGGESTION_MIN_APPROVALS = 10;

/** Minimum approval rate — 90% of proposals approved is the trust bar. */
export const SUGGESTION_MIN_APPROVAL_RATE = 0.9;

// ── Runtime guards (the DB CHECKs enforce these too; the policy re-checks so
//    it stays total even over garbage that never touched the DB) ──────────────

const MODES: readonly AutonomyMode[] = ['draft_only', 'propose_approve', 'act_within_caps'];
const MODE_SET: ReadonlySet<string> = new Set(MODES);

const ACTION_KINDS: readonly AutonomyAction['kind'][] = [
  'publish_organic', 'create_paid_paused', 'unpause_paid', 'pause_paid',
  'reallocate_budget', 'send_message', 'propose_only',
];
const KIND_SET: ReadonlySet<string> = new Set(ACTION_KINDS);

/**
 * Why an action is malformed, or null when it is well-formed. Malformed input
 * is BLOCKED before any other rule — including the protective bypass: a pause
 * that cannot say why (or carries NaN impact) is far more likely a bug than a
 * rescue, and the loud 'action_blocked' audit event is itself the alert. The
 * real kill-switch (the anomaly monitor) always supplies a rationale.
 */
function malformedReason(action: AutonomyAction): string | null {
  if (typeof action !== 'object' || action === null) {
    return 'malformed action: not an object';
  }
  if (typeof action.kind !== 'string' || !KIND_SET.has(action.kind)) {
    return `malformed action: unknown kind ${JSON.stringify(action.kind)}`;
  }
  if (typeof action.rationale !== 'string' || action.rationale.trim() === '') {
    return 'malformed action: missing rationale — an action that cannot say why does not act';
  }
  if (!Array.isArray(action.grounded_in)) {
    return 'malformed action: grounded_in must be an array (the WHY-trail is not optional)';
  }
  const spend = action.impact?.spend_ils;
  if (spend !== undefined && (typeof spend !== 'number' || !Number.isFinite(spend) || spend < 0)) {
    return `malformed action: impact.spend_ils must be a finite non-negative number (got ${String(spend)})`;
  }
  const delta = action.impact?.delta_pct;
  if (delta !== undefined && (typeof delta !== 'number' || !Number.isFinite(delta) || delta < 0)) {
    return `malformed action: impact.delta_pct must be a finite non-negative number (got ${String(delta)})`;
  }
  return null;
}

/** A cap value is usable when it is a finite number ≥ 0 (0 = owner-set freeze). */
function capOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Route one action through the mode policy. Total: every input maps to
 * exactly one of execute / propose / block, never a throw.
 *
 * The policy table, cell by cell (WHY per cell):
 *
 *   0. MALFORMED (any mode) → block. Never execute garbage; see
 *      malformedReason for why this outranks even the protective bypass.
 *
 *   1. PROTECTIVE BYPASS: 'pause_paid' in propose_approve / act_within_caps →
 *      execute, bypassing caps AND the rate limit. The kill-switch is never
 *      gated: caps bound money going OUT, and a pause only stops it; a
 *      runaway loop of pauses converges to the safe state (everything paused,
 *      zero spend), so rate-limiting it can only delay a rescue, never
 *      prevent damage. In draft_only even pause is a proposal — draft_only
 *      grants no execution authority at all, and a client parked there has
 *      nothing running that the system started.
 *
 *   2. RATE LIMIT (every mode): todayActionCount ≥ MAX_ACTIONS_PER_DAY →
 *      block, with the numbers in the reason. Runaway-loop protection (§6.5):
 *      past the ceiling the system is quarantined — even proposals stop
 *      (a looping system spams the owner's digest into uselessness) — and
 *      only the protective pause (rule 1, checked first) still acts. An
 *      UNKNOWN count (non-finite) also blocks: we never act blind on the one
 *      counter that detects a runaway.
 *
 *   3. 'propose_only' → propose. It asks and nothing else, by definition, in
 *      every mode — there is nothing to execute.
 *
 *   4. draft_only → propose, for everything. The system prepares, the user
 *      does everything — it may only ask.
 *
 *   5. 'publish_organic' + 'create_paid_paused' in propose_approve /
 *      act_within_caps → execute. No money moves: organic posts spend
 *      nothing, and a paid campaign created PAUSED is fully reversible
 *      shelf-work (PAUSED-by-default is the floor the whole vision stands
 *      on). This is exactly what propose_approve grants — "executes organic;
 *      paid fully built, PAUSED" — and act_within_caps includes it.
 *
 *   6. Money kinds (unpause/reallocate/send) in propose_approve → propose.
 *      The owner taps every action that moves money — that tap IS the trust
 *      metric the mode suggestion is computed from.
 *
 *   7. Money kinds in act_within_caps → execute IFF within ALL caps:
 *        spend ≤ remaining daily cap  (dailyCap − todaySpendIls)
 *        AND spend ≤ remaining monthly cap (monthlyCap − monthSpendIls)
 *        AND delta_pct ≤ max_daily_delta_pct
 *      Boundary semantics: exactly AT the cap executes; one agora over
 *      proposes. Over ANY cap → propose (never block — an over-cap action is
 *      a legitimate idea that merely exceeds delegated trust) with the exact
 *      cap and number in the reason, because the owner reads WHY. Missing
 *      caps use the conservative defaults above. Unknown (non-finite) spend
 *      context → propose: caps we cannot verify are caps exceeded. The delta
 *      cap is thrash protection — a stability property of budget moves, not
 *      a trust question — so no mode configuration disables it.
 */
export function routeAction(action: AutonomyAction, ctx: RouteContext): AutonomyRoute {
  // 0. Malformed → block (outranks everything; see malformedReason).
  const malformed = malformedReason(action);
  if (malformed) return { route: 'block', reason: malformed };

  // Unknown mode (garbage row / future enum drift) → treat as draft_only, the
  // most conservative reading: when we cannot tell how much trust the owner
  // granted, assume none.
  const mode: AutonomyMode =
    typeof ctx.mode === 'string' && MODE_SET.has(ctx.mode) ? ctx.mode : 'draft_only';

  // 1. Protective bypass — before the rate limit, deliberately.
  if (action.kind === 'pause_paid' && mode !== 'draft_only') {
    return {
      route:  'execute',
      reason: `protective: pause_paid is the kill-switch — executes in ${mode}, bypassing caps and the rate limit (a pause can only stop spend, never start it)`,
    };
  }

  // 2. Rate limit (unknown count = assume the worst and refuse to act blind).
  if (typeof ctx.todayActionCount !== 'number' || !Number.isFinite(ctx.todayActionCount)) {
    return { route: 'block', reason: "rate limit: today's action count is unavailable — refusing to act blind (runaway-loop protection, §6.5)" };
  }
  if (ctx.todayActionCount >= MAX_ACTIONS_PER_DAY) {
    return {
      route:  'block',
      reason: `rate limit: ${ctx.todayActionCount} actions auto-executed today ≥ ${MAX_ACTIONS_PER_DAY}/day — runaway-loop protection (§6.5); only protective pause may still act`,
    };
  }

  // 3. propose_only asks by definition.
  if (action.kind === 'propose_only') {
    return { route: 'propose', reason: 'propose_only: this action only asks, in every mode' };
  }

  // 4. draft_only: the system prepares, the user does everything.
  if (mode === 'draft_only') {
    return { route: 'propose', reason: `draft_only: ${action.kind} may only be proposed — the system publishes nothing in this mode` };
  }

  // 5. No-money kinds execute in propose_approve and act_within_caps.
  if (action.kind === 'publish_organic' || action.kind === 'create_paid_paused') {
    return {
      route:  'execute',
      reason: `${mode}: ${action.kind} moves no money (organic is free; PAUSED creation is reversible shelf-work) — executes`,
    };
  }

  // From here on: a money kind (unpause_paid / reallocate_budget / send_message).

  // 6. propose_approve: every money move is a one-tap approval.
  if (mode === 'propose_approve') {
    return { route: 'propose', reason: `propose_approve: ${action.kind} moves money — queued for owner approval` };
  }

  // 7. act_within_caps: the cap checks (daily + monthly + delta, all three).
  const caps       = ctx.caps ?? {};
  const dailyCap   = capOrDefault(caps.daily_spend_cap,    DEFAULT_DAILY_SPEND_CAP_ILS);
  const monthlyCap = capOrDefault(caps.monthly_spend_cap,  DEFAULT_MONTHLY_SPEND_CAP_ILS);
  const maxDelta   = capOrDefault(caps.max_daily_delta_pct, DEFAULT_MAX_DAILY_DELTA_PCT);
  const spend      = action.impact?.spend_ils ?? 0;   // validated finite ≥ 0 above
  const delta      = action.impact?.delta_pct ?? 0;   // validated finite ≥ 0 above

  // Delta cap — thrash protection outlives trust.
  if (delta > maxDelta) {
    return {
      route:  'propose',
      reason: `over delta cap: ${delta}% > max ${maxDelta}%/day per change — proposing instead (thrash protection is not a trust question)`,
    };
  }

  if (spend > 0) {
    // Unknown spend context → caps we cannot verify are caps exceeded.
    const todaySpend = typeof ctx.todaySpendIls === 'number' && Number.isFinite(ctx.todaySpendIls)
      ? Math.max(0, ctx.todaySpendIls) : null;
    const monthSpend = typeof ctx.monthSpendIls === 'number' && Number.isFinite(ctx.monthSpendIls)
      ? Math.max(0, ctx.monthSpendIls) : null;
    if (todaySpend === null || monthSpend === null) {
      return { route: 'propose', reason: `spend context unavailable — cannot verify caps for ${spend} ILS, proposing instead` };
    }

    const remainingDaily = Math.max(0, dailyCap - todaySpend);
    if (spend > remainingDaily) {
      return {
        route:  'propose',
        reason: `over daily cap: spend ${spend} ILS > remaining ${remainingDaily} ILS of daily cap ${dailyCap} ILS (${todaySpend} ILS already moved today) — proposing instead`,
      };
    }

    const remainingMonthly = Math.max(0, monthlyCap - monthSpend);
    if (spend > remainingMonthly) {
      return {
        route:  'propose',
        reason: `over monthly cap: spend ${spend} ILS > remaining ${remainingMonthly} ILS of monthly cap ${monthlyCap} ILS (${monthSpend} ILS already moved this month) — proposing instead`,
      };
    }
  }

  return {
    route:  'execute',
    reason: `act_within_caps: ${action.kind} spend ${spend} ILS, delta ${delta}% ≤ ${maxDelta}% — within caps, executing, owner notified after`,
  };
}

/** The next rung of trust; act_within_caps has none. */
const NEXT_MODE: Partial<Record<AutonomyMode, AutonomyMode>> = {
  draft_only:      'propose_approve',
  propose_approve: 'act_within_caps',
};

/**
 * Assess whether the client's track record justifies SUGGESTING the next mode
 * (§1.4: "המערכת פעלה 3 שבועות עם 92% אישורים — לשדרג?"). A suggestion is all
 * it ever is: the OWNER changes the mode (via setMode / the API); no code
 * path promotes automatically — that is D1's core rule. Pure — the caller
 * supplies `now` so the assessment is reproducible and testable.
 *
 * Eligible when ALL hold:
 *   • the mode has a next rung (act_within_caps never suggests anything),
 *   • ≥ SUGGESTION_MIN_DAYS full days in the current mode,
 *   • ≥ SUGGESTION_MIN_APPROVALS decided proposals (rate needs a sample), and
 *   • approval rate ≥ SUGGESTION_MIN_APPROVAL_RATE.
 *
 * The suggestion's reason string carries the actual numbers — trust is earned
 * and VISIBLE, so the owner always sees the evidence, never just a verdict.
 * Total: unparsable mode_since / garbage counters → not eligible (we never
 * suggest more autonomy on data we cannot read).
 */
export function assessModeSuggestion(row: ClientAutonomyRow, now: Date): ModeSuggestionAssessment {
  const next = NEXT_MODE[row.mode];
  if (!next) return { eligible: false };   // act_within_caps (or unknown mode) — nothing above

  const sinceMs = Date.parse(row.mode_since);
  if (!Number.isFinite(sinceMs)) return { eligible: false };
  const days = Math.floor((now.getTime() - sinceMs) / 86_400_000);

  const total    = Number.isFinite(row.approvals_total)    ? row.approvals_total    : 0;
  const approved = Number.isFinite(row.approvals_approved) ? row.approvals_approved : 0;
  const rate     = total > 0 ? approved / total : 0;

  if (days < SUGGESTION_MIN_DAYS)          return { eligible: false };
  if (total < SUGGESTION_MIN_APPROVALS)    return { eligible: false };
  if (rate < SUGGESTION_MIN_APPROVAL_RATE) return { eligible: false };

  const pct = Math.round(rate * 100);
  return {
    eligible: true,
    suggestion: {
      to_mode: next,
      reason:  `${days} ימים ב-${row.mode}, ${pct}% אישורים (${approved}/${total}) — להציע מעבר ל-${next}?`,
    },
  };
}
