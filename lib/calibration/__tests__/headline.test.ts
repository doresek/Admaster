// lib/calibration/__tests__/headline.test.ts
//
// THE HEADLINE BEHAVIOR TEST — the capability's reason to exist
// (VISION-DEEP §8.2.6: delete "uncalibrated confidence").
//
// Scenario: the system is OVERCONFIDENT in 'angle' judgments (says 0.8, is
// right only 55% of the time) and well CALIBRATED in 'offer' judgments (says
// 0.7, is right 70% of the time). C-03 must (a) EXPOSE the gap in the report,
// and (b) CORRECT angle confidence downward via calibrationAdjust while
// leaving offer essentially untouched.

import { describe, expect, it } from 'vitest';
import { buildAdjustmentTable, calibrationAdjust, report } from '../core';
import type { AdjustmentTable, CalibrationSample } from '../types';

// angle: 20 predictions at 0.8; 11 supported, 9 refuted → observed 11/20 = 0.55.
// offer: 20 predictions at 0.7; 14 supported, 6 refuted → observed 14/20 = 0.70.
//
// Bin placement (bins are lo-inclusive [lo, hi)): a prediction of exactly 0.8
// lands in the [0.8, 1.0] bin; 0.7 lands in [0.6, 0.8) — index 3.
const samples: CalibrationSample[] = [
  ...Array.from({ length: 11 }, (): CalibrationSample => ({ domain: 'angle', predicted: 0.8, outcome: 1 })),
  ...Array.from({ length: 9 },  (): CalibrationSample => ({ domain: 'angle', predicted: 0.8, outcome: 0 })),
  ...Array.from({ length: 14 }, (): CalibrationSample => ({ domain: 'offer', predicted: 0.7, outcome: 1 })),
  ...Array.from({ length: 6 },  (): CalibrationSample => ({ domain: 'offer', predicted: 0.7, outcome: 0 })),
];

describe('headline: overconfident angle vs calibrated offer', () => {
  it('the report EXPOSES the overconfidence gap per domain', () => {
    const r = report(samples);

    // Angle: the bin holding the 0.8 predictions says 0.8 but observed 0.55 —
    // a 25-point overconfidence gap, visible as meanPredicted vs observedRate.
    const angleBin = r.byDomain.angle?.bins[4];
    expect(angleBin?.n).toBe(20);
    expect(angleBin?.meanPredicted).toBeCloseTo(0.8, 10);
    expect(angleBin?.observedRate).toBeCloseTo(0.55, 10);

    // Offer: predicted 0.7, observed 0.70 — calibrated, gap ≈ 0.
    const offerBin = r.byDomain.offer?.bins[3];
    expect(offerBin?.n).toBe(20);
    expect(offerBin?.meanPredicted).toBeCloseTo(0.7, 10);
    expect(offerBin?.observedRate).toBeCloseTo(0.7, 10);

    // Brier agrees: the overconfident domain scores strictly worse.
    // angle: (11·0.04 + 9·0.64)/20 = (0.44+5.76)/20 = 6.2/20 = 0.31
    // offer: (14·0.09 + 6·0.49)/20 = (1.26+2.94)/20 = 4.2/20 = 0.21
    expect(r.byDomain.angle?.meanBrier).toBeCloseTo(0.31, 4);
    expect(r.byDomain.offer?.meanBrier).toBeCloseTo(0.21, 4);
    const angleBrier = r.byDomain.angle?.meanBrier;
    const offerBrier = r.byDomain.offer?.meanBrier;
    if (angleBrier === null || angleBrier === undefined || offerBrier === null || offerBrier === undefined) {
      throw new Error('expected meanBrier for both domains');
    }
    expect(angleBrier).toBeGreaterThan(offerBrier);
  });

  it('calibrationAdjust corrects angle downward and leaves offer ~unchanged', () => {
    const table: AdjustmentTable = buildAdjustmentTable(samples); // minPerBin 5 — both bins easily qualify

    const angle = calibrationAdjust(0.8, 'angle', table);
    const offer = calibrationAdjust(0.7, 'offer', table);
    if (!angle.ok || !offer.ok) throw new Error('expected ok adjustments');

    // "When you say 0.8 on angle, history says you mean 0.55."
    expect(angle.value).toBeCloseTo(0.55, 10);
    // A calibrated domain passes through: 0.7 stays 0.7.
    expect(offer.value).toBeCloseTo(0.7, 10);

    // The correction is a real discount, not a nudge.
    expect(angle.value).toBeLessThan(0.8 - 0.2);
    expect(Math.abs(offer.value - 0.7)).toBeLessThan(0.001);
  });
});
