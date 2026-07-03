// lib/autonomy/policy.ts
//
// The PURE routing policy of the autonomy ladder (VISION-DEEP §1.4) — the
// single gate every system action routes through. Zero I/O: routeAction and
// assessGraduation are total functions over their inputs (any input produces a
// verdict, never a throw), so the safety core is exhaustively testable as a
// table and can never crash the caller into an un-routed action.
//
// The ladder (§1.4):
//   L0 Draft            — generates + plans; publishes nothing
//   L1 Propose (DEFAULT) — executes organic + builds paid PAUSED; owner
//                          approves every unpause (one tap from the digest)
//   L2 Act-within-caps   — unpauses/pauses/reallocates within daily+monthly
//                          caps and per-change delta limits; notifies after
//   L3 Autonomous        — full portfolio control within the monthly budget
//
// Two rules sit above the ladder:
//   • PROTECTIVE BYPASS — 'pause_paid' executes at every level L1+, past caps
//     AND past the rate limit. A pause can only stop money, never start it.
//   • RATE LIMIT — at ≥ MAX_ACTIONS_PER_DAY auto-executions today, everything
//     except protective pause is blocked (runaway-loop protection, §6.5).

import type { AutonomyAction, AutonomyLevel, AutonomyRoute, ClientAutonomyRow } from '@/lib/capability-contracts';
import type { GraduationAssessment, RouteContext } from './types';

// ── Exported policy constants ─────────────────────────────────────────────────
//
// The cap defaults are CONSERVATIVE BY DESIGN: they bound what an L2 client
// with an empty caps object can lose to a bug or a bad judgment in one day /
// one month. Owners raise them explicitly; the system never does. (R2 in the
// vision's risk table: one runaway campaign at a design partner ends the
// relationship — defaults must make that impossible, not merely unlikely.)

/** Default L2 per-day spend bound (ILS) when caps.daily_spend_cap is absent. */
export const DEFAULT_DAILY_SPEND_CAP_ILS = 100;

/** Default L2/L3 per-month spend bound (ILS) when caps.monthly_spend_cap is absent. */
export const DEFAULT_MONTHLY_SPEND_CAP_ILS = 2000;

/** Default per-change budget-delta bound (%) when caps.max_daily_delta_pct is absent. */
export const DEFAULT_MAX_DAILY_DELTA_PCT = 25;

/**
 * Hard ceiling on auto-executed actions per client per day (§6.5). A healthy
 * heartbeat takes a handful of actions per tick; twenty in one day means a
 * loop, not a marketer — quarantine everything except the kill-switch.
 */
export const MAX_ACTIONS_PER_DAY = 20;

// ── Graduation thresholds (exported so the UI can show progress toward them) ──

/** Minimum days at the current level before graduation is proposed. */
export const GRADUATION_MIN_DAYS = 14;

/** Minimum decided approvals before the approval rate means anything. */
export const GRADUATION_MIN_APPROVALS = 10;

/** Minimum approval rate — 90% of proposals approved is the trust bar. */
export const GRADUATION_MIN_APPROVAL_RATE = 0.9;

// ── Runtime guards (the DB CHECKs enforce these too; the policy re-checks so
//    it stays total even over garbage that never touched the DB) ──────────────

const LEVELS: readonly AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3'];
const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS);

const ACTION_KINDS: readonly AutonomyAction['kind'][] = [
  'publish_organic', 'create_paid_paused', 'unpause_paid', 'pause_paid',
  'reallocate_budget', 'send_message', 'propose_only',
];
const KIND_SET: ReadonlySet<string> = new Set(ACTION_KINDS);

