// Tests for the PURE routing policy — the policy table IS the spec, so it is
// asserted exhaustively: every (mode × kind) cell, the cap boundaries (AT the
// cap executes, one agora over proposes), the protective bypass, the rate
// limit, malformed-input totality, and the mode-suggestion thresholds.

import { describe, expect, it } from 'vitest';
import type { AutonomyAction, AutonomyMode, AutonomyRoute, ClientAutonomyRow } from '@/lib/capability-contracts';
import {
  assessModeSuggestion,
  DEFAULT_DAILY_SPEND_CAP_ILS,
  DEFAULT_MAX_DAILY_DELTA_PCT,
  DEFAULT_MONTHLY_SPEND_CAP_ILS,
  MAX_ACTIONS_PER_DAY,
  routeAction,
  SUGGESTION_MIN_APPROVALS,
  SUGGESTION_MIN_DAYS,
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
  mode:             'propose_approve',
  caps:             {},
  todayActionCount: 0,
  todaySpendIls:    0,
  monthSpendIls:    0,
  ...over,
});

// ── THE POLICY TABLE — every (mode × kind) cell, in-caps context ──────────────

type Verdict = AutonomyRoute['route'];

/** The spec grid: modest in-caps impact (spend 10 ILS, delta 5%), count 0. */
const POLICY_TABLE: Array<[AutonomyMode, AutonomyAction['kind'], Verdict]> = [
  // draft_only — system prepares, user does everything: only asks (even pause).
  ['draft_only', 'publish_organic',    'propose'],
  ['draft_only', 'create_paid_paused', 'propose'],
  ['draft_only', 'pause_paid',         'propose'],
  ['draft_only', 'unpause_paid',       'propose'],
  ['draft_only', 'reallocate_budget',  'propose'],
  ['draft_only', 'send_message',       'propose'],
  ['draft_only', 'propose_only',       'propose'],
  // propose_approve (DEFAULT) — no-money kinds execute; money kinds ask;
  // pause protects.
  ['propose_approve', 'publish_organic',    'execute'],
  ['propose_approve', 'create_paid_paused', 'execute'],
  ['propose_approve', 'pause_paid',         'execute'],
  ['propose_approve', 'unpause_paid',       'propose'],
  ['propose_approve', 'reallocate_budget',  'propose'],
  ['propose_approve', 'send_message',       'propose'],
  ['propose_approve', 'propose_only',       'propose'],
  // act_within_caps — money kinds execute within caps (this grid is within).
  ['act_within_caps', 'publish_organic',    'execute'],
  ['act_within_caps', 'create_paid_paused', 'execute'],
  ['act_within_caps', 'pause_paid',         'execute'],
  ['act_within_caps', 'unpause_paid',       'execute'],
  ['act_within_caps', 'reallocate_budget',  'execute'],
  ['act_within_caps', 'send_message',       'execute'],
  ['act_within_caps', 'propose_only',       'propose'],
];

