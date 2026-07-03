// tests/anti-abuse/otp.test.ts — OTP generate / hash / verify.
import { describe, it, expect } from 'vitest';
import {
  generateOtp,
  hashOtp,
  otpExpiry,
  verifyOtp,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
} from '@/lib/anti-abuse/otp';
import type { OtpRecord } from '@/lib/anti-abuse/types';

const NOW = Date.parse('2026-07-03T12:00:00.000Z');

function recordFor(otp: string, over: Partial<OtpRecord> = {}): OtpRecord {
  return {
    otp_hash: hashOtp(otp),
    otp_expires_at: otpExpiry(NOW), // +10 min
    attempts: 0,
    ...over,
  };
}

describe('generateOtp', () => {
  it('returns a 6-digit numeric string by default', () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOtp();
      expect(otp).toHaveLength(OTP_LENGTH);
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
  it('honours a custom length', () => {
    expect(generateOtp(4)).toMatch(/^\d{4}$/);
  });
});

describe('hashOtp', () => {
  it('is deterministic and never returns the plaintext', () => {
    const h1 = hashOtp('123456');
    const h2 = hashOtp('123456');
    expect(h1).toBe(h2);
    expect(h1).not.toContain('123456');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('differs for different OTPs', () => {
    expect(hashOtp('123456')).not.toBe(hashOtp('654321'));
  });
});

describe('verifyOtp', () => {
  it('passes for the correct code within expiry', () => {
    const rec = recordFor('123456');
    expect(verifyOtp(rec, '123456', { now: NOW + 1000 })).toEqual({ ok: true });
  });

  it('fails (mismatch) for a wrong code', () => {
    const rec = recordFor('123456');
    expect(verifyOtp(rec, '000000', { now: NOW + 1000 })).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('fails (expired) once past the expiry', () => {
    const rec = recordFor('123456');
    expect(verifyOtp(rec, '123456', { now: NOW + 11 * 60 * 1000 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('fails (too_many_attempts) at the attempt cap — even with the right code', () => {
    const rec = recordFor('123456', { attempts: OTP_MAX_ATTEMPTS });
    expect(verifyOtp(rec, '123456', { now: NOW + 1000 })).toEqual({ ok: false, reason: 'too_many_attempts' });
  });

  it('fails (no_otp) when no hash is stored', () => {
    const rec: OtpRecord = { otp_hash: null, otp_expires_at: null, attempts: 0 };
    expect(verifyOtp(rec, '123456', { now: NOW })).toEqual({ ok: false, reason: 'no_otp' });
  });

  it('checks the cap BEFORE expiry (locked out cannot be probed)', () => {
    const rec = recordFor('123456', { attempts: OTP_MAX_ATTEMPTS, otp_expires_at: otpExpiry(NOW - 60 * 60 * 1000) });
    expect(verifyOtp(rec, '999999', { now: NOW })).toEqual({ ok: false, reason: 'too_many_attempts' });
  });
});
