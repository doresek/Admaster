// Kill-rule behavior (creative-testing-discipline §4), tested AT the
// boundaries: mercy is inclusive on sample (≥ multiple × floor) and STRICT on
// performance (< fraction of leader); catastrophic is inclusive on spend with
// exactly zero results; horizon forcing is inclusive at the horizon.

import { describe, it, expect } from 'vitest';
import { checkKillRules } from '../core';
import { floorSpec, hypothesisRow, obs } from './fixtures';

// registered_at fixture is 2026-07-01; keep "now" early so horizon stays quiet
// unless a test targets it. kill_rules fixture: mercy {2×, <50%},
// catastrophic {3× ₪40 = ₪120}, horizon {14d, ₪1000}.
const EARLY = new Date('2026-07-05T00:00:00.000Z');

describe('checkKillRules — none apply', () => {
  it('returns null when arms are healthy, sampled below mercy eligibility and inside the horizon', () => {
    const action = checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 150, conversions: 12, metrics: { cvr: 0.08 } }),
      obs('B', { clicks: 150, conversions: 10, metrics: { cvr: 0.07 } }),
    ], { A: 100, B: 100 }, EARLY);
    expect(action).toBeNull();
  });

  it('ignores non-finite spend values rather than letting them poison a decision', () => {
    const action = checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 50, conversions: 0, metrics: { cvr: 0 } }),
    ], { A: Number.NaN }, EARLY);
    expect(action).toBeNull();
  });
});

describe('checkKillRules — catastrophic (spend, zero results)', () => {
  it('fires at EXACTLY spend_multiple × expected cost with zero results', () => {
    const action = checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 30, conversions: 0, metrics: { cvr: 0 } }),
    ], { A: 120 }, EARLY);
    expect(action).toMatchObject({
      kind: 'kill_arm', rule: 'catastrophic', arm: 'A',
      detail: { spend: 120, threshold: 120, results: 0 },
    });
  });

  it('does not fire one agora below the threshold', () => {
    expect(checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 30, conversions: 0, metrics: { cvr: 0 } }),
    ], { A: 119.99 }, EARLY)).toBeNull();
  });

  it('does not fire with even one result — that is a mercy/verdict question, not a breakage', () => {
    expect(checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 30, conversions: 1, metrics: { cvr: 0.03 } }),
    ], { A: 500 }, EARLY)).toBeNull();
  });

  it('fires for an arm that has spend but NO ingested observations (zero results IS the failure mode)', () => {
    const action = checkKillRules(hypothesisRow(), [], { A: 200 }, EARLY);
    expect(action).toMatchObject({ kind: 'kill_arm', rule: 'catastrophic', arm: 'A' });
  });

  it('counts results by the floor grade (ctr grade → clicks are results)', () => {
    const h = hypothesisRow({ floor_spec: floorSpec({ metric_grade: 'ctr', per_arm: { impressions: 1000 } }) });
    const action = checkKillRules(h, [
      obs('A', { impressions: 4000, clicks: 0, metrics: { ctr: 0 } }),
    ], { A: 150 }, EARLY);
    expect(action).toMatchObject({ rule: 'catastrophic', arm: 'A' });
  });
});

