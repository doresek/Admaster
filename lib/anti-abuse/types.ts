// lib/anti-abuse/types.ts
//
// Types for the signup anti-abuse layer (Part 3 #8). See ./index.ts for the
// public surface and the PRIVACY notice.

/** How the SMS sender behaves. Defaults to `mock` (no live HTTP call). */
export type SmsMode = 'mock' | 'live';

/** Raw, dependency-free device signals collected client-side (never a lib). */
export interface FingerprintSignals {
  userAgent?: string | null;
  acceptLanguage?: string | null;
  timezone?: string | null;
  /** e.g. "1920x1080x24" (width x height x colorDepth). */
  screen?: string | null;
  /** A short canvas-derived signal string (client-side, no external lib). */
  canvas?: string | null;
  /** navigator.hardwareConcurrency, platform, etc. — any extra stable bits. */
  extra?: string | null;
}

/** Minimal input the SMS sender needs to send one message. */
export interface SmsSendInput {
  toPhone: string;
  body: string;
}

/** Result of an SMS send attempt (mock or live). Mirrors InforUSendResult. */
export interface SmsSendResult {
  ok: boolean;
  status: 'sent' | 'failed';
  /** Provider message id. In mock mode a synthetic `mock-<uuid>`. */
  providerMsgId: string | null;
  mode: SmsMode;
  error?: string;
  /** Raw provider response (live mode only) for debugging. */
  raw?: unknown;
}

/** A stored OTP record (the subset of signup_verifications OTP verify needs). */
export interface OtpRecord {
  otp_hash: string | null;
  otp_expires_at: string | null; // ISO timestamptz
  attempts: number;
}

/** Discriminated outcome of verifying a candidate OTP against a record. */
export type OtpVerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'no_otp' | 'expired' | 'too_many_attempts' | 'mismatch' };

/** One prior account a page/business id was found on. */
export interface RepeatBusinessMatch {
  userId: string;
  clientId: string;
  source: 'meta_connections' | 'meta_clients';
  matchedOn: 'pageId' | 'businessId';
}

/** Result of {@link detectRepeatBusiness}. Flag-for-review, never a hard block. */
export interface RepeatBusinessResult {
  isRepeat: boolean;
  matches: RepeatBusinessMatch[];
}
