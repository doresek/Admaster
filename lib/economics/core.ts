// lib/economics/core.ts
//
// PURE unit-economics math (D8 L4, PERFECT-MARKETER-ROADMAP + MEASUREMENT-
// SPINE-PLAN §1/§4). No I/O, no Date, no randomness — every function is TOTAL:
// for any float input (0, negatives, NaN, ±Infinity) it returns either a
// finite-valued ok result or a typed error result. NaN never escapes; the
// invariant test in __tests__/core.test.ts fuzzes a pathological grid to
// prove it.
//
// Formula sources (the research-backed rules the roadmap cites):
//   • break-even ROAS = 1 / contribution-margin. A ROAS above break-even is
//     profit, below is loss — which is why the doctrine says NEVER show ROAS
//     without margin ("ROAS 3" means nothing until you know break-even is 4).
//   • value-per-lead = close% × avg deal value × contribution margin — the
//     expected CONTRIBUTION one incoming lead is worth, i.e. the maximum
//     profitable cost-per-lead (the CPL ceiling).
//   • services gates: LTV:CAC ≥ 4:1 AND payback ≤ target months (default 6) —
//     BOTH must hold; passing one does not compensate for failing the other.
//
// All Hebrew reasons carry the actual numbers so digests/dashboards can show
// "מעל/מתחת לנקודת האיזון" instead of a naked ROAS.

import type { LeadStage } from '@/lib/capability-contracts';

// ── Result plumbing ──────────────────────────────────────────────────────────

export type EconErrorCode =
  | 'invalid_margin'
  | 'invalid_close_rate'
  | 'invalid_deal_value'
  | 'invalid_cpl'
  | 'invalid_value_per_lead'
  | 'invalid_roas'
  | 'invalid_cac'
  | 'invalid_contribution'
  | 'invalid_payback'
  | 'invalid_target'
  | 'invalid_ltv';

export interface EconError {
  code:    EconErrorCode;
  message: string;
}

/** Total-function result: finite value or typed error — never NaN/Infinity. */
export type EconResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: EconError };

const ok = <T>(value: T): EconResult<T> => ({ ok: true, value });
const err = <T>(code: EconErrorCode, message: string): EconResult<T> =>
  ({ ok: false, error: { code, message } });

// ── Shared constants ─────────────────────────────────────────────────────────

/**
 * The "marginal" band: a CPL at ≥80% of the ceiling (or a ROAS with ≤20%
 * headroom over break-even) is technically profitable but one bad week from
 * not being — the allocator should treat it as at-risk, not as a win.
 */
export const MARGINAL_HEADROOM = 0.8;

/** Services gate #1: LTV:CAC must be at least 4:1 (roadmap D8 L4). */
export const LTV_CAC_MIN = 4;

/**
 * Minimum closed-won-with-value sample before we trust DATA over the owner's
 * seeded answers (statistical humility — 4 closes is an anecdote, not a rate).
 */
export const MIN_CLOSED_SAMPLE = 5;

/** Funnel stages that are decided — the close-rate denominator (see below). */
export const TERMINAL_STAGES: readonly LeadStage[] =
  ['closed_won', 'closed_lost', 'irrelevant'] as const;

// ── Formatting (Hebrew reasons carry the real numbers) ───────────────────────

/** ₪ amounts: integers stay bare ("64"), fractions keep ≤2 decimals ("63.5"). */
const fmtMoney = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
};

/** ROAS / ratios: always one decimal ("4.0", "3.1") — matches the digest voice. */
const fmtRatio = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

const round2 = (n: number): number => Math.round(n * 100) / 100;

const isFiniteNum = (n: number): boolean => Number.isFinite(n);

// ── break-even ROAS ──────────────────────────────────────────────────────────

/**
 * break-even ROAS = 1 / contribution margin = 100 / marginPct.
 * A 25% margin business must return ₪4 of revenue per ₪1 of ad spend just to
 * not lose money. COMPUTED, never stored (client_economics stores only the
 * margin); never asked of the owner.
 */
