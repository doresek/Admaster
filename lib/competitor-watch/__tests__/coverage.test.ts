// The §3 angle-coverage map + decision logic, over the dental-market fixture.
// The expected outputs are hand-argued in fixtures.ts:
//
//                 E1(כהן)  E2(סמייל)  E3(אינוויז)  → market weight
//   price_deal      ██        ██         █           SATURATED  (own atom 0.80 → warning)
//   authority       —         ██         —           contested
//   speed           —         —          █           thin
//   proof           █(fresh)  —          —           thin  (E3's retired ad = no weight)
//   emotional_safety—         —          —           OPEN  + own atom 0.72 → PRIORITY
//   urgency         —         churned    —           OPEN  + churn evidence → hypothesis

import { describe, expect, it } from 'vitest';
import { buildCoverageMap, strategicFlags } from '../analyze';
import type { CoverageAngle } from '../types';
import { DENTAL_ADS, DENTAL_ENTITIES, E1, E2, E3, NOW, OWN_ANGLES } from './fixtures';

const map = buildCoverageMap(DENTAL_ENTITIES, DENTAL_ADS, OWN_ANGLES, NOW);

const lane = (angle: string): CoverageAngle => {
  const found = map.angles.find((a) => a.angle === angle);
  if (!found) throw new Error(`expected lane '${angle}' in map (got: ${map.angles.map((a) => a.angle).join(', ')})`);
  return found;
};

const cellWeight = (l: CoverageAngle, entityId: string): string | undefined =>
  l.cells.find((c) => c.entity_id === entityId)?.weight;

describe('buildCoverageMap — market weights (skill §3)', () => {
  it('price lane is SATURATED: veterans at E1 and E2 (2 heavy), light at E3', () => {
    const price = lane('price_deal');
    expect(cellWeight(price, E1.id)).toBe('heavy');   // 2 veteran price ads
    expect(cellWeight(price, E2.id)).toBe('heavy');   // 1 veteran price ad
    expect(cellWeight(price, E3.id)).toBe('light');   // 37d active — unproven
    expect(price.market_weight).toBe('saturated');
  });

  it('authority lane is CONTESTED: exactly one heavy entity (E2)', () => {
    const authority = lane('authority_expert');
    expect(cellWeight(authority, E2.id)).toBe('heavy');
    expect(authority.market_weight).toBe('contested');
  });

  it('speed lane is THIN: only light presence (E3, 21d)', () => {
    expect(lane('speed_convenience').market_weight).toBe('thin');
  });

  it('proof lane is THIN, and E3\'s long-lived RETIRED ad carries no weight and no churn', () => {
    const proof = lane('proof_results');
    expect(cellWeight(proof, E1.id)).toBe('light');   // 6d fresh = active-but-unproven
    expect(cellWeight(proof, E3.id)).toBe('none');    // inactive, 92d lifespan → standard
    expect(proof.market_weight).toBe('thin');
    expect(proof.churned_entity_ids).toEqual([]);     // a completed run is NOT churn
  });

  it('emotional-safety lane is OPEN with a supporting atom (0.72 ≥ 0.5) and no churn', () => {
    const em = lane('emotional_safety');
    expect(em.market_weight).toBe('open');
    expect(em.cells.every((c) => c.weight === 'none')).toBe(true);
    expect(em.open_lane).toEqual({ has_supporting_atom: true, churn_evidence: false });
    expect(em.own).toMatchObject({ atom_confidence: 0.72, contested: false, insight_id: 'atom-emsafe' });
  });

  it('urgency lane is OPEN with churn evidence: E2 tried-and-dropped (19d lifespan)', () => {
    const urgency = lane('urgency_scarcity');
    expect(urgency.market_weight).toBe('open');       // churned ads carry no active weight
    expect(urgency.churned_entity_ids).toEqual([E2.id]);
    expect(urgency.open_lane).toEqual({ has_supporting_atom: false, churn_evidence: true });
  });

  it('own price angle is marked contested (heavy competitors in the lane)', () => {
    expect(lane('price_deal').own).toMatchObject({
      atom_confidence: 0.8,
      contested:       true,
      insight_id:      'atom-price',
    });
  });

  it('map ordering is deterministic (taxonomy order)', () => {
    const angles = map.angles.map((a) => a.angle);
    expect(angles.indexOf('price_deal')).toBeLessThan(angles.indexOf('emotional_safety'));
    expect(angles.indexOf('emotional_safety')).toBeLessThan(angles.indexOf('urgency_scarcity'));
  });
});

