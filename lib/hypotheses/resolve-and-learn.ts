// lib/hypotheses/resolve-and-learn.ts
//
// The composition layer: where a verdict becomes LEARNING.
//
//   resolveAndLearn = core.resolve → store.resolveHypothesis (CAS) →
//     one learning_signals row per FROZEN verdict_map move →
//     lib/intelligence/lifecycle.applyLearningSignal per atom (which writes the
//     insight_events audit rows and owns ALL confidence math — nothing here
//     touches confidence directly).
//
// Idempotency: the resolution CAS in the store (status open → resolved) is the
// single gate. Only the caller that wins it emits signals; a replay or a
// concurrent resolver gets the already-persisted resolution back with zero new
// emissions. Each signal row is additionally claimed via `claimSignal` before
// applying, so even a partial replay cannot double-move an atom.
//
// Also home to the duplicate-test guard: `findPriorResolutions` is the
// "already tried" memory — resolved hypotheses overlapping the same atoms —
// and `registerHypothesisChecked` surfaces those priors as WARNINGS (repeating
// a test is sometimes legitimate, e.g. after the market moved; hiding that it
// is a repeat never is).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HYPOTHESIS_COLUMNS,
  type CapabilitySignalType,
  type HypothesisResolution,
  type HypothesisRow,
} from '@/lib/capability-contracts';
import { INSIGHT_COLUMNS, type ClientInsight } from '@/lib/intelligence/types';
import { applyLearningSignal, claimSignal } from '@/lib/intelligence/lifecycle';
import { checkKillRules, resolve, validateRegistration } from './core';
import { getHypothesis, registerHypothesis, resolveHypothesis } from './store';
import {
  RESOLVED_STATUSES,
  type ArmObservation,
  type AtomMoveResult,
  type RegisterHypothesisInput,
  type RegisterHypothesisResult,
  type ResolveAndLearnResult,
} from './types';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── duplicate-test guard ──────────────────────────────────────────────────────

/**
 * The "already tried" memory: resolved hypotheses for this client whose
 * insight_ids overlap the given atoms. Registration surfaces these as warnings
 * so the marketer never unknowingly re-runs a settled (or settled-enough)
 * question — §7's "WHY NOW" starts with knowing what was already asked.
 */
export async function findPriorResolutions(
  supabase:    SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  insightIds:  string[],
): Promise<HypothesisRow[]> {
  if (insightIds.length === 0) return [];

  const { data, error } = await supabase
    .from('hypotheses')
    .select(HYPOTHESIS_COLUMNS)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .in('status', [...RESOLVED_STATUSES])
    .overlaps('insight_ids', insightIds)
    .overrideTypes<HypothesisRow[], { merge: false }>();

  if (error) throw new Error(`findPriorResolutions: ${error.message}`);
  return data ?? [];
}

// ── guarded registration ──────────────────────────────────────────────────────

/**
 * The registration path (spec: `registerHypothesis(input) → Hypothesis`):
 * pure validation first (structured rejection — including the "unresolvable at
 * this budget" math — never a throw), then the duplicate-test guard (priors
 * become warnings, NOT a block), then the append-only insert.
 */
export async function registerHypothesisChecked(
  supabase: SupabaseClient,
  input:    RegisterHypothesisInput,
): Promise<RegisterHypothesisResult> {
  const validation = validateRegistration(input);
  if (!validation.ok) return { ok: false, reasons: validation.reasons };

  const priors = await findPriorResolutions(supabase, input.clientId, input.ownerUserId, input.insightIds);
  const warnings = priors.map(
    (p) =>
      `already tried: hypothesis ${p.id} (${p.status}) tested overlapping atoms — ` +
      `"${p.claim.slice(0, 120)}"`,
  );

  const hypothesis = await registerHypothesis(supabase, input);
  return { ok: true, hypothesis, warnings, priors };
}

// ── resolve + learn ───────────────────────────────────────────────────────────

const SIGNAL_TYPE_FOR_STATUS: Partial<Record<string, CapabilitySignalType>> = {
  supported: 'hypothesis_supported',
  refuted:   'hypothesis_refuted',
};

