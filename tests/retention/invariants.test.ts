// tests/retention/invariants.test.ts — every "don't nag" invariant R1–R8
// individually: allowed case, refused case, and (where applicable) the defer
// target. Fixed dates, injected `now`, no I/O. 2026-07-07 is a Tuesday (IDT).
import { describe, it, expect } from 'vitest';
import { DEFAULT_RETENTION_POLICY as P } from '@/lib/retention/policy';
import type { ContactRow, TouchRow } from '@/lib/retention/types';
import {
  checkDailyCap,
  checkMinGap,
  checkWeeklyCap,
  checkMonthlyCap,
  checkPromoDuplicate,
  checkOfferDensity,
  checkClientDailyCap,
  permittedChannels,
  resolveChannel,
  isDeferral,
} from '@/lib/retention/invariants';

const NOW = new Date('2026-07-07T12:00:00+03:00'); // Tue noon IL

const touch = (sentAt: string, over: Partial<TouchRow> = {}): TouchRow => ({
  contact_id: 'c1',
  client_id: 'cl1',
  owner_user_id: 'u1',
  series_id: 's1',
  series_message_id: 'sm1',
  channel: 'whatsapp',
  status: 'sent',
  refusal_code: null,
  promo_key: null,
  provider: null,
  provider_ref: null,
  grounded_in: [],
  rationale: null,
  sent_at: sentAt,
  ...over,
});

const contact = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: 'c1',
  client_id: 'cl1',
  owner_user_id: 'u1',
  full_name: 'דנה כהן',
  phone: '+972501234567',
  email: 'dana@example.com',
  tags: [],
  consent_source: 'manual',
  consented_at: '2026-01-01T00:00:00Z',
  consent_evidence: null,
  opted_out_at: null,
  opt_out_channel: null,
  opt_out_reason: null,
  opt_out_token: 'tok-1',
  channel_prefs: {},
  last_purchase_at: null,
  last_contact_at: null,
  ...over,
});

describe('R1 — ≤1 sent touch per contact per IL calendar day', () => {
  it('allows with no touch today', () => {
    expect(checkDailyCap([touch('2026-07-06T10:00:00+03:00')], P, NOW)).toEqual({ ok: true });
  });
  it('refuses after a sent touch today and defers to tomorrow 09:00 IL', () => {
    const v = checkDailyCap([touch('2026-07-07T10:00:00+03:00')], P, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('daily_cap');
      expect(v.deferUntil?.toISOString()).toBe('2026-07-08T06:00:00.000Z'); // Wed 09:00 IDT
    }
  });
  it('refused/failed rows do NOT count toward the cap', () => {
    const rows = [
      touch('2026-07-07T10:00:00+03:00', { status: 'refused', refusal_code: 'quiet_hours' }),
      touch('2026-07-07T11:00:00+03:00', { status: 'failed' }),
    ];
    expect(checkDailyCap(rows, P, NOW)).toEqual({ ok: true });
  });
  it('the IL day boundary is Asia/Jerusalem, not UTC', () => {
    // 2026-07-06T22:30Z = 2026-07-07 01:30 IL — SAME IL day as NOW
    const v = checkDailyCap([touch('2026-07-06T22:30:00Z')], P, NOW);
    expect(v.ok).toBe(false);
  });
});

describe('R2 — min 3 days between consecutive sent touches', () => {
  it('allows when the last touch is old enough', () => {
    expect(checkMinGap([touch('2026-07-03T12:00:00+03:00')], P, NOW)).toEqual({ ok: true });
  });
  it('allows with no history', () => {
    expect(checkMinGap([], P, NOW)).toEqual({ ok: true });
  });
  it('refuses inside the gap and defers to last+gap', () => {
    const v = checkMinGap([touch('2026-07-05T12:00:00+03:00')], P, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('min_gap');
      expect(v.deferUntil?.toISOString()).toBe('2026-07-08T09:00:00.000Z'); // Jul 5 +3d = Wed 12:00 IL
    }
  });
  it('a defer landing in Shabbat is pushed to the next legal window (Sunday 09:00)', () => {
    // last sent Wed 2026-07-08 16:00 IL → +3d = Sat 16:00 (Shabbat) → Sun 09:00
    const now = new Date('2026-07-09T12:00:00+03:00'); // Thu
    const v = checkMinGap([touch('2026-07-08T16:00:00+03:00')], P, now);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.deferUntil?.toISOString()).toBe('2026-07-12T06:00:00.000Z');
  });
});