export function breakEvenRoas(marginPct: number): EconResult<number> {
  if (!isFiniteNum(marginPct)) {
    return err('invalid_margin', `contribution margin must be a finite number, got ${marginPct}`);
  }
  if (marginPct <= 0 || marginPct > 100) {
    return err('invalid_margin', `contribution margin must be in (0, 100], got ${marginPct}`);
  }
  return ok(100 / marginPct);
}

// ── value per lead (the CPL ceiling) ─────────────────────────────────────────

export interface ValuePerLeadInput {
  /** Leads that become paying customers, in percent [0, 100]. */
  closeRatePct: number;
  /** Average deal value in the client's currency (₪). */
  avgDealValue: number;
  /** Contribution margin in percent (0, 100]. */
  marginPct: number;
}

/**
 * value-per-lead = close% × avg deal value × contribution margin.
 * Source: roadmap D8 L4 ("value-per-lead = close%×deal×margin"). This is the
 * expected CONTRIBUTION of one incoming lead, i.e. the maximum CPL at which a
 * lead is still profitable. Example: 20% close × ₪2,000 deal × 40% margin →
 * ₪160/lead ceiling.
 */
export function valuePerLead(input: ValuePerLeadInput): EconResult<number> {
  const { closeRatePct, avgDealValue, marginPct } = input;
  if (!isFiniteNum(closeRatePct) || closeRatePct < 0 || closeRatePct > 100) {
    return err('invalid_close_rate', `close rate must be in [0, 100], got ${closeRatePct}`);
  }
  if (!isFiniteNum(avgDealValue) || avgDealValue < 0) {
    return err('invalid_deal_value', `avg deal value must be a finite number ≥ 0, got ${avgDealValue}`);
  }
  if (!isFiniteNum(marginPct) || marginPct <= 0 || marginPct > 100) {
    return err('invalid_margin', `contribution margin must be in (0, 100], got ${marginPct}`);
  }
  return ok((closeRatePct / 100) * avgDealValue * (marginPct / 100));
}

// ── CPL assessment ───────────────────────────────────────────────────────────

export type EconVerdict = 'profitable' | 'marginal' | 'unprofitable';

export interface CplAssessment {
  verdict: EconVerdict;
  /** Hebrew, with the numbers: "₪45 לליד מול תקרה של ₪64 — רווחי". */
  reason:  string;
  cpl:     number;
  /** The ceiling this CPL was judged against (= value-per-lead). */
  maxCpl:  number;
  /** cpl / maxCpl — 1.0 is exactly break-even. */
  ratio:   number;
}

/**
 * Judge an actual CPL against the value-per-lead ceiling.
 *   • ratio > 1            → unprofitable (paying more than a lead is worth)
 *   • 0.8 ≤ ratio ≤ 1      → marginal (profitable but ≤20% headroom)
 *   • ratio < 0.8          → profitable
 * The ceiling must be positive: a zero/negative ceiling means the economics
 * inputs are degenerate (0% close rate or ₪0 deals) and no CPL can be judged.
 */
export function assessCpl(cpl: number, maxCplPerLead: number): EconResult<CplAssessment> {
  if (!isFiniteNum(cpl) || cpl < 0) {
    return err('invalid_cpl', `CPL must be a finite number ≥ 0, got ${cpl}`);
  }
  if (!isFiniteNum(maxCplPerLead) || maxCplPerLead <= 0) {
    return err('invalid_value_per_lead', `value-per-lead ceiling must be > 0, got ${maxCplPerLead}`);
  }
  const ratio = cpl / maxCplPerLead;
  const verdict: EconVerdict =
    ratio > 1 ? 'unprofitable' : ratio >= MARGINAL_HEADROOM ? 'marginal' : 'profitable';
  const label =
    verdict === 'profitable' ? 'רווחי' : verdict === 'marginal' ? 'שולי' : 'לא רווחי';
  return ok({
    verdict,
    reason: `₪${fmtMoney(cpl)} לליד מול תקרה של ₪${fmtMoney(maxCplPerLead)} — ${label}`,
    cpl,
    maxCpl: maxCplPerLead,
    ratio,
  });
}