describe('strategicFlags — the §3 decision logic', () => {
  const flags = strategicFlags(map, DENTAL_ENTITIES);

  it('produces exactly the three expected flags for the fixture market', () => {
    expect(flags.map((f) => `${f.kind}:${f.angle}`).sort()).toEqual([
      'open_lane_hypothesis:urgency_scarcity',
      'open_lane_priority:emotional_safety',
      'saturated_warning:price_deal',
    ]);
  });

  it('open lane + supporting atom → PRIORITY flag citing the atom confidence', () => {
    const priority = flags.find((f) => f.kind === 'open_lane_priority');
    expect(priority?.angle).toBe('emotional_safety');
    expect(priority?.atom_confidence).toBe(0.72);
    expect(priority?.rationale).toContain('0.72');
    expect(priority?.rationale).toContain('נתיב פתוח');
  });

  it('open lane + no atom + churn evidence → HYPOTHESIS flag with a lowered prior, naming who dropped it', () => {
    const hyp = flags.find((f) => f.kind === 'open_lane_hypothesis');
    expect(hyp?.angle).toBe('urgency_scarcity');
    expect(hyp?.entity_ids).toEqual([E2.id]);
    expect(hyp?.rationale).toContain(E2.name);         // cites the evidence
    expect(hyp?.rationale).toContain('ניסו-ונטשו');     // tried-and-dropped
  });

  it('own angle in a saturated lane → WARNING naming the heavy competitors', () => {
    const warn = flags.find((f) => f.kind === 'saturated_warning');
    expect(warn?.angle).toBe('price_deal');
    expect(warn?.entity_ids.sort()).toEqual([E1.id, E2.id].sort());
    expect(warn?.rationale).toContain(E1.name);
    expect(warn?.rationale).toContain(E2.name);
  });

  it('own angle that competitors tried-and-dropped → CHURN warning', () => {
    // Same market, but the client also holds an urgency angle.
    const withUrgency = buildCoverageMap(
      DENTAL_ENTITIES,
      DENTAL_ADS,
      [...OWN_ANGLES, { angle: 'urgency_scarcity', atomConfidence: 0.6, insightId: 'atom-urgency' }],
      NOW,
    );
    const churnFlags = strategicFlags(withUrgency, DENTAL_ENTITIES);
    const churn = churnFlags.find((f) => f.kind === 'churn_warning');
    expect(churn?.angle).toBe('urgency_scarcity');
    expect(churn?.entity_ids).toEqual([E2.id]);
    expect(churn?.rationale).toContain(E2.name);
    // The lane is open AND the client holds an atom there → also a priority
    // flag whose rationale carries the churn caution.
    const priority = churnFlags.find((f) => f.kind === 'open_lane_priority' && f.angle === 'urgency_scarcity');
    expect(priority?.rationale).toContain('זהירות');
  });

  it('a weak own atom (below 0.5) does NOT count as support — the lane stays a hypothesis', () => {
    const weakMap = buildCoverageMap(
      DENTAL_ENTITIES,
      DENTAL_ADS,
      [{ angle: 'emotional_safety', atomConfidence: 0.3, insightId: 'atom-weak' }],
      NOW,
    );
    const em = weakMap.angles.find((a) => a.angle === 'emotional_safety');
    expect(em?.open_lane).toEqual({ has_supporting_atom: false, churn_evidence: false });
    const weakFlags = strategicFlags(weakMap, DENTAL_ENTITIES);
    expect(weakFlags.find((f) => f.angle === 'emotional_safety')?.kind).toBe('open_lane_hypothesis');
  });

  it('contested and thin lanes without own angles produce no flags (no noise)', () => {
    expect(flags.find((f) => f.angle === 'authority_expert')).toBeUndefined();
    expect(flags.find((f) => f.angle === 'speed_convenience')).toBeUndefined();
    expect(flags.find((f) => f.angle === 'proof_results')).toBeUndefined();
  });
});
