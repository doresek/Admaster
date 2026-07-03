// tests/anti-abuse/fingerprint.test.ts — hand-rolled fingerprint hashing.
import { describe, it, expect } from 'vitest';
import { hashFingerprint, canonicalizeSignals } from '@/lib/anti-abuse/fingerprint';

describe('canonicalizeSignals', () => {
  it('lowercases + trims and joins in a fixed order', () => {
    expect(canonicalizeSignals({ userAgent: '  Mozilla ', acceptLanguage: 'HE-IL' }))
      .toBe('mozilla|he-il||||');
  });
});

describe('hashFingerprint', () => {
  it('is deterministic for the same signals', () => {
    const s = { userAgent: 'UA', acceptLanguage: 'he', timezone: 'Asia/Jerusalem', screen: '1920x1080x24' };
    expect(hashFingerprint(s)).toBe(hashFingerprint(s));
  });

  it('returns a 64-char sha256 hex', () => {
    expect(hashFingerprint('some-raw-signal')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different signals', () => {
    expect(hashFingerprint({ userAgent: 'A' })).not.toBe(hashFingerprint({ userAgent: 'B' }));
  });

  it('accepts a pre-canonicalized raw string and matches the structured hash', () => {
    const raw = canonicalizeSignals({ userAgent: 'ua', timezone: 'tz' });
    expect(hashFingerprint(raw)).toBe(hashFingerprint({ userAgent: 'ua', timezone: 'tz' }));
  });

  it('returns null for an empty / degenerate payload (no false clustering)', () => {
    expect(hashFingerprint(null)).toBeNull();
    expect(hashFingerprint('')).toBeNull();
    expect(hashFingerprint({})).toBeNull();
    expect(hashFingerprint('|||||')).toBeNull();
  });
});