// ── ROAS assessment ──────────────────────────────────────────────────────────

export interface RoasAssessment {
  verdict:       EconVerdict;
  /** Hebrew, with the numbers: "ROAS 3.1 מול נקודת איזון 4.0 — מתחת לאיזון". */
  reason:        string;
  actualRoas:    number;
  breakEvenRoas: number;
}

/**
 * Judge an actual ROAS against the margin-derived break-even. The doctrine:
 * NEVER show ROAS without margin — "ROAS 3.1" is a loss for a 25%-margin
 * business (break-even 4.0) and a win for a 50%-margin one (break-even 2.0).
 *   • roas < breakEven                      → unprofitable (מתחת לאיזון)
 *   • breakEven ≤ roas ≤ breakEven / 0.8    → marginal (≤20% headroom)
 *   • roas > breakEven / 0.8                → profitable
 */
export function assessRoas(actualRoas: number, marginPct: number): EconResult<RoasAssessment> {
  if (!isFiniteNum(actualRoas) || actualRoas < 0) {
    return err('invalid_roas', `ROAS must be a finite number ≥ 0, got ${actualRoas}`);
  }
  const be = breakEvenRoas(marginPct);
  if (!be.ok) return be;

  const breakEven = be.value;
  const verdict: EconVerdict =
    actualRoas < breakEven
      ? 'unprofitable'
      : actualRoas <= breakEven / MARGINAL_HEADROOM
        ? 'marginal'
        : 'profitable';
  const label =
    verdict === 'profitable' ? 'מעל האיזון' : verdict === 'marginal' ? 'קרוב לאיזון' : 'מתחת לאיזון';
  return ok({
    verdict,
    reason: `ROAS ${fmtRatio(actualRoas)} מול נקודת איזון ${fmtRatio(breakEven)} — ${label}`,
    actualRoas,
    breakEvenRoas: breakEven,
  });
}

// ── Payback ──────────────────────────────────────────────────────────────────

export interface PaybackInput {
  /** Customer acquisition cost (₪). */
  cac: number;
  /** Monthly contribution (revenue × margin) from one customer (₪/month). */
  monthlyContribution: number;
}

/**
 * Months to recover CAC from a customer's monthly contribution:
 * payback = CAC / monthly contribution. Contribution must be positive —
 * a customer contributing ₪0/month never pays back, which is a degenerate
 * input, not a number.
 */
export function paybackMonths(input: PaybackInput): EconResult<number> {
  const { cac, monthlyContribution } = input;
  if (!isFiniteNum(cac) || cac < 0) {
    return err('invalid_cac', `CAC must be a finite number ≥ 0, got ${cac}`);
  }
  if (!isFiniteNum(monthlyContribution) || monthlyContribution <= 0) {
    return err('invalid_contribution', `monthly contribution must be > 0, got ${monthlyContribution}`);
  }
  return ok(cac / monthlyContribution);
}

// ── Services gates (BOTH must pass) ──────────────────────────────────────────

export type ServiceGate = 'ltv_cac' | 'payback';

export interface GateFailure {
  gate:   ServiceGate;
  /** Hebrew, with the numbers. */
  reason: string;
}

export interface ServiceGatesInput {
  /** Lifetime value of a customer (₪). */
  ltv: number;
  /** Customer acquisition cost (₪); must be > 0 for the ratio to exist. */
  cac: number;
  /** Actual/observed payback in months (e.g. from `paybackMonths`). */
  paybackM: number;
  /** Payback target in months (client_economics.payback_target_months, default 6). */
  targetPaybackM: number;
}

export interface ServiceGatesResult {
  /** true only when BOTH gates pass. */
  pass:          boolean;
  failures:      GateFailure[];
  ltvCacRatio:   number;
  paybackMonths: number;
}

/**
 * The services viability gates (roadmap D8 L4): LTV:CAC ≥ 4:1 AND payback ≤
 * target months. BOTH must hold — a stellar LTV:CAC with a 14-month payback
 * is still a cash-flow trap for an SMB, and a fast payback on a 2:1 ratio is
 * churn wearing a costume. `failures` names each failing gate with numbers.
 */
