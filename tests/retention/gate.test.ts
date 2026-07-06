// tests/retention/gate.test.ts — checkSendAllowed, the single fail-closed
// compliance chokepoint: check order, every refusal family, defer targets,
// totality (garbage in → refuse, never throw), and the loggable refused-row.
import { describe, it, expect } from 'vitest';
import { DEFAULT_RETENTION_POLICY as P } from '@/lib/retention/policy';
import { checkSendAllowed, buildRefusedTouch, type GateInput } from '@/lib/retention/gate';
import type { ContactRow, GateCandidate, TouchRow } from '@/lib/retention/types';

const NOW = new Date('2026-07-07T12:00:00+03:00'); // Tue noon IL — legal window

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

const candidate = (over: Partial<GateCandidate> = {}): GateCandidate => ({
  channel: 'whatsapp',
  promoKey: null,
  seriesId: 's1',
  seriesMessageId: 'sm1',
  lastChannel: null,
  ...over,
});

const touch = (sentAt: string, over: Partial<TouchRow> = {}): TouchRow => ({
  contact_id: 'c1', client_id: 'cl1', owner_user_id: 'u1',
  series_id: 's1', series_message_id: 'sm1',
  channel: 'whatsapp', status: 'sent', refusal_code: null, promo_key: null,
  provider: null, provider_ref: null, grounded_in: [], rationale: null,
  sent_at: sentAt, ...over,
});

const gate = (over: Partial<GateInput> = {}) =>
  checkSendAllowed({
    contact: contact(),
    candidate: candidate(),
    recentTouches: [],
    clientSentToday: 0,
    policy: P,
    now: NOW,
    ...over,
  });

describe('checkSendAllowed — happy path', () => {
  it('allows a consented, reachable contact in a legal window', () => {
    expect(gate()).toEqual({ allowed: true });
  });
});

describe('check order — first hit wins', () => {
  it('opt-out wins over timing (opted-out contact on Shabbat → opted_out)', () => {
    const v = gate({
      contact: contact({ opted_out_at: '2026-06-01T00:00:00Z' }),
      now: new Date('2026-07-03T16:00:00+03:00'), // Shabbat window
    });
    expect(v).toMatchObject({ allowed: false, code: 'opted_out' });
  });
  it('no_consent wins over everything', () => {
    const v = gate({
      contact: contact({ consented_at: 'not-a-date', opted_out_at: '2026-06-01T00:00:00Z' }),
    });
    expect(v).toMatchObject({ allowed: false, code: 'no_consent' });
  });
});

describe('consent + opt-out', () => {
  it('refuses an unparsable consented_at (defense in depth)', () => {
    const v = gate({ contact: contact({ consented_at: 'garbage' }) });
    expect(v).toMatchObject({ allowed: false, code: 'no_consent' });
  });
  it('refuses the tombstone on EVERY send', () => {
    const v = gate({ contact: contact({ opted_out_at: '2026-07-01T00:00:00Z' }) });
    expect(v).toMatchObject({ allowed: false, code: 'opted_out' });
    expect(v.allowed === false && v.deferUntil).toBeFalsy(); // structural, no defer
  });
});

describe('channel checks (step 3)', () => {
  it('missing_address for a phone channel with no phone', () => {
    const v = gate({ contact: contact({ phone: null }) }); // candidate whatsapp
    expect(v).toMatchObject({ allowed: false, code: 'missing_address' });
  });
  it('channel_pref when the contact switched the channel off', () => {
    const v = gate({ contact: contact({ channel_prefs: { whatsapp: false } }) });
    expect(v).toMatchObject({ allowed: false, code: 'channel_pref' });
  });
  it('R5: refuses the same channel twice in a row when ≥2 are permitted', () => {
    const v = gate({ candidate: candidate({ lastChannel: 'whatsapp' }) });
    expect(v).toMatchObject({ allowed: false, code: 'channel_pref' });
    if (!v.allowed) expect(v.reason).toContain('ברצף');
  });
  it('allows the same channel twice when it is the ONLY permitted channel', () => {
    const c = contact({ email: null, channel_prefs: { sms: false } });
    expect(gate({ contact: c, candidate: candidate({ lastChannel: 'whatsapp' }) }))
      .toEqual({ allowed: true });
  });
});

