import { describe, expect, it } from 'vitest';
import { EXPLORE_SHARE, MATURE_BRIDGE_CONFIDENCE, assessMaturity } from '../maturity';
import { atom, bridgeAtoms } from './fixtures';

describe('assessMaturity — proven bridge atoms → explore share (skill §5)', () => {
  it('0 high-confidence bridge atoms → new, 50% explore', () => {
    const m = assessMaturity([atom({ layer: 'business', confidence: 0.9 })]);
    expect(m).toEqual({ maturity: 'new', high_confidence_bridge_atoms: 0, explore_share: 0.5 });
  });

  it('2 high-confidence bridge atoms → developing, 30% explore', () => {
    const m = assessMaturity(bridgeAtoms(2));
    expect(m).toEqual({ maturity: 'developing', high_confidence_bridge_atoms: 2, explore_share: 0.3 });
  });

  it('3 high-confidence bridge atoms → mature, 20% explore — the floor is NEVER zero', () => {
    const m = assessMaturity(bridgeAtoms(3));
    expect(m).toEqual({ maturity: 'mature', high_confidence_bridge_atoms: 3, explore_share: 0.2 });
    // Zero exploration = fatigue cliff with no successor ready (§5).
    for (const share of Object.values(EXPLORE_SHARE)) expect(share).toBeGreaterThan(0);
  });

  it('bridge atoms below the confidence bar do not count as proven', () => {
    const m = assessMaturity(bridgeAtoms(3, MATURE_BRIDGE_CONFIDENCE - 0.01));
    expect(m.maturity).toBe('new');
  });

  it('non-bridge layers never confer maturity, however confident', () => {
    const m = assessMaturity([
      atom({ layer: 'business', confidence: 0.99 }),
      atom({ layer: 'customers', confidence: 0.99 }),
      atom({ layer: 'customers', confidence: 0.99 }),
    ]);
    expect(m.maturity).toBe('new');
  });

  it('inactive and broken-confidence atoms never count (total math)', () => {
    const m = assessMaturity([
      ...bridgeAtoms(2),
      atom({ layer: 'bridge', confidence: 0.9, status: 'superseded' }),
      atom({ layer: 'bridge', confidence: Number.NaN }),
    ]);
    expect(m.maturity).toBe('developing');
    expect(m.high_confidence_bridge_atoms).toBe(2);
  });
});
