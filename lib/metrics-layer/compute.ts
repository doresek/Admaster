// lib/metrics-layer/compute.ts
//
// computeMetrics — run the registry over one assembled MetricInputs bundle and
// emit MetricValue[] with the comparison bases attached (DASHBOARD-ARCHITECTURE
// §0.3 leap 4: prev-period + goal + benchmark — never a naked number).
//
// TOTAL by contract: missing inputs → null values with Hebrew reasons; a
// NaN-poisoned row or a misbehaving formula can never surface NaN/Infinity or
// a throw to a dashboard (invariant-tested). Deterministic: no clock, no
// locale, pure arithmetic over the inputs.

import type {
  FormulaContext,
  MetricComparison,
  MetricDef,
  MetricGoalMap,
  MetricInputs,
  MetricPeriod,
  MetricResult,
  MetricValue,
  PeriodSlice,
} from './types';

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** 1-dp rounding for deltas (display-stable, float-noise-free). */
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Inclusive day count of a YYYY-MM-DD period; 0 when unparseable or inverted —
 * formulas treat periodDays < 1 as "not computable" rather than guessing.
 * Date.parse of a date-only string is UTC-anchored → timezone-independent.
 */
export function periodDaysInclusive(period: MetricPeriod): number {
  const start = Date.parse(`${period.start}T00:00:00.000Z`);
  const end   = Date.parse(`${period.end}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Evaluate one formula defensively: a throw becomes a null-with-reason (the
 * error text is SURFACED in the reason — nothing swallowed), and any
 * non-finite value (NaN-poisoned rows) is demoted to null. This is the layer's
 * NaN firewall — dashboards downstream never render NaN.
 */
function evaluate(def: MetricDef, slice: PeriodSlice, ctx: FormulaContext): MetricResult {
  let result: MetricResult;
  try {
    result = def.formula(slice, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: null, reason: `שגיאת חישוב במדד ${def.key}: ${message}` };
  }
  if (result.value !== null && !isFiniteNumber(result.value)) {
    return { value: null, reason: `תוצאה לא תקינה במדד ${def.key} — נתון מקור פגום` };
  }
  return result;
}

/** Direction-aware target check: up_good → value ≥ target; down_good → ≤. */
function compareTo(
  value:     number | null,
  target:    number | undefined | null,
  direction: MetricDef['direction'],
): MetricComparison | null {
  if (value === null || !isFiniteNumber(target)) return null;
  const met = direction === 'up_good' ? value >= target : value <= target;
  return { target, met };
}

/**
 * Compute every metric in `defs` over the bundle. `goals` carries the owner's
 * per-metric targets (per-client, optional); benchmarks come from the defs.
 */
export function computeMetrics(
  defs:   readonly MetricDef[],
  inputs: MetricInputs,
  goals:  MetricGoalMap = {},
): MetricValue[] {
  const ctxCurrent: FormulaContext = {
    economics:  inputs.economics,
    periodDays: periodDaysInclusive(inputs.current.period),
  };
  const ctxPrevious: FormulaContext = {
    economics:  inputs.economics,
    periodDays: periodDaysInclusive(inputs.previous.period),
  };

  const values: MetricValue[] = [];
  for (const def of defs) {
    const current  = evaluate(def, inputs.current, ctxCurrent);
    const previous = evaluate(def, inputs.previous, ctxPrevious);

    // delta% is only honest when both sides exist and prev ≠ 0 (a change from
    // zero is "new", not "+∞%" — narration says so instead of a number).
    const deltaPct =
      current.value !== null && previous.value !== null && previous.value !== 0
        ? round1(((current.value - previous.value) / Math.abs(previous.value)) * 100)
        : null;

    values.push({
      key:                   def.key,
      name_he:               def.name_he,
      unit:                  def.unit,
      direction:             def.direction,
      honesty_label:         def.honesty_label,
      value:                 current.value,
      not_computable_reason: current.reason,
      prev:                  previous.value,
      delta_pct:             deltaPct,
      vs_goal:               compareTo(current.value, goals[def.key], def.direction),
      vs_benchmark:          compareTo(current.value, def.benchmark, def.direction),
    });
  }
  return values;
}
