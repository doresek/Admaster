// lib/anti-abuse/otp.ts
//
// OTP generate / hash / verify. Pure + injectable — no DB, no clock coupling
// (the caller passes `now`). SECURITY posture:
//   • OTP is stored HASHED (HMAC-SHA256 with a server pepper) — never plaintext.
//   • Short expiry (default 10 min) + attempt cap (default 5) gate brute force.
//   • Hash comparison is timing-safe.
//   • generateOtp uses crypto RNG (not Math.random).

import { createHmac, randomInt, timingSafeEqual } from 'crypto';

import type { OtpRecord, OtpVerifyOutcome } from './types';

/** OTP length + lifetime + attempt policy. Overridable per call. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Server-side pepper for hashing OTPs. Prefer OTP_PEPPER; fall back to
 * ENCRYPTION_KEY (already required in prod) so a deploy that sets one secret
 * still hashes consistently. The final dev fallback keeps local/test runnable
 * without secrets but must NOT be relied on in production.
 */
function getPepper(): string {
  return process.env.OTP_PEPPER || process.env.ENCRYPTION_KEY || 'admaster-otp-dev-pepper';
}

/** Generate a numeric OTP of `length` digits using a CSPRNG. */
export function generateOtp(length: number = OTP_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

/** Hash an OTP for at-rest storage. Deterministic for a given pepper. */
export function hashOtp(otp: string): string {
  return createHmac('sha256', getPepper()).update(otp).digest('hex');
}

/** Compute the OTP expiry timestamp (ISO string) from `now`. */
export function otpExpiry(now: number = Date.now(), ttlMs: number = OTP_TTL_MS): string {
  return new Date(now + ttlMs).toISOString();
}

/** Timing-safe hex-hash comparison. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify a candidate OTP against a stored record. PURE — the caller is
 * responsible for incrementing `attempts` and clearing the OTP on success.
 *
 * Order of checks: attempt cap → presence → expiry → match. The cap is checked
 * FIRST so a locked-out record cannot be probed further even before expiry.
 */
export function verifyOtp(
  record: OtpRecord,
  candidate: string,
  opts: { now?: number; maxAttempts?: number } = {},
): OtpVerifyOutcome {
  const now = opts.now ?? Date.now();
  const maxAttempts = opts.maxAttempts ?? OTP_MAX_ATTEMPTS;

  if (record.attempts >= maxAttempts) return { ok: false, reason: 'too_many_attempts' };
  if (!record.otp_hash || !record.otp_expires_at) return { ok: false, reason: 'no_otp' };
  if (now > Date.parse(record.otp_expires_at)) return { ok: false, reason: 'expired' };
  if (!hashesEqual(hashOtp(candidate), record.otp_hash)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
