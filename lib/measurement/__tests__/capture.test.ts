// L0 identity capture — the validation wall between PUBLIC input and the DB.
// Proves: valid ids pass, garbage/injection is rejected (not "cleaned"),
// oversized input is capped, the first-touch cookie gets zero trust, and the
// last-click merge keeps utm blocks atomic.

import { describe, it, expect } from 'vitest';
import {
  EMPTY_IDENTITY,
  MAX_CAPTURED_LEN,
  buildTouchpoint,
  hasAnySignal,
  mergeIdentity,
  parseClickIds,
  parseFirstTouchCookie,
  sanitizeReferrer,
  serializeFirstTouch,
} from '../capture';

describe('parseClickIds — happy paths', () => {
  it('captures fbclid/gclid/utm_* and the landing path from a full URL', () => {
    const id = parseClickIds(
      'https://x.co/lp/sale?fbclid=IwAR12_ab-c.D&gclid=Cj0KCQ&utm_source=facebook&utm_medium=cpc&utm_campaign=launch&utm_content=0f4a2f7e-1111-2222-3333-444455556666&utm_term=b2b',
    );
    expect(id.fbclid).toBe('IwAR12_ab-c.D');
    expect(id.gclid).toBe('Cj0KCQ');
    expect(id.utm).toEqual({
      source: 'facebook', medium: 'cpc', campaign: 'launch',
      content: '0f4a2f7e-1111-2222-3333-444455556666', term: 'b2b',
    });
    expect(id.landing_path).toBe('/lp/sale');
  });

  it('accepts a bare query string (no landing_path without a URL)', () => {
    const id = parseClickIds('?gclid=abc123&utm_source=google');
    expect(id.gclid).toBe('abc123');
    expect(id.utm.source).toBe('google');
    expect(id.landing_path).toBeNull();
  });

  it('accepts a JSON blob with a nested utm object (POST payload / cookie shape)', () => {
    const id = parseClickIds({
      fbclid: 'abc', utm: { source: 'instagram', medium: 'paid_social' }, landing_path: '/lp/x',
    });
    expect(id.fbclid).toBe('abc');
    expect(id.utm).toEqual({ source: 'instagram', medium: 'paid_social' });
    expect(id.landing_path).toBe('/lp/x');
  });

  it('keeps Hebrew UTM values (unicode allowlist)', () => {
    const id = parseClickIds({ utm: { campaign: 'מבצע קיץ 2026' } });
    expect(id.utm.campaign).toBe('מבצע קיץ 2026');
  });
});

describe('parseClickIds — garbage, oversize, injection', () => {
  it('rejects click IDs with a bad charset (never cleans them)', () => {
    expect(parseClickIds({ fbclid: 'has spaces' }).fbclid).toBeNull();
    expect(parseClickIds({ fbclid: 'semi;colon' }).fbclid).toBeNull();
    expect(parseClickIds({ gclid: "x'or 1=1--" }).gclid).toBeNull();
    expect(parseClickIds({ fbclid: '' }).fbclid).toBeNull();
    expect(parseClickIds({ fbclid: 42 }).fbclid).toBeNull();
    expect(parseClickIds({ fbclid: { nested: true } }).fbclid).toBeNull();
  });

  it('caps oversized valid-charset ids at MAX_CAPTURED_LEN', () => {
    const long = 'a'.repeat(1000);
    expect(parseClickIds({ fbclid: long }).fbclid).toBe('a'.repeat(MAX_CAPTURED_LEN));
  });

  it('rejects injection-shaped UTM values', () => {
    expect(parseClickIds({ utm: { source: '<script>alert(1)</script>' } }).utm.source).toBeUndefined();
    expect(parseClickIds({ utm: { campaign: '"; drop table x; --' } }).utm.campaign).toBeUndefined();
    expect(parseClickIds({ utm: { term: '{{template}}' } }).utm.term).toBeUndefined();
    expect(parseClickIds({ utm: { medium: 'a`b' } }).utm.medium).toBeUndefined();
  });

  it('drops unknown utm keys (allowlist of the 5 canonical keys)', () => {
    const id = parseClickIds('?utm_source=x&utm_evil=payload&utm_id=99');
    expect(id.utm).toEqual({ source: 'x' });
  });

  it('landing_path: strips query/hash, rejects non-absolute or bad charset', () => {
    expect(parseClickIds({ landing_path: '/lp/x?fbclid=y#frag' }).landing_path).toBe('/lp/x');
    expect(parseClickIds({ landing_path: 'not-absolute' }).landing_path).toBeNull();
    expect(parseClickIds({ landing_path: '/a"b' }).landing_path).toBeNull();
  });

  it('referrer: URL-shape required, query dropped, non-http(s) schemes rejected', () => {
    expect(sanitizeReferrer('https://facebook.com/ads?x=1')).toBe('https://facebook.com/ads');
    expect(sanitizeReferrer('javascript:alert(1)')).toBeNull();
    expect(sanitizeReferrer('free text referrer')).toBeNull();
    expect(sanitizeReferrer(undefined)).toBeNull();
  });
});

