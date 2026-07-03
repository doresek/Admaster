// lib/anti-abuse/sms.ts
//
// InforU SMS sender for signup OTP delivery. MIRRORS lib/whatsapp/inforu.ts:
// DEFAULTS TO MOCK MODE — no live HTTP call unless INFORU_MODE=live AND
// credentials are present. The live path is isolated behind a single `fetch`
// so it is mockable in tests and swappable without touching callers.
//
// Env (reuses the WhatsApp InforU creds — same provider account):
//   INFORU_USER   / INFORU_TOKEN   — Basic-auth credentials (gate live sending)
//   INFORU_SENDER — optional sender id / originator
//   INFORU_MODE   — 'live' to enable the real send; anything else => mock
//   INFORU_SMS_API_URL — optional override of the SMS endpoint
//
// SECURITY: this module never logs the OTP. The CALLER decides whether to echo
// the code (only outside production — see the send-otp route).

import { randomUUID } from 'crypto';

import type { SmsMode, SmsSendInput, SmsSendResult } from './types';

/** Assumed InforU v2 SMS endpoint (parallel to the WhatsApp one). Override with INFORU_SMS_API_URL. */
const DEFAULT_SMS_API_URL = 'https://capi.inforu.co.il/api/v2/SMS/SendSms';

/** InforU v2 SMS request envelope. */
export interface InforUSmsPayload {
  Data: {
    Message: string;
    Recipients: Array<{ Phone: string }>;
    Settings?: { Sender?: string };
  };
}

/** Resolve the sender mode. Defaults to `mock` unless INFORU_MODE=live. */
export function resolveSmsMode(): SmsMode {
  return (process.env.INFORU_MODE ?? '').toLowerCase() === 'live' ? 'live' : 'mock';
}

/** Whether live InforU credentials are configured (gates live sending). */
export function hasInforUSmsCreds(): boolean {
  return Boolean(process.env.INFORU_USER && process.env.INFORU_TOKEN);
}

/** Build the InforU SMS request payload. */
export function buildInforUSmsPayload(input: SmsSendInput): InforUSmsPayload {
  const Recipients = [{ Phone: input.toPhone }];
  const sender = process.env.INFORU_SENDER;
  const Data: InforUSmsPayload['Data'] = { Message: input.body, Recipients };
  if (sender) Data.Settings = { Sender: sender };
  return { Data };
}

function isInforUSuccess(json: unknown): boolean {
  return Boolean(json && typeof json === 'object' && (json as { StatusId?: number }).StatusId === 1);
}

function extractProviderMsgId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const data = (json as { Data?: Record<string, unknown> }).Data ?? {};
  const candidate =
    data['MessageId'] ?? data['BulkId'] ?? data['Id'] ?? (json as Record<string, unknown>)['MessageId'];
  return candidate != null ? String(candidate) : null;
}

/**
 * Send one SMS via InforU.
 *
 * - `mock` (default): no HTTP; returns `sent` + a synthetic `mock-<uuid>` id, so
 *   the OTP flow is fully testable/shippable without live SMS. The caller still
 *   generated + stored a real hashed OTP; mock only skips the wire.
 * - `live`: requires creds (else fails fast); POSTs the Basic-auth envelope.
 */
export async function sendSms(
  input: SmsSendInput,
  opts: { mode?: SmsMode } = {},
): Promise<SmsSendResult> {
  const mode = opts.mode ?? resolveSmsMode();

  if (mode === 'mock') {
    return { ok: true, status: 'sent', providerMsgId: `mock-${randomUUID()}`, mode: 'mock' };
  }

  // ── live path ──────────────────────────────────────────────────────────────
  if (!hasInforUSmsCreds()) {
    return {
      ok: false,
      status: 'failed',
      providerMsgId: null,
      mode: 'live',
      error: 'InforU SMS credentials missing (set INFORU_USER / INFORU_TOKEN)',
    };
  }

  const url = process.env.INFORU_SMS_API_URL ?? DEFAULT_SMS_API_URL;
  const auth = Buffer.from(`${process.env.INFORU_USER}:${process.env.INFORU_TOKEN}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(buildInforUSmsPayload(input)),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: 'failed', providerMsgId: null, mode: 'live', error: `InforU SMS HTTP ${res.status}`, raw };
    }
    const ok = isInforUSuccess(raw);
    return {
      ok,
      status: ok ? 'sent' : 'failed',
      providerMsgId: extractProviderMsgId(raw),
      mode: 'live',
      error: ok ? undefined : `InforU SMS rejected: ${(raw as { StatusDescription?: string })?.StatusDescription ?? 'unknown'}`,
      raw,
    };
  } catch (e) {
    return {
      ok: false,
      status: 'failed',
      providerMsgId: null,
      mode: 'live',
      error: e instanceof Error ? e.message : 'InforU SMS request failed',
    };
  }
}
