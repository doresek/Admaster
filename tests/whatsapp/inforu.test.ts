// tests/whatsapp/inforu.test.ts — the InforU adapter: mock mode, payload shape,
// and the live path (isolated behind a mocked global `fetch`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendViaInforU,
  buildInforUPayload,
  resolveMode,
  hasInforUCreds,
} from '@/lib/whatsapp/inforu';

const ENV_KEYS = ['INFORU_MODE', 'INFORU_USER', 'INFORU_TOKEN', 'INFORU_SENDER', 'INFORU_API_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  vi.restoreAllMocks();
});

describe('resolveMode / hasInforUCreds', () => {
  it('defaults to mock when INFORU_MODE is unset', () => {
    expect(resolveMode()).toBe('mock');
  });
  it('is live only when INFORU_MODE=live', () => {
    process.env.INFORU_MODE = 'live';
    expect(resolveMode()).toBe('live');
  });
  it('reports creds only when both user and token present', () => {
    expect(hasInforUCreds()).toBe(false);
    process.env.INFORU_USER = 'u';
    expect(hasInforUCreds()).toBe(false);
    process.env.INFORU_TOKEN = 't';
    expect(hasInforUCreds()).toBe(true);
  });
});

describe('buildInforUPayload', () => {
  it('builds a free-text payload (Message, Recipients)', () => {
    const p = buildInforUPayload({ toPhone: '0501234567', body: 'שלום' });
    expect(p).toEqual({ Data: { Message: 'שלום', Recipients: [{ Phone: '0501234567' }] } });
  });
  it('builds a template payload (TemplateName instead of Message)', () => {
    const p = buildInforUPayload({ toPhone: '0501234567', body: 'ignored', templateName: 'bofu_offer' });
    expect(p.Data.TemplateName).toBe('bofu_offer');
    expect(p.Data.Message).toBeUndefined();
    expect(p.Data.Recipients).toEqual([{ Phone: '0501234567' }]);
  });
  it('includes Settings.Sender when INFORU_SENDER is set', () => {
    process.env.INFORU_SENDER = 'AdMaster';
    const p = buildInforUPayload({ toPhone: '0501234567', body: 'hi' });
    expect(p.Data.Settings).toEqual({ Sender: 'AdMaster' });
  });
});

describe('sendViaInforU — mock mode (default)', () => {
  it('returns sent + a synthetic mock provider id, with no HTTP call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const res = await sendViaInforU({ toPhone: '0501234567', body: 'hi' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.mode).toBe('mock');
    expect(res.providerMsgId).toMatch(/^mock-/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('honours an explicit mock mode override even if env says live', async () => {
    process.env.INFORU_MODE = 'live';
    const res = await sendViaInforU({ toPhone: '050', body: 'hi' }, { mode: 'mock' });
    expect(res.mode).toBe('mock');
    expect(res.providerMsgId).toMatch(/^mock-/);
  });
});

describe('sendViaInforU — live mode', () => {
  it('fails fast (no fetch) when credentials are missing — blocker C2', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const res = await sendViaInforU({ toPhone: '050', body: 'hi' }, { mode: 'live' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/credentials missing/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the InforU envelope with Basic auth and parses success (StatusId=1)', async () => {
    process.env.INFORU_USER = 'user1';
    process.env.INFORU_TOKEN = 'tok1';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ StatusId: 1, StatusDescription: 'ok', Data: { MessageId: 'wa-999' } }),
    }));
    vi.stubGlobal('fetch', fetchMock as never);

    const res = await sendViaInforU({ toPhone: '0501234567', body: 'hi' }, { mode: 'live' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('inforu');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('user1:tok1').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({ Data: { Message: 'hi', Recipients: [{ Phone: '0501234567' }] } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.providerMsgId).toBe('wa-999');
  });

  it('maps a non-2xx HTTP response to a failed result', async () => {
    process.env.INFORU_USER = 'u';
    process.env.INFORU_TOKEN = 't';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as never);
    const res = await sendViaInforU({ toPhone: '050', body: 'hi' }, { mode: 'live' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 401/);
  });

  it('maps an InforU rejection (StatusId != 1) to a failed result', async () => {
    process.env.INFORU_USER = 'u';
    process.env.INFORU_TOKEN = 't';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ StatusId: -1, StatusDescription: 'bad number' }),
    })) as never);
    const res = await sendViaInforU({ toPhone: '050', body: 'hi' }, { mode: 'live' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/bad number/);
  });
});
