// lib/autonomy/types.ts
//
// Internal types for the autonomy ladder (VISION-DEEP §1.4). The row/contract
// shapes live in lib/capability-contracts (owned by the orchestrator, never
// edited here) — this file re-exports the ones consumers need and adds the
// module-internal shapes: the routing context, the graduation assessment, and
// the typed store error.

export type {
  AutonomyLevel,
  AutonomyCaps,
  AutonomyAction,
  AutonomyRoute,
  ClientAutonomyRow,
} from '@/lib/capability-contracts';

import type { AutonomyCaps, AutonomyLevel } from '@/lib/capability-contracts';

/**
 * Everything the pure policy needs to route one action. The spend numbers are
 * "already moved today / this month" in ILS — supplied by the CALLER (the
 * heartbeat tracks its own executions) until a real money ledger exists to
 * read them from; see route-and-log.ts.
 */
export interface RouteContext {
  level:            AutonomyLevel;
  caps:             AutonomyCaps;
  /** Auto-executed actions since midnight (UTC) — the rate-limit input. */
  todayActionCount: number;
  /** ILS the system already moved today (caller-tracked). */
  todaySpendIls:    number;
  /** ILS the system already moved this calendar month (caller-tracked). */
  monthSpendIls:    number;
}

/** The concrete upgrade a graduation assessment puts in front of the owner. */
export interface GraduationProposal {
  to_level: AutonomyLevel;
  reason:   string;   // carries the numbers: "21 ימים ב-L1, 92% אישורים (12/13)"
}

/**
 * assessGraduation's verdict. `proposal` is present exactly when `eligible` —
 * graduation is EARNED and visible, so the reason string always carries the
 * evidence (days at level, approval rate, counts).
 */
export interface GraduationAssessment {
  eligible:  boolean;
  proposal?: GraduationProposal;
}

/**
 * Typed error for every persistence failure in lib/autonomy — carries the
 * operation name so callers (and the fail-safe in route-and-log) can log a
 * precise audit trail of WHAT failed, not just that something did.
 */
export class AutonomyStoreError extends Error {
  constructor(readonly op: string, detail: string) {
    super(`${op}: ${detail}`);
    this.name = 'AutonomyStoreError';
  }
}
