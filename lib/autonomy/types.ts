// lib/autonomy/types.ts
//
// Internal types for the autonomy modes (VISION-DEEP §1.4; D1 DECIDED: 3
// USER-SELECTABLE modes replace the L0–L3 ladder — the owner picks, the
// system never promotes itself). The row/contract shapes live in
// lib/capability-contracts (owned by the orchestrator, never edited here) —
// this file re-exports the ones consumers need and adds the module-internal
// shapes: the routing context, the mode-suggestion assessment, and the typed
// store error.

export type {
  AutonomyMode,
  AutonomyCaps,
  AutonomyAction,
  AutonomyRoute,
  ClientAutonomyRow,
} from '@/lib/capability-contracts';

import type { AutonomyCaps, AutonomyMode } from '@/lib/capability-contracts';

/**
 * Everything the pure policy needs to route one action. The spend numbers are
 * "already moved today / this month" in ILS — supplied by the CALLER (the
 * heartbeat tracks its own executions) until a real money ledger exists to
 * read them from; see route-and-log.ts.
 */
export interface RouteContext {
  mode:             AutonomyMode;
  caps:             AutonomyCaps;
  /** Auto-executed actions since midnight (UTC) — the rate-limit input. */
  todayActionCount: number;
  /** ILS the system already moved today (caller-tracked). */
  todaySpendIls:    number;
  /** ILS the system already moved this calendar month (caller-tracked). */
  monthSpendIls:    number;
}

/**
 * The concrete mode switch a suggestion puts in front of the owner. A
 * SUGGESTION only — the user always chooses; nothing in the system ever
 * changes the mode by itself (D1).
 */
export interface ModeSuggestion {
  to_mode: AutonomyMode;
  reason:  string;   // carries the numbers: "21 ימים ב-propose_approve, 92% אישורים (12/13)"
}

/**
 * assessModeSuggestion's verdict. `suggestion` is present exactly when
 * `eligible` — trust is earned and VISIBLE, so the reason string always
 * carries the evidence (days in mode, approval rate, counts).
 */
export interface ModeSuggestionAssessment {
  eligible:    boolean;
  suggestion?: ModeSuggestion;
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