describe('timing windows (step 4) — refusals DEFER to the next legal time', () => {
  it('Shabbat (Fri 16:00) defers to Sunday 09:00', () => {
    const v = gate({ now: new Date('2026-07-03T16:00:00+03:00') });
    expect(v).toMatchObject({ allowed: false, code: 'shabbat' });
    if (!v.allowed) expect(v.deferUntil?.toISOString()).toBe('2026-07-05T06:00:00.000Z');
  });
  it('erev-chag (ערב שבועות Thu 16:00) defers past chag+Shabbat to Sunday', () => {
    const v = gate({ now: new Date('2026-05-21T16:00:00+03:00') });
    expect(v).toMatchObject({ allowed: false, code: 'holiday' });
    if (!v.allowed) expect(v.deferUntil?.toISOString()).toBe('2026-05-24T06:00:00.000Z');
  });
  it('quiet hours (Tue 07:00) defers to 09:00 the same day', () => {
    const v = gate({ now: new Date('2026-07-07T07:00:00+03:00') });
    expect(v).toMatchObject({ allowed: false, code: 'quiet_hours' });
    if (!v.allowed) expect(v.deferUntil?.toISOString()).toBe('2026-07-07T06:00:00.000Z');
  });
});

describe('frequency caps (step 5)', () => {
  it('min_gap fires before daily cap (deferral carries the next legal time)', () => {
    const v = gate({ recentTouches: [touch('2026-07-06T12:00:00+03:00')] });
    expect(v).toMatchObject({ allowed: false, code: 'min_gap' });
    if (!v.allowed) expect(v.deferUntil?.toISOString()).toBe('2026-07-09T09:00:00.000Z');
  });
  it('weekly cap refuses the third touch in 7 days', () => {
    // Both old enough to clear min_gap(3d) and daily cap, but 2 in the window.
    const v = gate({
      recentTouches: [touch('2026-07-01T12:00:00+03:00'), touch('2026-07-04T11:00:00+03:00')],
    });
    expect(v).toMatchObject({ allowed: false, code: 'weekly_cap' });
  });
  it('R8: client daily volume cap refuses with a defer', () => {
    const v = gate({ clientSentToday: 200 });
    expect(v).toMatchObject({ allowed: false, code: 'daily_cap' });
    if (!v.allowed) expect(v.deferUntil).toBeInstanceOf(Date);
  });
});

describe('promo dedup (step 6, R4)', () => {
  it('refuses the same promo_key on another channel within 90 days', () => {
    const v = gate({
      candidate: candidate({ channel: 'email', promoKey: 'summer26' }),
      recentTouches: [touch('2026-06-20T12:00:00+03:00', { promo_key: 'summer26', channel: 'whatsapp' })],
    });
    expect(v).toMatchObject({ allowed: false, code: 'promo_duplicate' });
    if (!v.allowed) expect(v.deferUntil).toBeUndefined();
  });
});

describe('totality — garbage in, refusal out, never a throw', () => {
  it('null contact refuses fail-closed', () => {
    const v = checkSendAllowed({
      contact: null as unknown as ContactRow,
      candidate: candidate(),
      recentTouches: [],
      policy: P,
      now: NOW,
    });
    expect(v).toMatchObject({ allowed: false, code: 'no_consent' });
  });
  it('malformed touches do not break the caps', () => {
    const v = gate({
      recentTouches: [touch('not-a-timestamp'), touch('2026-01-01T00:00:00Z')],
    });
    expect(v).toEqual({ allowed: true });
  });
});

describe('buildRefusedTouch — the loggable contact_touches refused row (§4.2)', () => {
  it('maps a refusal 1:1 to a valid refused row', () => {
    const verdict = gate({ now: new Date('2026-07-03T16:00:00+03:00') });
    if (verdict.allowed) throw new Error('expected refusal');
    const row = buildRefusedTouch({
      contact: contact(),
      candidate: candidate({ promoKey: 'summer26' }),
      verdict,
      groundedIn: ['atom-1'],
      now: new Date('2026-07-03T16:00:00+03:00'),
    });
    expect(row).toMatchObject({
      contact_id: 'c1',
      client_id: 'cl1',
      owner_user_id: 'u1',
      series_id: 's1',
      series_message_id: 'sm1',
      channel: 'whatsapp',
      status: 'refused',
      refusal_code: 'shabbat',
      promo_key: 'summer26',
      grounded_in: ['atom-1'],
    });
    expect(row.rationale).toContain('שבת');
    expect(row.rationale).toContain('2026-07-05T06:00:00.000Z'); // the defer, auditable
    expect(row.sent_at).toBe('2026-07-03T13:00:00.000Z');
  });
});