export function serviceGates(input: ServiceGatesInput): EconResult<ServiceGatesResult> {
  const { ltv, cac, paybackM, targetPaybackM } = input;
  if (!isFiniteNum(ltv) || ltv < 0) {
    return err('invalid_ltv', `LTV must be a finite number ≥ 0, got ${ltv}`);
  }
  if (!isFiniteNum(cac) || cac <= 0) {
    return err('invalid_cac', `CAC must be > 0 for an LTV:CAC ratio, got ${cac}`);
  }
  if (!isFiniteNum(paybackM) || paybackM < 0) {
    return err('invalid_payback', `payback months must be a finite number ≥ 0, got ${paybackM}`);
  }
  if (!isFiniteNum(targetPaybackM) || targetPaybackM <= 0) {
    return err('invalid_target', `target payback months must be > 0, got ${targetPaybackM}`);
  }

  const ratio = ltv / cac;
  const failures: GateFailure[] = [];
  if (ratio < LTV_CAC_MIN) {
    failures.push({
      gate:   'ltv_cac',
      reason: `יחס LTV:CAC של ${fmtRatio(ratio)} — נדרש לפחות ${LTV_CAC_MIN}:1`,
    });
  }
  if (paybackM > targetPaybackM) {
    failures.push({
      gate:   'payback',
      reason: `החזר עלות רכישה תוך ${fmtRatio(paybackM)} חודשים — היעד הוא עד ${fmtMoney(targetPaybackM)} חודשים`,
    });
  }
  return ok({ pass: failures.length === 0, failures, ltvCacRatio: ratio, paybackMonths: paybackM });
}

// ── Computed economics from CRM ground truth ─────────────────────────────────

/** The projection of funnel_leads this computation needs. */
export interface ComputedEconomicsLead {
  current_stage: LeadStage;
  value:         number | null;
}

export interface ComputedEconomicsFields {
  close_rate_pct: number;
  avg_deal_value: number;
  /** Closed-won leads WITH a recorded value — the evidence the numbers rest on. */
  sample_n:       number;
  source:         'computed';
}

export type ComputedEconomicsResult =
  | { computed: ComputedEconomicsFields }
  | { computed: null; reason: 'insufficient_sample'; sample_n: number };

/**
 * Derive the ACTUAL close rate + avg deal value from CRM ground truth
 * (funnel_leads / lead_stage_events), replacing the owner's seeded guesses
 * once the data can carry the claim.
 *
 * Statistical humility: below MIN_CLOSED_SAMPLE (5) closed-won-with-value
 * leads we return null with 'insufficient_sample' — 4 closes is an anecdote —
 * and the owner-seeded values remain in force.
 *
 * Denominator choice (WHY): close rate = closed_won / DECIDED leads
 * (closed_won + closed_lost + irrelevant), not / all leads. Pending leads
 * ('new'…'meeting') haven't had time to close, so counting them would bias
 * the rate downward early in a cohort; terminal-only is the maturity-adjusted
 * estimator. Non-terminal rows passed in are ignored, so callers may pass
 * either pre-filtered terminal rows or the whole registry.
 *
 * Numerator/avg split: a closed_won WITHOUT a recorded value still counts as
 * a close (a win is a win) but cannot contribute to avg deal value; the
 * sample gate is on wins WITH values because avg_deal_value is the fragile
 * quantity. Values must be finite and > 0 (a ₪0 "deal" is a data glitch, not
 * revenue).
 */
