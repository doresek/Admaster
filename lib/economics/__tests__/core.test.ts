// Deep tests for the pure unit-economics core (lib/economics/core.ts).
//
// Proves: exact hand-checked math, total-function guards (pathological floats
// → typed errors, NEVER NaN — see the invariant fuzz at the bottom), verdict
// boundaries at the documented thresholds, Hebrew reasons carrying the actual
// numbers, the BOTH-gates services rule, and the ≥5-closed-won statistical-
// humility floor for computed economics.

import { describe, it, expect } from 'vitest';
import {
  assessCpl,
  assessRoas,
  breakEvenRoas,
  computedEconomics,
  LTV_CAC_MIN,
  MARGINAL_HEADROOM,
  MIN_CLOSED_SAMPLE,
  ONBOARDING_QUESTIONS,
  paybackMonths,
  serviceGates,
  validateOwnerEconomics,
  valuePerLead,
  type ComputedEconomicsLead,
  type EconResult,
} from '@/lib/economics';

/** Unwrap an ok result or fail the test with the typed error. */
function unwrap<T>(r: EconResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

/** Assert a typed error with the expected code. */
function expectError<T>(r: EconResult<T>, code: string): void {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

// ── breakEvenRoas ────────────────────────────────────────────────────────────

describe('breakEvenRoas', () => {
  it('margin 25% → 4.0 (must return ₪4 per ₪1 spend to not lose money)', () => {
    expect(unwrap(breakEvenRoas(25))).toBe(4);
  });

  it.each([
    [50, 2],     // 100/50
    [100, 1],    // a 100%-margin business breaks even at ROAS 1
    [40, 2.5],   // 100/40
    [0.5, 200],  // razor-thin margins need huge ROAS
  ])('margin %s%% → break-even %s', (margin, expected) => {
    expect(unwrap(breakEvenRoas(margin))).toBe(expected);
  });

  it.each([[0], [-5], [100.01], [1000], [NaN], [Infinity], [-Infinity]])(
    'margin %s → typed invalid_margin error (never NaN)',
    (margin) => { expectError(breakEvenRoas(margin), 'invalid_margin'); },
  );
});

// ── valuePerLead ─────────────────────────────────────────────────────────────

describe('valuePerLead', () => {
  it('close 20% × ₪2,000 deal × 40% margin → ₪160/lead ceiling', () => {
    // 0.20 × 2000 × 0.40 = 160 — the max profitable CPL.
    expect(unwrap(valuePerLead({ closeRatePct: 20, avgDealValue: 2000, marginPct: 40 }))).toBe(160);
  });

  it('close rate 0% → ceiling ₪0 (valid input; leads that never close are worth nothing)', () => {
    expect(unwrap(valuePerLead({ closeRatePct: 0, avgDealValue: 5000, marginPct: 30 }))).toBe(0);
  });

  it('deal value ₪0 → ceiling ₪0', () => {
    expect(unwrap(valuePerLead({ closeRatePct: 50, avgDealValue: 0, marginPct: 30 }))).toBe(0);
  });

  it('close 100% × ₪1,000 × 100% margin → ₪1,000 (upper bound is the deal itself)', () => {
    expect(unwrap(valuePerLead({ closeRatePct: 100, avgDealValue: 1000, marginPct: 100 }))).toBe(1000);
  });

  it.each([[-1], [100.5], [NaN], [Infinity], [-Infinity]])(
    'close rate %s → invalid_close_rate',
    (closeRatePct) => {
      expectError(valuePerLead({ closeRatePct, avgDealValue: 1000, marginPct: 40 }), 'invalid_close_rate');
    },
  );

  it.each([[-1], [NaN], [Infinity], [-Infinity]])(
    'deal value %s → invalid_deal_value',
    (avgDealValue) => {
      expectError(valuePerLead({ closeRatePct: 20, avgDealValue, marginPct: 40 }), 'invalid_deal_value');
    },
  );

  it.each([[0], [-10], [101], [NaN], [Infinity]])(
    'margin %s → invalid_margin',
    (marginPct) => {
      expectError(valuePerLead({ closeRatePct: 20, avgDealValue: 1000, marginPct }), 'invalid_margin');
    },
  );
});

// ── assessCpl ────────────────────────────────────────────────────────────────

describe('assessCpl', () => {
  it('₪45 vs ₪64 ceiling → profitable, Hebrew reason with the numbers', () => {
    const a = unwrap(assessCpl(45, 64));
    expect(a.verdict).toBe('profitable');
    expect(a.reason).toBe('₪45 לליד מול תקרה של ₪64 — רווחי');
    expect(a.maxCpl).toBe(64);
    expect(a.ratio).toBeCloseTo(45 / 64, 10);
  });

  it(`exactly ${MARGINAL_HEADROOM * 100}% of the ceiling → marginal (the at-risk band starts here)`, () => {
    // 51.2 / 64 = 0.8 exactly.
    const a = unwrap(assessCpl(51.2, 64));
    expect(a.verdict).toBe('marginal');
    expect(a.reason).toContain('שולי');
    expect(a.reason).toContain('51.2');
  });

  it('CPL exactly AT the ceiling → marginal (break-even is not a win)', () => {
    expect(unwrap(assessCpl(64, 64)).verdict).toBe('marginal');
  });

  it('one agora above the ceiling → unprofitable, reason says לא רווחי', () => {
    const a = unwrap(assessCpl(64.01, 64));
    expect(a.verdict).toBe('unprofitable');
    expect(a.reason).toBe('₪64.01 לליד מול תקרה של ₪64 — לא רווחי');
  });

  it('free leads (CPL 0) → profitable', () => {
    expect(unwrap(assessCpl(0, 64)).verdict).toBe('profitable');
  });

  it.each([[-1], [NaN], [Infinity]])('CPL %s → invalid_cpl', (cpl) => {
    expectError(assessCpl(cpl, 64), 'invalid_cpl');
  });

  it.each([[0], [-5], [NaN], [Infinity]])(
    'ceiling %s → invalid_value_per_lead (degenerate economics cannot judge a CPL)',
    (ceiling) => { expectError(assessCpl(45, ceiling), 'invalid_value_per_lead'); },
  );
});

// ── assessRoas ───────────────────────────────────────────────────────────────

describe('assessRoas', () => {
  it('ROAS 3.1 at 25% margin (break-even 4.0) → unprofitable, spec-exact Hebrew reason', () => {
    const a = unwrap(assessRoas(3.1, 25));
    expect(a.verdict).toBe('unprofitable');
    expect(a.reason).toBe('ROAS 3.1 מול נקודת איזון 4.0 — מתחת לאיזון');
    expect(a.breakEvenRoas).toBe(4);
  });

  it('ROAS exactly at break-even → marginal (zero profit is not a win)', () => {
    expect(unwrap(assessRoas(4, 25)).verdict).toBe('marginal');
  });

  it('ROAS at the top of the headroom band (break-even / 0.8) → still marginal', () => {
    // 4 / 0.8 = 5 — inclusive upper edge of the marginal band.
    const a = unwrap(assessRoas(5, 25));
    expect(a.verdict).toBe('marginal');
    expect(a.reason).toContain('קרוב לאיזון');
  });

  it('ROAS just above the band → profitable, reason says מעל האיזון', () => {
    const a = unwrap(assessRoas(5.01, 25));
    expect(a.verdict).toBe('profitable');
    expect(a.reason).toContain('מעל האיזון');
  });

  it('the SAME ROAS flips verdict with margin — why ROAS is never shown without margin', () => {
    // ROAS 3 is a loss at 25% margin (break-even 4) and a clear win at 50% (break-even 2).
    expect(unwrap(assessRoas(3, 25)).verdict).toBe('unprofitable');
    expect(unwrap(assessRoas(3, 50)).verdict).toBe('profitable');
  });

  it.each([[-0.1], [NaN], [Infinity]])('ROAS %s → invalid_roas', (roas) => {
    expectError(assessRoas(roas, 25), 'invalid_roas');
  });

  it('bad margin propagates the typed invalid_margin error', () => {
    expectError(assessRoas(3, 0), 'invalid_margin');
    expectError(assessRoas(3, NaN), 'invalid_margin');
  });
});

// ── paybackMonths ────────────────────────────────────────────────────────────

describe('paybackMonths', () => {
  it('CAC ₪1,200 / ₪400 monthly contribution → 3 months', () => {
    expect(unwrap(paybackMonths({ cac: 1200, monthlyContribution: 400 }))).toBe(3);
  });

  it('CAC 0 → instant payback (0 months)', () => {
    expect(unwrap(paybackMonths({ cac: 0, monthlyContribution: 400 }))).toBe(0);
  });

  it('fractional months are kept exact (₪1,000 / ₪300 → 3.33…)', () => {
    expect(unwrap(paybackMonths({ cac: 1000, monthlyContribution: 300 }))).toBeCloseTo(10 / 3, 10);
  });

  it.each([[-1], [NaN], [Infinity]])('CAC %s → invalid_cac', (cac) => {
    expectError(paybackMonths({ cac, monthlyContribution: 400 }), 'invalid_cac');
  });

  it.each([[0], [-400], [NaN], [Infinity]])(
    'monthly contribution %s → invalid_contribution (₪0/month never pays back)',
    (monthlyContribution) => {
      expectError(paybackMonths({ cac: 1200, monthlyContribution }), 'invalid_contribution');
    },
  );
});

// ── serviceGates (BOTH must pass) ────────────────────────────────────────────

describe('serviceGates', () => {
  it('both gates pass: LTV:CAC 8:1, payback 3 ≤ 6 → pass with no failures', () => {
    const g = unwrap(serviceGates({ ltv: 8000, cac: 1000, paybackM: 3, targetPaybackM: 6 }));
    expect(g.pass).toBe(true);
    expect(g.failures).toEqual([]);
    expect(g.ltvCacRatio).toBe(8);
  });

  it('LTV:CAC fails, payback passes → FAIL naming ltv_cac (passing one never compensates)', () => {
    const g = unwrap(serviceGates({ ltv: 3000, cac: 1000, paybackM: 3, targetPaybackM: 6 }));
    expect(g.pass).toBe(false);
    expect(g.failures).toHaveLength(1);
    expect(g.failures[0].gate).toBe('ltv_cac');
    expect(g.failures[0].reason).toContain('3.0');       // the actual ratio
    expect(g.failures[0].reason).toContain(`${LTV_CAC_MIN}:1`);
  });

  it('LTV:CAC passes, payback fails → FAIL naming payback', () => {
    const g = unwrap(serviceGates({ ltv: 8000, cac: 1000, paybackM: 9, targetPaybackM: 6 }));
    expect(g.pass).toBe(false);
    expect(g.failures).toHaveLength(1);
    expect(g.failures[0].gate).toBe('payback');
    expect(g.failures[0].reason).toContain('9.0');       // actual months
    expect(g.failures[0].reason).toContain('6');         // the target
  });

  it('both fail → both failures listed, each with its own numbers', () => {
    const g = unwrap(serviceGates({ ltv: 2000, cac: 1000, paybackM: 14, targetPaybackM: 6 }));
    expect(g.pass).toBe(false);
    expect(g.failures.map((f) => f.gate)).toEqual(['ltv_cac', 'payback']);
  });

  it('boundaries pass: ratio exactly 4:1 and payback exactly at target', () => {
    const g = unwrap(serviceGates({ ltv: 4000, cac: 1000, paybackM: 6, targetPaybackM: 6 }));
    expect(g.pass).toBe(true);
  });

  it.each([[-1], [NaN], [Infinity]])('LTV %s → invalid_ltv', (ltv) => {
    expectError(serviceGates({ ltv, cac: 1000, paybackM: 3, targetPaybackM: 6 }), 'invalid_ltv');
  });

  it.each([[0], [-1], [NaN], [Infinity]])(
    'CAC %s → invalid_cac (no ratio without a positive CAC)',
    (cac) => {
      expectError(serviceGates({ ltv: 8000, cac, paybackM: 3, targetPaybackM: 6 }), 'invalid_cac');
    },
  );

  it('bad payback / target → typed errors', () => {
    expectError(serviceGates({ ltv: 8000, cac: 1000, paybackM: -1, targetPaybackM: 6 }), 'invalid_payback');
    expectError(serviceGates({ ltv: 8000, cac: 1000, paybackM: NaN, targetPaybackM: 6 }), 'invalid_payback');
    expectError(serviceGates({ ltv: 8000, cac: 1000, paybackM: 3, targetPaybackM: 0 }), 'invalid_target');
  });
});

// ── computedEconomics ────────────────────────────────────────────────────────

const won = (value: number | null): ComputedEconomicsLead => ({ current_stage: 'closed_won', value });
const lost = (): ComputedEconomicsLead => ({ current_stage: 'closed_lost', value: null });
const irrelevant = (): ComputedEconomicsLead => ({ current_stage: 'irrelevant', value: null });
const pending = (): ComputedEconomicsLead => ({ current_stage: 'new', value: null });

describe('computedEconomics', () => {
  it(`${MIN_CLOSED_SAMPLE - 1} closed-won with values → insufficient_sample (4 closes is an anecdote)`, () => {
    const r = computedEconomics([won(1000), won(2000), won(3000), won(4000), lost(), lost()]);
    expect(r.computed).toBeNull();
    if (r.computed === null) {
      expect(r.reason).toBe('insufficient_sample');
      expect(r.sample_n).toBe(4);
    }
  });

  it('empty registry → insufficient_sample with sample 0', () => {
    const r = computedEconomics([]);
    expect(r.computed).toBeNull();
    if (r.computed === null) expect(r.sample_n).toBe(0);
  });

  it('5 valued wins + 3 lost + 2 irrelevant → close 50%, avg ₪2,000 (hand-math)', () => {
    // decided = 5 won + 3 lost + 2 irrelevant = 10; close = 5/10 = 50.00%.
    // avg = (1000+2000+3000+1500+2500)/5 = 10000/5 = 2000.
    const r = computedEconomics([
      won(1000), won(2000), won(3000), won(1500), won(2500),
      lost(), lost(), lost(), irrelevant(), irrelevant(),
    ]);
    expect(r.computed).toEqual({
      close_rate_pct: 50,
      avg_deal_value: 2000,
      sample_n:       5,
      source:         'computed',
    });
  });

  it('a valueless win counts as a CLOSE but not in the deal average', () => {
    // 6 won (5 valued: 100..500, avg 300) + 4 lost = 10 decided → close 60%.
    const r = computedEconomics([
      won(100), won(200), won(300), won(400), won(500), won(null),
      lost(), lost(), lost(), lost(),
    ]);
    expect(r.computed).toEqual({
      close_rate_pct: 60,
      avg_deal_value: 300,
      sample_n:       5,
      source:         'computed',
    });
  });

  it('pending (non-terminal) leads are excluded from the denominator — no early-cohort downward bias', () => {
    const decidedOnly = computedEconomics([
      won(1000), won(1000), won(1000), won(1000), won(1000), lost(),
    ]);
    const withPending = computedEconomics([
      won(1000), won(1000), won(1000), won(1000), won(1000), lost(),
      pending(), pending(), pending(), pending(), pending(), pending(),
    ]);
    expect(withPending).toEqual(decidedOnly);
    // 5/6 = 83.333…% → rounded to 2 decimals for numeric(5,2).
    expect(decidedOnly.computed?.close_rate_pct).toBe(83.33);
  });

  it('₪0 / negative / non-finite values are data glitches, not deals — excluded from the sample', () => {
    const r = computedEconomics([
      won(0), won(-500), won(NaN), won(Infinity),
      won(1000), won(1000), won(1000), won(1000),
    ]);
    // Only the 4 positive-finite values count → below the floor.
    expect(r.computed).toBeNull();
    if (r.computed === null) expect(r.sample_n).toBe(4);
  });

  it('avg is rounded to 2 decimals (numeric(12,2))', () => {
    // (100+100+100+100+101)/5 = 100.2
    const r = computedEconomics([won(100), won(100), won(100), won(100), won(101)]);
    expect(r.computed?.avg_deal_value).toBe(100.2);
    expect(r.computed?.close_rate_pct).toBe(100);
  });
});

// ── owner-input validation + onboarding questions ────────────────────────────

describe('validateOwnerEconomics', () => {
  it('accepts a sane services profile (margin 40, deal 2000, close 20)', () => {
    expect(validateOwnerEconomics({
      contributionMarginPct: 40, avgDealValue: 2000, closeRatePct: 20,
    })).toEqual([]);
  });

  it('accepts the range edges the DB CHECKs allow (margin 100, close 0/100, payback 1/36)', () => {
    expect(validateOwnerEconomics({
      contributionMarginPct: 100, avgDealValue: 0, closeRatePct: 0, paybackTargetMonths: 1,
    })).toEqual([]);
    expect(validateOwnerEconomics({
      contributionMarginPct: 0.01, avgDealValue: 1, closeRatePct: 100,
      paybackTargetMonths: 36, currency: 'USD',
    })).toEqual([]);
  });

  it.each([
    ['margin 0',            { contributionMarginPct: 0,   avgDealValue: 1, closeRatePct: 1 }, 'contributionMarginPct'],
    ['margin > 100',        { contributionMarginPct: 101, avgDealValue: 1, closeRatePct: 1 }, 'contributionMarginPct'],
    ['margin NaN',          { contributionMarginPct: NaN, avgDealValue: 1, closeRatePct: 1 }, 'contributionMarginPct'],
    ['deal negative',       { contributionMarginPct: 40, avgDealValue: -1,       closeRatePct: 1 }, 'avgDealValue'],
    ['deal Infinity',       { contributionMarginPct: 40, avgDealValue: Infinity, closeRatePct: 1 }, 'avgDealValue'],
    ['close > 100',         { contributionMarginPct: 40, avgDealValue: 1, closeRatePct: 100.5 }, 'closeRatePct'],
    ['close negative',      { contributionMarginPct: 40, avgDealValue: 1, closeRatePct: -5 },    'closeRatePct'],
  ] as const)('%s → Hebrew field error on the right field', (_name, input, field) => {
    const errors = validateOwnerEconomics(input);
    expect(errors.map((e) => e.field)).toContain(field);
    // Every validation message is Hebrew (surfaces directly in onboarding).
    for (const e of errors) expect(e.message).toMatch(/[֐-׿]/);
  });

  it('payback target must be an INTEGER between 1 and 36', () => {
    const base = { contributionMarginPct: 40, avgDealValue: 1000, closeRatePct: 20 };
    expect(validateOwnerEconomics({ ...base, paybackTargetMonths: 0 })).toHaveLength(1);
    expect(validateOwnerEconomics({ ...base, paybackTargetMonths: 37 })).toHaveLength(1);
    expect(validateOwnerEconomics({ ...base, paybackTargetMonths: 6.5 })).toHaveLength(1);
  });

  it('currency must be a 3-letter uppercase code', () => {
    const base = { contributionMarginPct: 40, avgDealValue: 1000, closeRatePct: 20 };
    expect(validateOwnerEconomics({ ...base, currency: 'ils' })).toHaveLength(1);
    expect(validateOwnerEconomics({ ...base, currency: 'SHEKEL' })).toHaveLength(1);
    expect(validateOwnerEconomics({ ...base, currency: 'ILS' })).toEqual([]);
  });

  it('bad answers accumulate — one error per broken field', () => {
    const errors = validateOwnerEconomics({
      contributionMarginPct: 0, avgDealValue: -1, closeRatePct: 200,
    });
    expect(errors.map((e) => e.field).sort()).toEqual(
      ['avgDealValue', 'closeRatePct', 'contributionMarginPct'],
    );
  });
});

describe('ONBOARDING_QUESTIONS', () => {
  it('asks exactly the 3 seeded fields, in Hebrew', () => {
    expect(Object.keys(ONBOARDING_QUESTIONS).sort()).toEqual(
      ['avgDealValue', 'closeRatePct', 'contributionMarginPct'],
    );
    for (const q of Object.values(ONBOARDING_QUESTIONS)) expect(q).toMatch(/[֐-׿]/);
  });
});

// ── totality invariant: NaN never escapes ────────────────────────────────────

describe('totality invariant — every ok result is a finite number, for ANY input', () => {
  const GRID = [
    NaN, Infinity, -Infinity, -1e12, -1, -0.0001, 0, 0.0001, 0.8, 1,
    25, 51.2, 64, 80, 99.99, 100, 100.01, 1e12,
  ];

  it('breakEvenRoas / valuePerLead / paybackMonths never leak NaN or Infinity', () => {
    for (const a of GRID) {
      const be = breakEvenRoas(a);
      if (be.ok) expect(Number.isFinite(be.value)).toBe(true);
      for (const b of GRID) {
        const pb = paybackMonths({ cac: a, monthlyContribution: b });
        if (pb.ok) expect(Number.isFinite(pb.value)).toBe(true);
        for (const c of [0, 20, 100, NaN, Infinity, -1]) {
          const vpl = valuePerLead({ closeRatePct: c, avgDealValue: b, marginPct: a });
          if (vpl.ok) expect(Number.isFinite(vpl.value)).toBe(true);
        }
      }
    }
  });

  it('assessCpl / assessRoas / serviceGates never leak NaN in numbers or reasons', () => {
    for (const a of GRID) {
      for (const b of GRID) {
        const cpl = assessCpl(a, b);
        if (cpl.ok) {
          expect(Number.isFinite(cpl.value.ratio)).toBe(true);
          expect(cpl.value.reason).not.toContain('NaN');
        }
        const roas = assessRoas(a, b);
        if (roas.ok) {
          expect(Number.isFinite(roas.value.breakEvenRoas)).toBe(true);
          expect(roas.value.reason).not.toContain('NaN');
        }
        const gates = serviceGates({ ltv: a, cac: b, paybackM: a, targetPaybackM: b });
        if (gates.ok) {
          expect(Number.isFinite(gates.value.ltvCacRatio)).toBe(true);
          for (const f of gates.value.failures) expect(f.reason).not.toContain('NaN');
        }
      }
    }
  });
});
