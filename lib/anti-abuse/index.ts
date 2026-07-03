// lib/anti-abuse/index.ts — public surface of the signup anti-abuse layer.
//
// ============================================================================
// PRIVACY NOTICE (read before extending this module)
// ----------------------------------------------------------------------------
// This layer collects PERSONAL DATA at signup for abuse prevention:
//   • DEVICE FINGERPRINT — a hashed digest of user-agent, language, timezone,
//     screen and a canvas-derived signal (hand-rolled; no third-party tracker).
//   • IP ADDRESS — captured server-side at signup.
//   • PHONE NUMBER — collected and verified via SMS OTP; one phone per account.
//
// These MUST be disclosed in the privacy policy (lawful basis: fraud/abuse
// prevention / legitimate interest; note SMS delivery via a third party, InforU,
// an Israeli processor). Signals are retained only as needed for abuse review.
// The OTP itself is stored HASHED with a short expiry and is never logged in
// production. Under Israeli privacy law + GDPR, users can request access/erasure
// of these fields (phone, device_fingerprint, signup_ip on signup_verifications;
// phone on users) subject to the abuse-prevention retention need.
// ============================================================================

export * from './types';

export {
  canonicalizeSignals,
  hashFingerprint,
  collectClientSignals,
} from './fingerprint';

export {
  OTP_LENGTH,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  otpExpiry,
  verifyOtp,
} from './otp';

export {
  resolveSmsMode,
  hasInforUSmsCreds,
  buildInforUSmsPayload,
  sendSms,
  type InforUSmsPayload,
} from './sms';

export { normalizePhone, isValidPhone } from './phone';

export { detectRepeatBusiness, type DetectRepeatBusinessInput } from './repeat-business';

export { isPhoneVerified } from './gate';
