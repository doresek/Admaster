// lib/retention/adapters.ts
//
// Email/SMS channel adapters — the SEAM only (owner decision: email provider
// DEFERRED, SMS = InforU pending creds/C2). Until a real provider lands, every
// adapter is a mock: no HTTP, deterministic result, mode:'mock' so the touch
// row is honestly a dry-run record. WhatsApp does NOT go through this seam —
// it uses the existing lib/whatsapp pipe (mock-by-default itself).

import type { AdapterSendResult, ChannelAdapter, RetentionChannel } from './types';

/** A deterministic no-network adapter for a gated channel. */
export function createMockAdapter(
  channel: RetentionChannel,
  provider = channel === 'sms' ? 'inforu-sms-mock' : 'email-mock',
): ChannelAdapter {
  let seq = 0;
  return {
    channel,
    provider,
    async send(): Promise<AdapterSendResult> {
      seq += 1;
      return { ok: true, mode: 'mock', providerRef: `mock-${channel}-${seq}` };
    },
  };
}

/** The default adapter set the sender falls back to (all dry-run). */
export function defaultAdapters(): Partial<Record<RetentionChannel, ChannelAdapter>> {
  return {
    email: createMockAdapter('email'),
    sms: createMockAdapter('sms'),
  };
}
