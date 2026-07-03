// Tests for the PURE routing policy — the policy table IS the spec, so it is
// asserted exhaustively: every (level × kind) cell, the cap boundaries (AT the
// cap executes, one agora over proposes), the protective bypass, the rate
// limit, malformed-input totality, and graduation thresholds.

import { describe, expect, it } from 'vitest';
import type { AutonomyAction, AutonomyLevel, AutonomyRoute, ClientAutonomyRow } from '@/lib/capability-contracts';
import {
  assessGraduation,
  DEFAULT_DAILY_SPEND_CAP_ILS,
  DEFAULT_MAX_DAILY_DELTA_PCT,
  DEFAULT_MONTHLY_SPEND_CAP_ILS,
  GRADUATION_MIN_APPROVALS,
  GRADUATION_MIN_DAYS,
  MAX_ACTIONS_PER_DAY,
  routeAction,
} from '../policy';
import type { RouteContext } from '../types';

const act = (
  kind:    AutonomyAction['kind'],
  impact?: { spend_ils?: number; delta_pct?: number },
): AutonomyAction => ({
  kind,
  rationale:   'CTR collapsed 40% over 3 days',
  grounded_in: ['insight-1'],
  ...(impact !== undefined ? { impact } : {}),
});

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  level:            'L1',
  caps:             {},
  todayActionCount: 0,
  todaySpendIls:    0,
  monthSpendIls:    0,
  ...over,
});

// ── THE POLICY TABLE — every (level × kind) cell, in-caps context ─────────────

type Verdict = AutonomyRoute['route'];

/** The spec grid: modest in-caps impact (spend 10 ILS, delta 5%), count 0. */
const POLICY_TABLE: Array<[AutonomyLevel, AutonomyAction['kind'], Verdict]> = [
  // L0 — draft mode: the system may only ask, for EVERYTHING (even pause).
  ['L0', 'publish_organic',    'propose'],
  ['L0', 'create_paid_paused', 'propose'],
  ['L0', 'pause_paid',         'propose'],
  ['L0', 'unpause_paid',       'propose'],
  ['L0', 'reallocate_budget',  'propose'],
  ['L0', 'send_message',       'propose'],
  ['L0', 'propose_only',       'propose'],
  // L1 — default: no-money kinds execute; money kinds ask; pause protects.
  ['L1', 'publish_organic',    'execute'],
  ['L1', 'create_paid_paused', 'execute'],
  ['L1', 'pause_paid',         'execute'],
  ['L1', 'unpause_paid',       'propose'],
  ['L1', 'reallocate_budget',  'propose'],
  ['L1', 'send_message',       'propose'],
  ['L1', 'propose_only',       'propose'],
  // L2 — money kinds execute within caps (this grid is within caps).
  ['L2', 'publish_organic',    'execute'],
  ['L2', 'create_paid_paused', 'execute'],
  ['L2', 'pause_paid',         'execute'],
  ['L2', 'unpause_paid',       'execute'],
  ['L2', 'reallocate_budget',  'execute'],
  ['L2', 'send_message',       'execute'],
  ['L2', 'propose_only',       'propose'],
  // L3 — as L2 (monthly budget the only spend bound; still within here).
  ['L3', 'publish_organic',    'execute'],
  ['L3', 'create_paid_paused', 'execute'],
  ['L3', 'pause_paid',         'execute'],
  ['L3', 'unpause_paid',       'execute'],
  ['L3', 'reallocate_budget',  'execute'],
  ['L3', 'send_message',       'execute'],
  ['L3', 'propose_only',       'propose'],
];