/** The kinds that move (or free) money — the ones caps exist to bound. */
const MONEY_KINDS: ReadonlySet<string> = new Set(['unpause_paid', 'reallocate_budget', 'send_message']);

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
 * Route one action through the ladder. Total: every input maps to exactly one
 * of execute / propose / block, never a throw.
 *
 * The policy table, cell by cell (WHY per cell):
 *
 *   0. MALFORMED (any level) → block. Never execute garbage; see
 *      malformedReason for why this outranks even the protective bypass.
 *
 *   1. PROTECTIVE BYPASS: 'pause_paid' at L1/L2/L3 → execute, bypassing caps
 *      AND the rate limit. The kill-switch is never gated: caps bound money
 *      going OUT, and a pause only stops it; a runaway loop of pauses
 *      converges to the safe state (everything paused, zero spend), so rate-
 *      limiting it can only delay a rescue, never prevent damage. At L0 even
 *      pause is a proposal — L0 has no execution authority at all, and a
 *      client parked at L0 has nothing running that the system started.
 *
 *   2. RATE LIMIT (every level): todayActionCount ≥ MAX_ACTIONS_PER_DAY →
 *      block, with the numbers in the reason. Runaway-loop protection (§6.5):
 *      past the ceiling the system is quarantined — even proposals stop
 *      (a looping system spams the owner's digest into uselessness) — and
 *      only the protective pause (rule 1, checked first) still acts. An
 *      UNKNOWN count (non-finite) also blocks: we never act blind on the one
 *      counter that detects a runaway.
 *
 *   3. 'propose_only' → propose. It asks and nothing else, by definition, at
 *      every level — there is nothing to execute.
 *
 *   4. L0 → propose, for everything. Draft mode: the system may only ask.
 *
 *   5. 'publish_organic' + 'create_paid_paused' at L1+ → execute. No money
 *      moves: organic posts spend nothing, and a paid campaign created PAUSED
 *      is fully reversible shelf-work (PAUSED-by-default is the floor the
 *      whole vision stands on). These are exactly what L1 "executes organic;
 *      paid fully built, PAUSED" grants, and higher levels include L1.
 *
 *   6. Money kinds (unpause/reallocate/send) at L1 → propose. L1 is
 *      propose+approve: the owner taps every action that moves money.
 *
 *   7. Money kinds at L2 → execute IFF within ALL caps:
 *        spend ≤ remaining daily cap  (dailyCap − todaySpendIls)
 *        AND spend ≤ remaining monthly cap (monthlyCap − monthSpendIls)
 *        AND delta_pct ≤ max_daily_delta_pct
 *      Boundary semantics: exactly AT the cap executes; one agora over
 *      proposes. Over ANY cap → propose (never block — an over-cap action is
 *      a legitimate idea that merely exceeds delegated trust) with the exact
 *      cap and number in the reason, because the owner reads WHY. Missing
 *      caps use the conservative defaults above. Unknown (non-finite) spend
 *      context → propose: caps we cannot verify are caps exceeded.
 *
 *   8. Money kinds at L3 → same as L2 minus the daily spend cap: the owner
 *      has delegated the monthly budget as the only spend bound. The delta
 *      cap STILL applies — thrash protection is a stability property of
 *      budget moves, not a trust question, and no trust level makes ±80%
 *      daily swings a good idea.
 */
export function routeAction(action: AutonomyAction, ctx: RouteContext): AutonomyRoute {
  // 0. Malformed → block (outranks everything; see malformedReason).
  const malformed = malformedReason(action);
  if (malformed) return { route: 'block', reason: malformed };

  // Unknown level (garbage row / future enum drift) → treat as L0, the most
  // conservative reading: when we cannot tell how much trust was granted,
  // assume none.
  const level: AutonomyLevel =
    typeof ctx.level === 'string' && LEVEL_SET.has(ctx.level) ? ctx.level : 'L0';

  // 1. Protective bypass — before the rate limit, deliberately.
  if (action.kind === 'pause_paid' && level !== 'L0') {
    return {
      route:  'execute',
      reason: `protective: pause_paid is the kill-switch — executes at ${level}, bypassing caps and the rate limit (a pause can only stop spend, never start it)`,
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
    return { route: 'propose', reason: 'propose_only: this action only asks, at every level' };
  }

  // 4. L0 draft mode: the system may only ask.
  if (level === 'L0') {
    return { route: 'propose', reason: `L0 draft mode: ${action.kind} may only be proposed — the system publishes nothing at L0` };
  }

  // 5. No-money kinds execute at every level L1+.
  if (action.kind === 'publish_organic' || action.kind === 'create_paid_paused') {
    return {
      route:  'execute',
      reason: `${level}: ${action.kind} moves no money (organic is free; PAUSED creation is reversible shelf-work) — executes at L1+`,
    };
  }

  // From here on: a money kind (unpause_paid / reallocate_budget / send_message).

  // 6. L1 propose+approve: every money move is a one-tap approval.
  if (level === 'L1') {
    return { route: 'propose', reason: `L1 propose+approve: ${action.kind} moves money — queued for owner approval` };
  }

  // 7./8. L2/L3 cap checks.
  const caps       = ctx.caps ?? {};
  const dailyCap   = capOrDefault(caps.daily_spend_cap,    DEFAULT_DAILY_SPEND_CAP_ILS);
  const monthlyCap = capOrDefault(caps.monthly_spend_cap,  DEFAULT_MONTHLY_SPEND_CAP_ILS);
  const maxDelta   = capOrDefault(caps.max_daily_delta_pct, DEFAULT_MAX_DAILY_DELTA_PCT);
  const spend      = action.impact?.spend_ils ?? 0;   // validated finite ≥ 0 above
  const delta      = action.impact?.delta_pct ?? 0;   // validated finite ≥ 0 above

  // Delta cap — applies at L2 AND L3 (thrash protection outlives trust).
  if (delta > maxDelta) {
    return {
      route:  'propose',
      reason: `over delta cap: ${delta}% > max ${maxDelta}%/day per change — proposing instead (thrash protection applies at every level)`,
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

    // Daily cap — L2 only. At L3 the monthly budget is the one spend bound.
    if (level === 'L2') {
      const remainingDaily = Math.max(0, dailyCap - todaySpend);
      if (spend > remainingDaily) {
        return {
          route:  'propose',
          reason: `over daily cap: spend ${spend} ILS > remaining ${remainingDaily} ILS of daily cap ${dailyCap} ILS (${todaySpend} ILS already moved today) — proposing instead`,
        };
      }
    }

    // Monthly cap — L2 and L3.
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
    reason: `${level} within caps: ${action.kind} spend ${spend} ILS, delta ${delta}% ≤ ${maxDelta}% — executing, owner notified after`,
  };
}

/** The next rung of the ladder; L3 has none. */
const NEXT_LEVEL: Partial<Record<AutonomyLevel, AutonomyLevel>> = {
  L0: 'L1',
  L1: 'L2',
  L2: 'L3',
};

/**
 * Assess whether a client has EARNED the next autonomy level (§1.4:
 * "המערכת פעלה 3 שבועות ב-L1 עם 92% אישורים — לשדרג ל-L2?"). Pure — the
 * caller supplies `now` so the assessment is reproducible and testable.
 *
 * Eligible when ALL hold:
 *   • level < L3 (there is a next rung),
 *   • ≥ GRADUATION_MIN_DAYS full days at the current level,
 *   • ≥ GRADUATION_MIN_APPROVALS decided proposals (rate needs a sample), and
 *   • approval rate ≥ GRADUATION_MIN_APPROVAL_RATE.
 *
 * The proposal's reason string carries the actual numbers — graduation is
 * earned and VISIBLE, so the owner always sees the evidence, never just a
 * verdict. Total: unparsable level_since / garbage counters → not eligible
 * (we never propose more autonomy on data we cannot read).
 */
export function assessGraduation(row: ClientAutonomyRow, now: Date): GraduationAssessment {
  const next = NEXT_LEVEL[row.level];
  if (!next) return { eligible: false };   // L3 (or unknown level) never proposes higher

  const sinceMs = Date.parse(row.level_since);
  if (!Number.isFinite(sinceMs)) return { eligible: false };
  const days = Math.floor((now.getTime() - sinceMs) / 86_400_000);

  const total    = Number.isFinite(row.approvals_total)    ? row.approvals_total    : 0;
  const approved = Number.isFinite(row.approvals_approved) ? row.approvals_approved : 0;
  const rate     = total > 0 ? approved / total : 0;

  if (days < GRADUATION_MIN_DAYS)        return { eligible: false };
  if (total < GRADUATION_MIN_APPROVALS)  return { eligible: false };
  if (rate < GRADUATION_MIN_APPROVAL_RATE) return { eligible: false };

  const pct = Math.round(rate * 100);
  return {
    eligible: true,
    proposal: {
      to_level: next,
      reason:   `${days} ימים ב-${row.level}, ${pct}% אישורים (${approved}/${total}) — לשדרג ל-${next}?`,
    },
  };
}