describe('routeAction — the policy table', () => {
  it.each(POLICY_TABLE)('%s × %s → %s', (mode, kind, expected) => {
    const result = routeAction(
      act(kind, { spend_ils: 10, delta_pct: 5 }),
      ctx({ mode }),
    );
    expect(result.route).toBe(expected);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('unknown mode is treated as draft_only (assume no trust)', () => {
    const garbageMode: AutonomyMode = JSON.parse('"turbo_mode"');
    expect(routeAction(act('publish_organic'), ctx({ mode: garbageMode })).route).toBe('propose');
    expect(routeAction(act('pause_paid'), ctx({ mode: garbageMode })).route).toBe('propose');
  });
});

// ── Cap boundaries — AT the cap executes, one agora over proposes ─────────────

describe('routeAction — act_within_caps caps', () => {
  it('spend exactly AT the remaining daily cap executes', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: 60 }),
      ctx({ mode: 'act_within_caps', caps: { daily_spend_cap: 100 }, todaySpendIls: 40 }),
    );
    expect(r.route).toBe('execute');
  });

  it('one agora over the remaining daily cap proposes, with cap + number in the reason', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: 60.01 }),
      ctx({ mode: 'act_within_caps', caps: { daily_spend_cap: 100 }, todaySpendIls: 40 }),
    );
    expect(r.route).toBe('propose');
    expect(r.reason).toContain('60.01');
    expect(r.reason).toContain('100');
    expect(r.reason).toContain('60'); // the remaining amount
  });

  it('spend exactly AT the remaining monthly cap executes; over proposes', () => {
    const base = ctx({ mode: 'act_within_caps', caps: { monthly_spend_cap: 2000 }, monthSpendIls: 1990 });
    expect(routeAction(act('reallocate_budget', { spend_ils: 10 }), base).route).toBe('execute');
    const over = routeAction(act('reallocate_budget', { spend_ils: 10.01 }), base);
    expect(over.route).toBe('propose');
    expect(over.reason).toContain('2000');
    expect(over.reason).toContain('10.01');
  });

  it('delta exactly AT the cap executes; 25.1 proposes', () => {
    const base = ctx({ mode: 'act_within_caps', caps: { max_daily_delta_pct: 25 } });
    expect(routeAction(act('reallocate_budget', { delta_pct: 25 }), base).route).toBe('execute');
    const over = routeAction(act('reallocate_budget', { delta_pct: 25.1 }), base);
    expect(over.route).toBe('propose');
    expect(over.reason).toContain('25.1');
    expect(over.reason).toContain('25');
  });

  it('absent caps fall back to the conservative defaults (100 / 2000 / 25)', () => {
    const awc = ctx({ mode: 'act_within_caps' });
    expect(routeAction(act('unpause_paid', { spend_ils: DEFAULT_DAILY_SPEND_CAP_ILS }), awc).route).toBe('execute');
    expect(routeAction(act('unpause_paid', { spend_ils: DEFAULT_DAILY_SPEND_CAP_ILS + 0.01 }), awc).route).toBe('propose');
    expect(routeAction(act('send_message', { delta_pct: DEFAULT_MAX_DAILY_DELTA_PCT + 0.1 }), awc).route).toBe('propose');
    expect(
      routeAction(
        act('unpause_paid', { spend_ils: 60 }),
        ctx({ mode: 'act_within_caps', monthSpendIls: DEFAULT_MONTHLY_SPEND_CAP_ILS - 50 }),
      ).route,
    ).toBe('propose'); // only 50 ILS left of the default monthly cap
  });

  it('an owner-set cap of 0 is a freeze: any positive spend proposes, zero-spend executes', () => {
    const frozen = ctx({ mode: 'act_within_caps', caps: { daily_spend_cap: 0 } });
    expect(routeAction(act('unpause_paid', { spend_ils: 1 }), frozen).route).toBe('propose');
    expect(routeAction(act('send_message'), frozen).route).toBe('execute');
  });

  it('unknown spend context proposes (caps we cannot verify are caps exceeded)', () => {
    const r = routeAction(
      act('unpause_paid', { spend_ils: 50 }),
      ctx({ mode: 'act_within_caps', todaySpendIls: Number.NaN }),
    );
    expect(r.route).toBe('propose');
    expect(r.reason).toContain('spend context unavailable');
  });
});

// ── Protective bypass ─────────────────────────────────────────────────────────