describe('checkKillRules — mercy (enough sample, far behind the leader)', () => {
  const leader = obs('A', { clicks: 400, metrics: { cvr: 0.10 } });

  it('fires at EXACTLY min_floor_multiple × floor when strictly below the leader fraction', () => {
    const action = checkKillRules(hypothesisRow(), [
      leader,
      obs('B', { clicks: 200, metrics: { cvr: 0.049 } }), // exactly 2× floor, 49% of leader
    ], {}, EARLY);
    expect(action).toMatchObject({
      kind: 'kill_arm', rule: 'mercy', arm: 'B',
      detail: { floor_progress: 2, leader_arm: 'A', max_fraction_of_leader: 0.5 },
    });
  });

  it('does NOT fire at exactly the leader fraction (strict <)', () => {
    expect(checkKillRules(hypothesisRow(), [
      leader,
      obs('B', { clicks: 200, metrics: { cvr: 0.05 } }), // exactly 50% of leader
    ], {}, EARLY)).toBeNull();
  });

  it('does NOT fire below the sample eligibility, however bad the arm looks (that is what floors are for)', () => {
    expect(checkKillRules(hypothesisRow(), [
      leader,
      obs('B', { clicks: 199, metrics: { cvr: 0.01 } }), // 1.99× floor
    ], {}, EARLY)).toBeNull();
  });

  it('a genuinely zero-rate arm at eligibility is killable', () => {
    const action = checkKillRules(hypothesisRow(), [
      leader,
      obs('B', { clicks: 200, metrics: { cvr: 0 } }),
    ], {}, EARLY);
    expect(action).toMatchObject({ rule: 'mercy', arm: 'B', detail: { relative_performance: 0 } });
  });

  it('never kills the leader itself', () => {
    const action = checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 400, metrics: { cvr: 0.10 } }),
      obs('B', { clicks: 400, metrics: { cvr: 0.09 } }),
    ], {}, EARLY);
    expect(action).toBeNull();
  });

  it('inverts direction for cost grades: the cpa leader is the CHEAPEST arm', () => {
    const h = hypothesisRow({ floor_spec: floorSpec({ metric_grade: 'cpa', per_arm: { conversions: 10 } }) });
    // leader A at ₪40; B at ₪90 → relative 40/90 ≈ 0.444 < 0.5 → kill B.
    const kill = checkKillRules(h, [
      obs('A', { conversions: 20, metrics: { cpa: 40 } }),
      obs('B', { conversions: 20, metrics: { cpa: 90 } }),
    ], {}, EARLY);
    expect(kill).toMatchObject({ rule: 'mercy', arm: 'B', detail: { leader_arm: 'A' } });
    // B at ₪80 → relative exactly 0.5 → survives (strict <).
    expect(checkKillRules(h, [
      obs('A', { conversions: 20, metrics: { cpa: 40 } }),
      obs('B', { conversions: 20, metrics: { cpa: 80 } }),
    ], {}, EARLY)).toBeNull();
  });

  it('with several qualifying losers, kills the worst one first', () => {
    const action = checkKillRules(hypothesisRow(), [
      leader,
      obs('B', { clicks: 200, metrics: { cvr: 0.045 } }),
      obs('C', { clicks: 200, metrics: { cvr: 0.02 } }),
    ], {}, EARLY);
    expect(action).toMatchObject({ rule: 'mercy', arm: 'C' });
  });
});

describe('checkKillRules — horizon forcing (no zombie tests)', () => {
  const quietObs = [
    obs('A', { clicks: 150, conversions: 10, metrics: { cvr: 0.08 } }),
    obs('B', { clicks: 150, conversions: 9,  metrics: { cvr: 0.07 } }),
  ];

  it('forces resolution at EXACTLY max_days', () => {
    const action = checkKillRules(hypothesisRow(), quietObs, { A: 100, B: 100 },
      new Date('2026-07-15T00:00:00.000Z')); // registered 2026-07-01 → 14.0 days
    expect(action).toMatchObject({
      kind: 'force_resolve', rule: 'horizon',
      detail: { days_elapsed: 14, max_days: 14 },
    });
  });

  it('stays quiet one day before the horizon', () => {
    expect(checkKillRules(hypothesisRow(), quietObs, { A: 100, B: 100 },
      new Date('2026-07-14T00:00:00.000Z'))).toBeNull();
  });

  it('forces resolution when TOTAL spend reaches max_spend', () => {
    const action = checkKillRules(hypothesisRow(), quietObs, { A: 600, B: 400 }, EARLY);
    expect(action).toMatchObject({
      kind: 'force_resolve', rule: 'horizon',
      detail: { total_spend: 1000, max_spend: 1000 },
    });
  });

  it('a broken arm outranks a reached horizon (catastrophic wins precedence)', () => {
    const action = checkKillRules(hypothesisRow(), [
      obs('A', { clicks: 30, conversions: 0, metrics: { cvr: 0 } }),
    ], { A: 1200 }, new Date('2026-08-01T00:00:00.000Z')); // horizon long gone AND catastrophic
    expect(action).toMatchObject({ kind: 'kill_arm', rule: 'catastrophic' });
  });
});