describe('routeAction — the policy table', () => {
  it.each(POLICY_TABLE)('%s × %s → %s', (level, kind, expected) => {
    const result = routeAction(
      act(kind, { spend_ils: 10, delta_pct: 5 }),
      ctx({ level }),
    );
    expect(result.route).toBe(expected);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('unknown level is treated as L0 (assume no trust)', () => {
    const garbageLevel: AutonomyLevel = JSON.parse('"L9"');
    expect(routeAction(act('publish_organic'), ctx({ level: garbageLevel })).route).toBe('propose');
    expect(routeAction(act('pause_paid'), ctx({ level: garbageLevel })).route).toBe('propose');
  });
});

// ── Cap boundaries — AT the cap executes, one agora over proposes ─────────────

describe('routeAction — L2 caps', () => {
  it('spend exactly AT the remaining daily cap executes', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: 60 }),
      ctx({ level: 'L2', caps: { daily_spend_cap: 100 }, todaySpendIls: 40 }),
    );
    expect(r.route).toBe('execute');
  });

  it('one agora over the remaining daily cap proposes, with cap + number in the reason', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: 60.01 }),
      ctx({ level: 'L2', caps: { daily_spend_cap: 100 }, todaySpendIls: 40 }),
    );
    expect(r.route).toBe('propose');
    expect(r.reason).toContain('60.01');
    expect(r.reason).toContain('100');
    expect(r.reason).toContain('60'); // the remaining amount
  });

  it('spend exactly AT the remaining monthly cap executes; over proposes', () => {
    const base = ctx({ level: 'L2', caps: { monthly_spend_cap: 2000 }, monthSpendIls: 1990 });
    expect(routeAction(act('reallocate_budget', { spend_ils: 10 }), base).route).toBe('execute');
    const over = routeAction(act('reallocate_budget', { spend_ils: 10.01 }), base);
    expect(over.route).toBe('propose');
    expect(over.reason).toContain('2000');
    expect(over.reason).toContain('10.01');
  });

  it('delta exactly AT the cap executes; 25.1 proposes', () => {
    const base = ctx({ level: 'L2', caps: { max_daily_delta_pct: 25 } });
    expect(routeAction(act('reallocate_budget', { delta_pct: 25 }), base).route).toBe('execute');
    const over = routeAction(act('reallocate_budget', { delta_pct: 25.1 }), base);
    expect(over.route).toBe('propose');
    expect(over.reason).toContain('25.1');
    expect(over.reason).toContain('25');
  });

  it('absent caps fall back to the conservative defaults (100 / 2000 / 25)', () => {
    const l2 = ctx({ level: 'L2' });
    expect(routeAction(act('unpause_paid', { spend_ils: DEFAULT_DAILY_SPEND_CAP_ILS }), l2).route).toBe('execute');
    expect(routeAction(act('unpause_paid', { spend_ils: DEFAULT_DAILY_SPEND_CAP_ILS + 0.01 }), l2).route).toBe('propose');
    expect(routeAction(act('send_message', { delta_pct: DEFAULT_MAX_DAILY_DELTA_PCT + 0.1 }), l2).route).toBe('propose');
    expect(
      routeAction(act('unpause_paid', { spend_ils: 60 }), ctx({ level: 'L2', monthSpendIls: DEFAULT_MONTHLY_SPEND_CAP_ILS - 50 })).route,
    ).toBe('propose'); // only 50 ILS left of the default monthly cap
  });

  it('an owner-set cap of 0 is a freeze: any positive spend proposes, zero-spend executes', () => {
    const frozen = ctx({ level: 'L2', caps: { daily_spend_cap: 0 } });
    expect(routeAction(act('unpause_paid', { spend_ils: 1 }), frozen).route).toBe('propose');
    expect(routeAction(act('send_message'), frozen).route).toBe('execute');
  });

  it('unknown spend context proposes (caps we cannot verify are caps exceeded)', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: 50 }),
      ctx({ level: 'L2', todaySpendIls: Number.NaN }),
    );
    expect(r.route).toBe('propose');
    expect(r.reason).toContain('spend context unavailable');
  });
});