describe('routeAction — protective bypass (pause_paid)', () => {
  it('executes in propose_approve and act_within_caps even with impact far over every cap', () => {
    for (const mode of ['propose_approve', 'act_within_caps'] as const) {
      const r = routeAction(
        act('pause_paid', { spend_ils: 999_999, delta_pct: 100 }),
        ctx({ mode, todaySpendIls: 5000, monthSpendIls: 50_000 }),
      );
      expect(r.route).toBe('execute');
      expect(r.reason).toContain('protective');
    }
  });

  it('bypasses the rate limit too — a pause can only stop spend', () => {
    for (const mode of ['propose_approve', 'act_within_caps'] as const) {
      const r = routeAction(act('pause_paid'), ctx({ mode, todayActionCount: MAX_ACTIONS_PER_DAY + 5 }));
      expect(r.route).toBe('execute');
    }
  });

  it('in draft_only even pause is a proposal (that mode has no execution authority)', () => {
    expect(routeAction(act('pause_paid'), ctx({ mode: 'draft_only' })).route).toBe('propose');
  });

  it('in draft_only under the rate limit even pause blocks (no execute authority to protect with)', () => {
    expect(
      routeAction(act('pause_paid'), ctx({ mode: 'draft_only', todayActionCount: MAX_ACTIONS_PER_DAY })).route,
    ).toBe('block');
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

  it('blocks everything in every mode — including propose_only (a looping system must not spam either)', () => {
    for (const mode of ['draft_only', 'propose_approve', 'act_within_caps'] as const) {
      for (const kind of ['publish_organic', 'unpause_paid', 'propose_only'] as const) {
        expect(routeAction(act(kind), ctx({ mode, todayActionCount: 25 })).route).toBe('block');
      }
    }
  });

  it('pause still executes past the limit outside draft_only, and unknown count blocks', () => {
    expect(routeAction(act('pause_paid'), ctx({ mode: 'act_within_caps', todayActionCount: 25 })).route).toBe('execute');
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

  it.each(malformed)('%s → block in every mode, never a throw', (_label, action) => {
    for (const mode of ['draft_only', 'propose_approve', 'act_within_caps'] as const) {
      const r = routeAction(action, ctx({ mode }));
      expect(r.route).toBe('block');
      expect(r.reason).toContain('malformed');
    }
  });

  it('a malformed pause is blocked too — garbage is more likely a bug than a rescue', () => {
    const r = routeAction(act('pause_paid', { spend_ils: Number.NaN }), ctx({ mode: 'act_within_caps' }));
    expect(r.route).toBe('block');
  });
});

// ── Mode suggestion (the system only ever SUGGESTS — the owner decides) ──────

const NOW = new Date('2026-07-03T12:00:00.000Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const trustRow = (over: Partial<ClientAutonomyRow> = {}): ClientAutonomyRow => ({
  id:                 'aut-1',
  client_id:          'client-1',
  owner_user_id:      'user-1',
  mode:               'propose_approve',
  caps:               {},
  approvals_total:    13,
  approvals_approved: 12,
  mode_since:         daysAgo(21),
  created_at:         daysAgo(30),
  updated_at:         daysAgo(1),
  ...over,
});

describe('assessModeSuggestion', () => {
  it('suggests the next mode when earned, with the numbers in the reason', () => {
    const a = assessModeSuggestion(trustRow(), NOW); // 21 days, 12/13 ≈ 92%
    expect(a.eligible).toBe(true);
    expect(a.suggestion?.to_mode).toBe('act_within_caps');
    expect(a.suggestion?.reason).toContain('21');
    expect(a.suggestion?.reason).toContain('propose_approve');
    expect(a.suggestion?.reason).toContain('92');
    expect(a.suggestion?.reason).toContain('12/13');
    expect(a.suggestion?.reason).toContain('act_within_caps');
  });

  it('exactly at every threshold is eligible (14 days, 10 approvals, 90%)', () => {
    const a = assessModeSuggestion(
      trustRow({ mode_since: daysAgo(SUGGESTION_MIN_DAYS), approvals_total: SUGGESTION_MIN_APPROVALS, approvals_approved: 9 }),
      NOW,
    );
    expect(a.eligible).toBe(true);
  });

  it('13 days is not enough', () => {
    expect(assessModeSuggestion(trustRow({ mode_since: daysAgo(13) }), NOW).eligible).toBe(false);
  });

  it('9 decided approvals is not enough, even at 100%', () => {
    expect(
      assessModeSuggestion(trustRow({ approvals_total: 9, approvals_approved: 9 }), NOW).eligible,
    ).toBe(false);
  });

  it('89.9% approval rate is not enough; 90.0% is', () => {
    expect(
      assessModeSuggestion(trustRow({ approvals_total: 1000, approvals_approved: 899 }), NOW).eligible,
    ).toBe(false);
    expect(
      assessModeSuggestion(trustRow({ approvals_total: 1000, approvals_approved: 900 }), NOW).eligible,
    ).toBe(true);
  });

  it('act_within_caps never suggests anything, whatever the stats', () => {
    const a = assessModeSuggestion(
      trustRow({ mode: 'act_within_caps', approvals_total: 100, approvals_approved: 100 }),
      NOW,
    );
    expect(a.eligible).toBe(false);
    expect(a.suggestion).toBeUndefined();
  });

  it('walks the modes: draft_only → propose_approve', () => {
    expect(assessModeSuggestion(trustRow({ mode: 'draft_only' }), NOW).suggestion?.to_mode).toBe('propose_approve');
  });

  it('unparsable mode_since is never eligible (no autonomy on unreadable data)', () => {
    expect(assessModeSuggestion(trustRow({ mode_since: 'not-a-date' }), NOW).eligible).toBe(false);
  });
});