describe('R3a — ≤2 sent touches per rolling 7 days', () => {
  it('allows at 1 in-window touch', () => {
    expect(checkWeeklyCap([touch('2026-07-05T12:00:00+03:00')], P, NOW)).toEqual({ ok: true });
  });
  it('touches older than 7 days do not count', () => {
    const rows = [touch('2026-06-28T12:00:00+03:00'), touch('2026-06-25T12:00:00+03:00')];
    expect(checkWeeklyCap(rows, P, NOW)).toEqual({ ok: true });
  });
  it('refuses at the cap and defers until the oldest counted touch ages out', () => {
    const rows = [touch('2026-07-02T12:00:00+03:00'), touch('2026-07-05T12:00:00+03:00')];
    const v = checkWeeklyCap(rows, P, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('weekly_cap');
      expect(v.deferUntil?.toISOString()).toBe('2026-07-09T09:00:00.000Z'); // Jul 2 +7d, Thu 12:00 IL
    }
  });
});

describe('R3b — ≤6 sent touches per rolling 30 days', () => {
  const six = ['06-10', '06-14', '06-18', '06-22', '06-26', '06-30']
    .map((d) => touch(`2026-${d}T12:00:00+03:00`));
  it('allows at 5', () => {
    expect(checkMonthlyCap(six.slice(1), P, NOW)).toEqual({ ok: true });
  });
  it('refuses at 6 with a defer', () => {
    const v = checkMonthlyCap(six, P, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('monthly_cap');
      expect(v.deferUntil).toBeInstanceOf(Date);
      expect(v.deferUntil!.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});

describe('R4 — never the same promo on two channels (90-day dedup)', () => {
  it('allows a fresh promo key', () => {
    const rows = [touch('2026-07-01T12:00:00+03:00', { promo_key: 'spring' })];
    expect(checkPromoDuplicate(rows, 'summer26', P, NOW)).toEqual({ ok: true });
  });
  it('allows when the candidate has no promo key', () => {
    const rows = [touch('2026-07-01T12:00:00+03:00', { promo_key: 'summer26' })];
    expect(checkPromoDuplicate(rows, null, P, NOW)).toEqual({ ok: true });
  });
  it('refuses the same promo on ANY channel within the window — no defer (structural)', () => {
    const rows = [touch('2026-06-27T12:00:00+03:00', { promo_key: 'summer26', channel: 'email' })];
    const v = checkPromoDuplicate(rows, 'summer26', P, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('promo_duplicate');
      expect(v.deferUntil).toBeUndefined();
    }
  });
  it('allows the same promo after the dedup window has passed', () => {
    const rows = [touch('2026-04-01T12:00:00+03:00', { promo_key: 'summer26' })]; // >90d
    expect(checkPromoDuplicate(rows, 'summer26', P, NOW)).toEqual({ ok: true });
  });
});

describe('R5 — channel permittedness + deterministic rotation', () => {
  it('permittedChannels honors addresses and explicit-false prefs', () => {
    expect(permittedChannels(contact())).toEqual(['whatsapp', 'email', 'sms']);
    expect(permittedChannels(contact({ email: null }))).toEqual(['whatsapp', 'sms']);
    expect(permittedChannels(contact({ channel_prefs: { whatsapp: false } })))
      .toEqual(['email', 'sms']);
    expect(permittedChannels(contact({ phone: null, channel_prefs: { email: false } })))
      .toEqual([]);
  });
  it('keeps the planned channel when it differs from the last one', () => {
    expect(resolveChannel('whatsapp', contact(), 'email'))
      .toEqual({ ok: true, channel: 'whatsapp', rotated: false });
  });
  it('rotates whatsapp → email when the last touch was whatsapp', () => {
    expect(resolveChannel('whatsapp', contact(), 'whatsapp'))
      .toEqual({ ok: true, channel: 'email', rotated: true });
  });
  it('falls to the first permitted channel when the planned one is unreachable', () => {
    const c = contact({ email: null }); // planned email, no address
    expect(resolveChannel('email', c, null))
      .toEqual({ ok: true, channel: 'whatsapp', rotated: true });
  });
  it('does NOT rotate when only one channel is permitted', () => {
    const c = contact({ email: null, channel_prefs: { sms: false } });
    expect(resolveChannel('whatsapp', c, 'whatsapp'))
      .toEqual({ ok: true, channel: 'whatsapp', rotated: false });
  });
  it('refuses channel_pref when every channel is switched off (address exists)', () => {
    const c = contact({ channel_prefs: { whatsapp: false, email: false, sms: false } });
    const v = resolveChannel('whatsapp', c, null);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('channel_pref');
  });
  it('refuses missing_address when the contact has no address at all', () => {
    const v = resolveChannel('whatsapp', contact({ phone: null, email: null }), null);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('missing_address');
  });
});

describe('R6 — offer density at build time (≤1 hard offer per 4 consecutive steps)', () => {
  const step = (position: number, promo: string | null) => ({ position, promo_key: promo });
  it('accepts a plan with well-spaced offers', () => {
    const steps = [step(0, 'p1'), step(1, null), step(2, null), step(3, null), step(4, 'p2')];
    expect(checkOfferDensity(steps)).toEqual({ ok: true });
  });
  it('accepts an all-nurture plan', () => {
    expect(checkOfferDensity([step(0, null), step(1, null)])).toEqual({ ok: true });
  });
  it('rejects two offers inside any 4-step window', () => {
    const steps = [step(0, 'p1'), step(1, null), step(2, 'p2'), step(3, null)];
    const v = checkOfferDensity(steps);
    expect(v.ok).toBe(false);
  });
  it('sorts by position before judging', () => {
    const steps = [step(4, 'p2'), step(0, 'p1'), step(1, null), step(2, null), step(3, null)];
    expect(checkOfferDensity(steps)).toEqual({ ok: true });
  });
});

describe('R7 — cap verdicts DEFER (carry the next legal time), structural refusals do not', () => {
  it('isDeferral distinguishes the two', () => {
    const capped = checkDailyCap([touch('2026-07-07T10:00:00+03:00')], P, NOW);
    const dup = checkPromoDuplicate(
      [touch('2026-07-01T12:00:00+03:00', { promo_key: 'x' })], 'x', P, NOW,
    );
    expect(isDeferral(capped)).toBe(true);
    expect(isDeferral(dup)).toBe(false);
  });
  it('every defer target is a LEGAL send time (inside window, not Shabbat)', () => {
    const v = checkDailyCap([touch('2026-07-07T10:00:00+03:00')], P, NOW);
    if (!v.ok && v.deferUntil) {
      const wc = v.deferUntil.toISOString();
      expect(wc).toBe('2026-07-08T06:00:00.000Z'); // Wed 09:00 IL — window open
    } else {
      throw new Error('expected a deferral');
    }
  });
});

describe('R8 — per-client daily volume cap (200/day default)', () => {
  it('allows under the cap', () => {
    expect(checkClientDailyCap(199, P, NOW)).toEqual({ ok: true });
  });
  it('refuses at the cap and defers to tomorrow', () => {
    const v = checkClientDailyCap(200, P, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('daily_cap');
      expect(v.reason).toContain('ללקוח');
      expect(v.deferUntil?.toISOString()).toBe('2026-07-08T06:00:00.000Z');
    }
  });
});