describe('routeAction — L3 caps', () => {
  it('ignores the daily cap: spend over the daily default executes when the month allows', () => {
    const r = routeAction(act('unpause_paid', { spend_ils: 500 }), ctx({ level: 'L3' }));
    expect(r.route).toBe('execute'); // 500 > default daily 100, but L3 is monthly-bounded
  });

  it('still bounded by the monthly cap: over proposes with the numbers', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: DEFAULT_MONTHLY_SPEND_CAP_ILS + 0.01 }),
      ctx({ level: 'L3' }),
    );
    expect(r.route).toBe('propose');
    expect(r.reason).toContain(String(DEFAULT_MONTHLY_SPEND_CAP_ILS));
  });

  it('delta cap still applies at L3 (thrash protection is not a trust question)', () => {
    const r = routeAction(act('reallocate_budget', { delta_pct: 25.1 }), ctx({ level: 'L3' }));
    expect(r.route).toBe('propose');
    expect(r.reason).toContain('25.1');
  });
});

// ── Protective bypass ─────────────────────────────────────────────────────────

describe('routeAction — protective bypass (pause_paid)', () => {
  it('executes at L1/L2/L3 even with impact far over every cap', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const r = routeAction(
        act('pause_paid', { spend_ils: 999_999, delta_pct: 100 }),
        ctx({ level, todaySpendIls: 5000, monthSpendIls: 50_000 }),
      );
      expect(r.route).toBe('execute');
      expect(r.reason).toContain('protective');
    }
  });

  it('bypasses the rate limit too — a pause can only stop spend', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const r = routeAction(act('pause_paid'), ctx({ level, todayActionCount: MAX_ACTIONS_PER_DAY + 5 }));
      expect(r.route).toBe('execute');
    }
  });

  it('at L0 even pause is a proposal (L0 has no execution authority)', () => {
    expect(routeAction(act('pause_paid'), ctx({ level: 'L0' })).route).toBe('propose');
  });

  it('at L0 under the rate limit even pause blocks (no execute authority to protect with)', () => {
    expect(routeAction(act('pause_paid'), ctx({ level: 'L0', todayActionCount: MAX_ACTIONS_PER_DAY })).route).toBe('block');
  });
});

// ── Rate limit ────────────────────────────────────────────────────────────────

describe('routeAction — rate limit', () => {
  it('count 19 still routes normally; count 20 (the 21st action) blocks', () => {
    expect(
      routeAction(act('publish_organic'), ctx({ todayActionCount: MAX_ACTIONS_PER_DAY - 1 })).route,
    ).toBe('execute');
    const blocked = routeAction(act('publish_organic'), ctx({ todayActionCount: MAX_ACTIONS_PER_DAY }));
    expect(blocked.route).toBe('block');
    expect(blocked.reason).toContain(String(MAX_ACTIONS_PER_DAY));
  });

  it('blocks everything at every level — including propose_only (a looping system must not spam either)', () => {
    for (const level of ['L0', 'L1', 'L2', 'L3'] as const) {
      for (const kind of ['publish_organic', 'unpause_paid', 'propose_only'] as const) {
        expect(routeAction(act(kind), ctx({ level, todayActionCount: 25 })).route).toBe('block');
      }
    }
  });

  it('pause still executes past the limit at L1+ (covered above), and unknown count blocks', () => {
    expect(routeAction(act('pause_paid'), ctx({ level: 'L2', todayActionCount: 25 })).route).toBe('execute');
    const blind = routeAction(act('publish_organic'), ctx({ todayActionCount: Number.NaN }));
    expect(blind.route).toBe('block');
    expect(blind.reason).toContain('unavailable');
  });
});

// ── Malformed inputs — block, never throw (totality) ─────────────────────────

