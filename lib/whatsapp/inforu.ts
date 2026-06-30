// lib/whatsapp/inforu.ts
//
// InforU adapter. DEFAULTS TO MOCK MODE — no live HTTP call unless explicitly
// in `live` mode AND credentials are present. The live path is isolated behind
// a single `fetch` so it can be mocked in tests and swapped without touching the
// caller.
//
// BLOCKER C2: we do not have InforU (Geula Mode) credentials or the official API
// reference yet. The live payload + endpoint below are an ASSUMED shape modelled
// on InforU's documented v2 REST pattern (Basic-auth, `{ Data: { ... } }`
// envelope). Confirm against the real InforU WhatsApp docs before going live.
import { randomUUID } from 'crypto';
import type { InforUSendInput, InforUSendResult, InforUMode } from './types';

/** Assumed InforU v2 WhatsApp endpoint. Override with INFORU_API_URL. */
const DEFAULT_API_URL = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendMessage';

/** Assumed InforU v2 request envelope. */
export interface InforUPayload {
  Data: {
    /** Free-text message body (used when no template). */
    Message?: string;
    /** Pre-approved WhatsApp template name (used instead of Message). */
    TemplateName?: string;
    Recipients: Array<{ Phone: string }>;
    Settings?: { Sender?: string };
  };
}

/** Resolve the adapter mode. Defaults to `mock` unless INFORU_MODE=live. */
export function resolveMode(): InforUMode {
  return (process.env.INFORU_MODE ?? '').toLowerCase() === 'live' ? 'live' : 'mock';
}

/** Whether live InforU credentials are configured. */
export function hasInforUCreds(): boolean {
  return Boolean(process.env.INFORU_USER && process.env.INFORU_TOKEN);
}

/**
 * Build the InforU request payload. A `templateName` sends a pre-approved
 * template; otherwise the free-text `body` is sent. The sender id, when set,
 * rides along in Settings.
 */
export function buildInforUPayload(input: InforUSendInput): InforUPayload {
  const Recipients = [{ Phone: input.toPhone }];
  const sender = process.env.INFORU_SENDER;
  const Settings = sender ? { Sender: sender } : undefined;

  const Data: InforUPayload['Data'] = input.templateName
    ? { TemplateName: input.templateName, Recipients }
    : { Message: input.body, Recipients };

  if (Settings) Data.Settings = Settings;
  return { Data };
}

/** InforU v2 returns StatusId === 1 on success. */
function isInforUSuccess(json: unknown): boolean {
  return Boolean(json && typeof json === 'object' && (json as { StatusId?: number }).StatusId === 1);
}

/** Best-effort extraction of a provider message id from the live response. */
function extractProviderMsgId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const data = (json as { Data?: Record<string, unknown> }).Data ?? {};
  const candidate =
    data['MessageId'] ?? data['BulkId'] ?? data['Id'] ?? (json as Record<string, unknown>)['MessageId'];
  return candidate != null ? String(candidate) : null;
}

/**
 * Send one message via InforU.
 *
 * - `mock` (default): no HTTP; returns `sent` + a synthetic `mock-<uuid>` id.
 * - `live`: requires creds (else fails fast with a C2 message); POSTs the
 *   {@link buildInforUPayload} envelope with Basic auth, isolated behind `fetch`.
 */
export async function sendViaInforU(
  input: InforUSendInput,
  opts: { mode?: InforUMode } = {},
): Promise<InforUSendResult> {
  const mode = opts.mode ?? resolveMode();

  if (mode === 'mock') {
    return { ok: true, status: 'sent', providerMsgId: `mock-${randomUUID()}`, mode: 'mock' };
  }

  // ── live path ──────────────────────────────────────────────────────────────
  if (!hasInforUCreds()) {
    return {
      ok: false,
      status: 'failed',
      providerMsgId: null,
      mode: 'live',
      error: 'InforU credentials missing (set INFORU_USER / INFORU_TOKEN) — blocker C2',
    };
  }

  const url = process.env.INFORU_API_URL ?? DEFAULT_API_URL;
  const auth = Buffer.from(`${process.env.INFORU_USER}:${process.env.INFORU_TOKEN}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(buildInforUPayload(input)),
    });

    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: 'failed', providerMsgId: null, mode: 'live', error: `InforU HTTP ${res.status}`, raw };
    }
    const ok = isInforUSuccess(raw);
    return {
      ok,
      status: ok ? 'sent' : 'failed',
      providerMsgId: extractProviderMsgId(raw),
      mode: 'live',
      error: ok ? undefined : `InforU rejected: ${(raw as { StatusDescription?: string })?.StatusDescription ?? 'unknown'}`,
      raw,
    };
  } catch (e) {
    return {
      ok: false,
      status: 'failed',
      providerMsgId: null,
      mode: 'live',
      error: e instanceof Error ? e.message : 'InforU request failed',
    };
  }
}