export function computedEconomics(
  leads: readonly ComputedEconomicsLead[],
): ComputedEconomicsResult {
  const decided = leads.filter((l) => TERMINAL_STAGES.includes(l.current_stage));
  const won = decided.filter((l) => l.current_stage === 'closed_won');
  const wonWithValue = won.filter(
    (l): l is ComputedEconomicsLead & { value: number } =>
      typeof l.value === 'number' && Number.isFinite(l.value) && l.value > 0,
  );

  if (wonWithValue.length < MIN_CLOSED_SAMPLE) {
    return { computed: null, reason: 'insufficient_sample', sample_n: wonWithValue.length };
  }

  // decided.length ≥ won.length ≥ wonWithValue.length ≥ 5 > 0 — division is safe.
  const closeRatePct = round2((won.length / decided.length) * 100);
  const totalValue = wonWithValue.reduce((sum, l) => sum + l.value, 0);
  const avgDealValue = round2(totalValue / wonWithValue.length);

  return {
    computed: {
      close_rate_pct: closeRatePct,
      avg_deal_value: avgDealValue,
      sample_n:       wonWithValue.length,
      source:         'computed',
    },
  };
}

// ── Owner-input validation (the 3 onboarding answers) ────────────────────────

/**
 * The three Hebrew onboarding questions whose answers seed client_economics.
 * Exported so every surface (onboarding UI, digest prompts) asks the SAME
 * questions the engine validates.
 */
export const ONBOARDING_QUESTIONS = {
  contributionMarginPct: 'מתוך כל שקל שנכנס, כמה נשאר לך אחרי עלויות ישירות? (שולי תרומה באחוזים)',
  avgDealValue:          'כמה שווה לך עסקה ממוצעת בשקלים?',
  closeRatePct:          'מתוך 10 לידים שנכנסים, כמה הופכים ללקוחות משלמים? (אחוז סגירה)',
} as const;

export interface OwnerEconomicsInput {
  contributionMarginPct: number;
  avgDealValue:          number;
  closeRatePct:          number;
  paybackTargetMonths?:  number;
  currency?:             string;
}

export interface EconFieldError {
  field:   string;
  /** Hebrew — these surface directly in the onboarding UI. */
  message: string;
}

/** Bounds mirror the client_economics CHECK constraints (migration 060). */
const MAX_DEAL_VALUE = 9_999_999_999; // numeric(12,2)
const PAYBACK_MIN = 1;
const PAYBACK_MAX = 36;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Pure range validation for the owner's onboarding answers, mirroring the DB
 * CHECK constraints so bad input fails with a Hebrew field error at the API
 * boundary instead of a Postgres error string.
 */
export function validateOwnerEconomics(input: OwnerEconomicsInput): EconFieldError[] {
  const errors: EconFieldError[] = [];
  const { contributionMarginPct, avgDealValue, closeRatePct, paybackTargetMonths, currency } = input;

  if (!isFiniteNum(contributionMarginPct) || contributionMarginPct <= 0 || contributionMarginPct > 100) {
    errors.push({
      field:   'contributionMarginPct',
      message: 'שולי תרומה חייבים להיות מספר בין 0 ל-100 (לא כולל 0)',
    });
  }
  if (!isFiniteNum(avgDealValue) || avgDealValue < 0 || avgDealValue > MAX_DEAL_VALUE) {
    errors.push({
      field:   'avgDealValue',
      message: 'שווי עסקה ממוצע חייב להיות מספר חיובי סביר בשקלים',
    });
  }
  if (!isFiniteNum(closeRatePct) || closeRatePct < 0 || closeRatePct > 100) {
    errors.push({
      field:   'closeRatePct',
      message: 'אחוז סגירה חייב להיות מספר בין 0 ל-100',
    });
  }
  if (paybackTargetMonths !== undefined) {
    if (!Number.isInteger(paybackTargetMonths) || paybackTargetMonths < PAYBACK_MIN || paybackTargetMonths > PAYBACK_MAX) {
      errors.push({
        field:   'paybackTargetMonths',
        message: `יעד החזר חייב להיות מספר שלם של חודשים בין ${PAYBACK_MIN} ל-${PAYBACK_MAX}`,
      });
    }
  }
  if (currency !== undefined && !CURRENCY_RE.test(currency)) {
    errors.push({
      field:   'currency',
      message: 'מטבע חייב להיות קוד בן 3 אותיות (למשל ILS)',
    });
  }
  return errors;
}