describe('routeAction — malformed actions', () => {
  const malformed: Array<[string, AutonomyAction]> = [
    ['unknown kind',        JSON.parse('{"kind":"delete_account","rationale":"r","grounded_in":[]}')],
    ['empty kind',          JSON.parse('{"kind":"","rationale":"r","grounded_in":[]}')],
    ['non-string kind',     JSON.parse('{"kind":123,"rationale":"r","grounded_in":[]}')],
    ['missing rationale',   JSON.parse('{"kind":"publish_organic","grounded_in":[]}')],
    ['empty rationale',     { ...act('publish_organic'), rationale: '' }],
    ['blank rationale',     { ...act('publish_organic'), rationale: '   ' }],
    ['grounded_in not array', JSON.parse('{"kind":"publish_organic","rationale":"r","grounded_in":"insight-1"}')],
    ['negative spend',      act('unpause_paid', { spend_ils: -5 })],
    ['NaN spend',           act('unpause_paid', { spend_ils: Number.NaN })],
    ['Infinity spend',      act('unpause_paid', { spend_ils: Number.POSITIVE_INFINITY })],
    ['negative delta',      act('reallocate_budget', { delta_pct: -1 })],
    ['NaN delta',           act('reallocate_budget', { delta_pct: Number.NaN })],
    ['null action',         JSON.parse('null')],
  ];

  it.each(malformed)('%s → block at every level, never a throw', (_label, action) => {
    for (const level of ['L0', 'L1', 'L2', 'L3'] as const) {
      const r = routeAction(action, ctx({ level }));
      expect(r.route).toBe('block');
      expect(r.reason).toContain('malformed');
    }
  });

  it('a malformed pause is blocked too — garbage is more likely a bug than a rescue', () => {
    const r = routeAction(act('pause_paid', { spend_ils: Number.NaN }), ctx({ level: 'L2' }));
    expect(r.route).toBe('block');
  });
});

// ── Graduation ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-03T12:00:00.000Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const gradRow = (over: Partial<ClientAutonomyRow> = {}): ClientAutonomyRow => ({
  id:                 'aut-1',
  client_id:          'client-1',
  owner_user_id:      'user-1',
  level:              'L1',
  caps:               {},
  approvals_total:    13,
  approvals_approved: 12,
  level_since:        daysAgo(21),
  created_at:         daysAgo(30),
  updated_at:         daysAgo(1),
  ...over,
});

describe('assessGraduation', () => {
  it('proposes the next level when earned, with the numbers in the reason', () => {
    const a = assessGraduation(gradRow(), NOW); // 21 days, 12/13 ≈ 92%
    expect(a.eligible).toBe(true);
    expect(a.proposal?.to_level).toBe('L2');
    expect(a.proposal?.reason).toContain('21');
    expect(a.proposal?.reason).toContain('L1');
    expect(a.proposal?.reason).toContain('92');
    expect(a.proposal?.reason).toContain('12/13');
    expect(a.proposal?.reason).toContain('L2');
  });

  it('exactly at every threshold is eligible (14 days, 10 approvals, 90%)', () => {
    const a = assessGraduation(
      gradRow({ level_since: daysAgo(GRADUATION_MIN_DAYS), approvals_total: GRADUATION_MIN_APPROVALS, approvals_approved: 9 }),
      NOW,
    );
    expect(a.eligible).toBe(true);
  });

  it('13 days is not enough', () => {
    expect(assessGraduation(gradRow({ level_since: daysAgo(13) }), NOW).eligible).toBe(false);
  });

  it('9 decided approvals is not enough, even at 100%', () => {
    expect(
      assessGraduation(gradRow({ approvals_total: 9, approvals_approved: 9 }), NOW).eligible,
    ).toBe(false);
  });

  it('89.9% approval rate is not enough; 90.0% is', () => {
    expect(
      assessGraduation(gradRow({ approvals_total: 1000, approvals_approved: 899 }), NOW).eligible,
    ).toBe(false);
    expect(
      assessGraduation(gradRow({ approvals_total: 1000, approvals_approved: 900 }), NOW).eligible,
    ).toBe(true);
  });

  it('L3 never proposes higher, whatever the stats', () => {
    const a = assessGraduation(gradRow({ level: 'L3', approvals_total: 100, approvals_approved: 100 }), NOW);
    expect(a.eligible).toBe(false);
    expect(a.proposal).toBeUndefined();
  });

  it('walks the ladder: L0→L1, L2→L3', () => {
    expect(assessGraduation(gradRow({ level: 'L0' }), NOW).proposal?.to_level).toBe('L1');
    expect(assessGraduation(gradRow({ level: 'L2' }), NOW).proposal?.to_level).toBe('L3');
  });

  it('unparsable level_since is never eligible (no autonomy on unreadable data)', () => {
    expect(assessGraduation(gradRow({ level_since: 'not-a-date' }), NOW).eligible).toBe(false);
  });
});
