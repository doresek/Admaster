// lib/economics — the unit-economics engine (D8 L4, MEASUREMENT-SPINE-PLAN §4).
//
// Public surface:
//   • core (pure, total math): break-even ROAS, value-per-lead (CPL ceiling),
//     CPL/ROAS assessments with Hebrew reasons, payback, the BOTH-gates
//     services rule, and computed economics from CRM ground truth.
//   • store (DI'd SupabaseClient): read/seed client_economics + refresh the
//     data-derived fields from funnel_leads closed-won reality.

export {
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
  TERMINAL_STAGES,
  validateOwnerEconomics,
  valuePerLead,
  type ComputedEconomicsFields,
  type ComputedEconomicsLead,
  type ComputedEconomicsResult,
  type CplAssessment,
  type EconError,
  type EconErrorCode,
  type EconFieldError,
  type EconResult,
  type EconVerdict,
  type GateFailure,
  type OwnerEconomicsInput,
  type PaybackInput,
  type RoasAssessment,
  type ServiceGate,
  type ServiceGatesInput,
  type ServiceGatesResult,
  type ValuePerLeadInput,
} from './core';

export {
  ECONOMICS_COLUMNS,
  getEconomics,
  refreshComputed,
  upsertEconomics,
  type RefreshComputedResult,
  type UpsertEconomicsInput,
  type UpsertEconomicsResult,
} from './store';
