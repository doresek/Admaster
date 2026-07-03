// lib/calibration — C-03 calibration tracking (public surface).
//
// "When the system said 0.8 confidence, was it right 80% of the time?" —
// Brier-scores every resolved hypothesis prediction, per judgment domain, and
// publishes a correction table so overconfident domains get their confidence
// discounted (MARKETING-CAPABILITIES-SPEC §C-03, VISION-DEEP §8.2.6).
//
// Pure math lives in ./core (fully unit-tested, zero I/O); DB access lives in
// ./store. Consumers typically: loadSamples → report (the trust surface) and
// buildAdjustmentTable → calibrationAdjust (the correction), plus stampBrier
// at hypothesis-resolution time.

import type { SupabaseClient } from '@supabase/supabase-js';
import { report } from './core';
import { loadSamples, type CalibrationDb, type LoadSamplesScope } from './store';
import type { CalibrationReport } from './types';

export {
  ADJUST_MAX,
  ADJUST_MIN,
  brier,
  binSamples,
  buildAdjustmentTable,
  calibrationAdjust,
  DEFAULT_BIN_EDGES,
  poolAdjacentViolators,
  report,
  toSample,
  type BuildAdjustmentOptions,
  type CalibrationHypothesis,
} from './core';

export { loadSamples, stampBrier, type CalibrationDb, type LoadSamplesScope } from './store';

export type {
  AdjustmentBin,
  AdjustmentTable,
  CalibrationBin,
  CalibrationReport,
  CalibrationResult,
  CalibrationSample,
  CalibrationSlice,
  SampleExclusionReason,
  ToSampleResult,
} from './types';

/**
 * Convenience composition: load the scope's rolling-window samples and build
 * the calibration report in one call — the shape the command center surfaces
 * ("המערכת צדקה ב-78% מתחזיות ה-0.8 שלה").
 */
export async function calibrationReport(
  supabase: SupabaseClient | CalibrationDb,
  scope: LoadSamplesScope,
): Promise<CalibrationReport> {
  const samples = await loadSamples(supabase, scope);
  return report(samples);
}