/** Fetch one atom, explicitly scoped to the hypothesis' client/owner. */
async function fetchAtom(
  supabase:    SupabaseClient,
  insightId:   string,
  clientId:    string,
  ownerUserId: string,
): Promise<ClientInsight | null> {
  const { data, error } = await supabase
    .from('client_insights')
    .select(INSIGHT_COLUMNS)
    .eq('id', insightId)
    .eq('client_id', clientId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
    .overrideTypes<ClientInsight, { merge: false }>();
  if (error) throw new Error(`fetchAtom(${insightId}): ${error.message}`);
  return data;
}

export interface ResolveAndLearnOptions {
  now?:        Date;
  /** Override the resolved_by provenance (kill paths pass killed_mercy / killed_catastrophic). */
  resolvedBy?: HypothesisResolution['resolved_by'];
}

/**
 * Resolve a hypothesis and push its FROZEN atom moves through the lifecycle
 * engine. Verdict → status/resolution persisted once (CAS) → per move: one
 * learning_signals row (signal_type hypothesis_supported / hypothesis_refuted,
 * polarity + weight copied verbatim from the frozen verdict_map, detail =
 * verdict_reason) → claim → applyLearningSignal (audit + confidence live
 * THERE). Per-move failures are recorded as typed outcomes rather than thrown:
 * the resolution is already durable at that point and must not be lost to a
 * partially-failed emission — the unprocessed signal rows remain visible.
 *
 * Idempotent: an already-resolved hypothesis (or a lost CAS) returns the
 * existing resolution with applied=false and ZERO new emissions.
 */
export async function resolveAndLearn(
  supabase:     SupabaseClient,
  hypothesis:   HypothesisRow,
  observations: ArmObservation[],
  options:      ResolveAndLearnOptions = {},
): Promise<ResolveAndLearnResult> {
  const now = options.now ?? new Date();

  // No-op replay guard #1: the row we were handed is already resolved.
  if (hypothesis.status !== 'open') {
    return {
      applied:    false,
      hypothesis,
      status:     hypothesis.status,
      resolution: hypothesis.resolution,
      moves:      [],
    };
  }

  const outcome = resolve(hypothesis, observations, now, options.resolvedBy);

  // No-op replay guard #2 (the authoritative one): the status CAS in the store.
  const persisted = await resolveHypothesis(
    supabase, hypothesis.id, hypothesis.client_id, hypothesis.owner_user_id,
    { status: outcome.status, resolution: outcome.resolution, resolvedAt: now.toISOString() },
  );
  if (!persisted) {
    const existing = await getHypothesis(supabase, hypothesis.id, hypothesis.owner_user_id, hypothesis.client_id);
    const current = existing ?? hypothesis;
    return {
      applied:    false,
      hypothesis: current,
      status:     current.status,
      resolution: current.resolution,
      moves:      [],
    };
  }

  // Emit the frozen moves. `inconclusive` conventionally moves nothing; if a
  // registration DID freeze inconclusive moves, there is no learning_signals
  // signal_type for them (034 CHECK) — record that instead of inventing one.
  const signalType = SIGNAL_TYPE_FOR_STATUS[outcome.status];
  const moves: AtomMoveResult[] = [];

  for (const move of outcome.atomMoves) {
    if (!signalType) {
      moves.push({ insight_id: move.insight_id, signal_id: null, outcome: 'unsupported_verdict',
        note: `no learning_signals type exists for '${outcome.status}' verdicts` });
      continue;
    }

    const atom = await fetchAtom(supabase, move.insight_id, persisted.client_id, persisted.owner_user_id);
    if (!atom) {
      moves.push({ insight_id: move.insight_id, signal_id: null, outcome: 'atom_missing' });
      continue;
    }

    const { data: signalData, error: signalError } = await supabase
      .from('learning_signals')
      .insert({
        client_id:     persisted.client_id,
        owner_user_id: persisted.owner_user_id,
        insight_id:    move.insight_id,
        signal_type:   signalType,
        polarity:      move.polarity,
        weight:        move.weight,
        detail:        outcome.resolution.verdict_reason,
        metrics:       { hypothesis_id: persisted.id, observed: outcome.resolution.observed },
        processed:     false,
      })
      .select('id')
      .single();

    if (signalError || !signalData) {
      console.error('[resolveAndLearn] learning_signals insert failed:', signalError?.message);
      moves.push({ insight_id: move.insight_id, signal_id: null, outcome: 'signal_insert_failed',
        note: signalError?.message });
      continue;
    }
    const signal: { id: string } = signalData;

    // At-most-once per signal row (lifecycle's C4 idempotency claim).
    const won = await claimSignal(supabase, signal.id);
    if (!won) {
      moves.push({ insight_id: move.insight_id, signal_id: signal.id, outcome: 'claim_lost' });
      continue;
    }

    try {
      const updated = await applyLearningSignal(supabase, atom, {
        polarity: move.polarity,
        weight:   move.weight,
        signalId: signal.id,
        reason:   outcome.resolution.verdict_reason,
      });
      moves.push({
        insight_id: move.insight_id,
        signal_id:  signal.id,
        outcome:    updated === null ? 'atom_refuted' : 'applied',
      });
    } catch (e: unknown) {
      // The resolution is already durable; surface the failed move as data so
      // the caller (heartbeat/runner) can retry the atom, not the verdict.
      console.error(`[resolveAndLearn] applyLearningSignal failed for ${move.insight_id}:`, errMessage(e));
      moves.push({ insight_id: move.insight_id, signal_id: signal.id, outcome: 'apply_failed', note: errMessage(e) });
    }
  }

  return { applied: true, hypothesis: persisted, status: persisted.status, resolution: persisted.resolution, moves };
}

// Re-exported so the campaign runner wire-in can poll kill rules and force a
// resolution through the same module without importing core directly.
export { checkKillRules };
