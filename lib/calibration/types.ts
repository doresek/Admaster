// lib/calibration/types.ts
//
// Shared vocabulary for C-03 calibration tracking (MARKETING-CAPABILITIES-SPEC
// §C-03, VISION-DEEP §8.2.6 "uncalibrated confidence").
//
// Calibration answers one question: when the system said 0.8 confidence, was
// it right 80% of the time? — per judgment domain, so an overconfident domain
// gets its confidence discounted while a well-calibrated one is left alone.
//
// The unit of evidence is a RESOLVED hypothesis (C-01): its frozen
// prediction.confidence is the system's stated belief; supported/refuted is
// the binary outcome. Everything downstream (Brier scores, reliability bins,
// the adjustment table) is pure math over those samples.

import type { HypothesisDomain } from '@/lib/capability-contracts';

/**
 * Result shape for the total math functions. Calibration math must NEVER let
 * a NaN escape into confidence arithmetic (a NaN-poisoned confidence would
 * silently corrupt every downstream decision weight), so functions that can
 * receive garbage return a typed error instead of throwing or producing NaN.
 */
export type CalibrationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** One scored prediction: what the system believed vs what actually happened. */
export interface CalibrationSample {
  domain:    HypothesisDomain;
  /** The frozen prediction.confidence at registration, in [0..1]. */
  predicted: number;
  /** 1 = claim supported, 0 = claim refuted. */
  outcome:   0 | 1;
}

/**
 * Why a hypothesis contributed no calibration sample. Kept as a closed union
 * so callers (and tests) can assert the exact exclusion semantics.
 */
export type SampleExclusionReason =
  | 'status_open'          // no verdict yet — says nothing about judgment
  | 'status_inconclusive'  // floors unmet — a non-answer, not a wrong answer
  | 'status_killed'        // killed on kill rules — not a verdict on the claim
  | 'status_superseded'    // replaced before resolution — never scored
  | 'missing_confidence'   // prediction carried no confidence to score against
  | 'invalid_confidence';  // confidence outside [0..1] or non-finite

/** Discriminated result of mapping a hypothesis to a sample. */
export type ToSampleResult =
  | { readonly sample: CalibrationSample; readonly reason: null }
  | { readonly sample: null; readonly reason: SampleExclusionReason };

/**
 * One reliability bin: predictions whose confidence fell in [lo, hi).
 * Empty bins are PRESENT with n = 0 and null aggregates — consumers (UI,
 * adjustment builder) always see the same stable shape.
 */
export interface CalibrationBin {
  lo:            number;
  hi:            number;
  n:             number;
  /** Mean of the predicted confidences in the bin; null when n = 0. */
  meanPredicted: number | null;
  /** Fraction of bin samples that were supported; null when n = 0. */
  observedRate:  number | null;
}

/** Calibration summary for one slice (overall, or one domain). */
export interface CalibrationSlice {
  n:         number;
  /** Mean Brier score over the slice; null (never NaN) when n = 0. */
  meanBrier: number | null;
  bins:      CalibrationBin[];
}

/** The full report: overall calibration plus the same shape per domain seen. */
export interface CalibrationReport {
  overall:  CalibrationSlice;
  byDomain: Partial<Record<HypothesisDomain, CalibrationSlice>>;
}

/**
 * One bin of the confidence→confidence correction map. `adjusted` is the
 * isotonic-pooled observed rate for the bin, or null when the bin had fewer
 * than `minPerBin` samples (insufficient data — consumers fall back).
 */
export interface AdjustmentBin {
  lo:       number;
  hi:       number;
  n:        number;
  adjusted: number | null;
}

/**
 * The published correction table `calibrationAdjust` consumes. Recomputed
 * periodically (heartbeat wire-in) from the rolling sample window.
 */
export interface AdjustmentTable {
  overall:   AdjustmentBin[];
  byDomain:  Partial<Record<HypothesisDomain, AdjustmentBin[]>>;
  /** The evidence floor a bin needed before its correction was trusted. */
  minPerBin: number;
}