describe('first-touch cookie — zero trust', () => {
  it('round-trips a captured identity', () => {
    const original = parseClickIds('https://x.co/lp/a?fbclid=abc&utm_source=facebook&utm_medium=cpc');
    const parsed = parseFirstTouchCookie(serializeFirstTouch(original));
    expect(parsed).toEqual(original);
  });

  it('malformed cookie values → null (not a throw, not garbage-in)', () => {
    expect(parseFirstTouchCookie('not json')).toBeNull();
    expect(parseFirstTouchCookie('%7Bbroken')).toBeNull();
    expect(parseFirstTouchCookie('')).toBeNull();
    expect(parseFirstTouchCookie(null)).toBeNull();
    expect(parseFirstTouchCookie(encodeURIComponent('"just a string"'))).toBeNull();
  });

  it('a tampered cookie is RE-validated: injected values are rejected field-by-field', () => {
    const tampered = encodeURIComponent(JSON.stringify({
      fbclid: '<img onerror=x>', gclid: 'stillValid123',
      utm: { source: 'facebook', medium: '<script>' },
    }));
    const parsed = parseFirstTouchCookie(tampered);
    expect(parsed).not.toBeNull();
    expect(parsed?.fbclid).toBeNull();
    expect(parsed?.gclid).toBe('stillValid123');
    expect(parsed?.utm).toEqual({ source: 'facebook' });
  });
});

describe('mergeIdentity — last-click wins, first-touch fills gaps', () => {
  it('current visit fields win over the first touch', () => {
    const current = parseClickIds({ gclid: 'new-click', utm: { source: 'google' } });
    const first   = parseClickIds({ gclid: 'old-click', fbclid: 'fb-old', utm: { source: 'facebook', medium: 'cpc' } });
    const merged = mergeIdentity(current, first);
    expect(merged.gclid).toBe('new-click');
    expect(merged.fbclid).toBe('fb-old'); // gap filled
    // utm blocks are atomic — no facebook/medium bleeding into the google visit
    expect(merged.utm).toEqual({ source: 'google' });
  });

  it('an empty current visit falls back to the first touch wholesale', () => {
    const first = parseClickIds({ fbclid: 'abc', utm: { source: 'facebook' }, landing_path: '/lp/a' });
    expect(mergeIdentity(EMPTY_IDENTITY, first)).toEqual(first);
  });
});

describe('hasAnySignal + buildTouchpoint', () => {
  it('hasAnySignal is false for an empty identity, true for any id or utm', () => {
    expect(hasAnySignal(EMPTY_IDENTITY)).toBe(false);
    expect(hasAnySignal({ ...EMPTY_IDENTITY, fbclid: 'x' })).toBe(true);
    expect(hasAnySignal({ ...EMPTY_IDENTITY, utm: { source: 'x' } })).toBe(true);
    // referrer/path alone is not an attribution signal (no cookie for it)
    expect(hasAnySignal({ ...EMPTY_IDENTITY, landing_path: '/x' })).toBe(false);
  });

  it('buildTouchpoint shapes the insert row and caps the user agent', () => {
    const identity = parseClickIds({ fbclid: 'abc', utm: { source: 'facebook' }, landing_path: '/lp/a' });
    const row = buildTouchpoint({
      leadId: 'L1', clientId: 'C1', ownerUserId: 'U1', identity, userAgent: 'u'.repeat(999),
    });
    expect(row).toEqual({
      lead_id: 'L1', client_id: 'C1', owner_user_id: 'U1',
      fbclid: 'abc', gclid: null, ctwa_clid: null, meta_lead_id: null,
      utm: { source: 'facebook' }, landing_path: '/lp/a', referrer: null,
      user_agent: 'u'.repeat(MAX_CAPTURED_LEN),
    });
  });
});
