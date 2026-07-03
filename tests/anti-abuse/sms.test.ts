// tests/anti-abuse/sms.test.ts — InforU SMS sender: mock default + live path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendSms,
  buildInforUSmsPayload,
  resolveSmsMode,
  hasInforUSmsCreds,
} from '@/lib/anti-abuse/sms';

const ENV_KEYS = ['INFORU_MODE', 'INFORU_USER', 'INFORU_TOKEN', 'INFORU_SENDER', 'INFORU_SMS_API_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  vi.restoreAllMocks();
});

describe('resolveSmsMode / hasInforUSmsCreds', () => {
  it('defaults to mock when INFORU_MODE unset', () => {
    expect(resolveSmsMode()).toBe('mock');
  });
  it('is live only when INFORU_MODE=live', () => {
    process.env.INFORU_MODE = 'live';
    expect(resolveSmsMode()).toBe('live');
  });
  it('reports creds only when both user and token present', () => {
    expect(hasInforUSmsCreds()).toBe(false);
    process.env.INFORU_USER = 'u';
    expect(hasInforUSmsCreds()).toBe(false);
    process.env.INFORU_TOKEN = 't';
    expect(hasInforUSmsCreds()).toBe(true);
  });
});

describe('buildInforUSmsPayload', () => {
  it('builds Message + Recipients', () => {
    expect(buildInforUSmsPayload({ toPhone: '+972501234567', body: 'code 123' }))
      .toEqual({ Data: { Message: 'code 123', Recipients: [{ Phone: '+972501234567' }] } });
  });
  it('includes Settings.Sender when INFORU_SENDER set', () => {
    process.env.INFORU_SENDER = 'AdMaster';
    expect(buildInforUSmsPayload({ toPhone: '+972', body: 'x' }).Data.Settings).toEqual({ Sender: 'AdMaster' });
  });
});

describe('sendSms — mock mode (default)', () => {
  it('returns sent + synthetic id, with NO HTTP call (shippable without live SMS)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const res = await sendSms({ toPhone: '+972501234567', body: 'code 123456' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.mode).toBe('mock');
    expect(res.providerMsgId).toMatch(/^mock-/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('honours an explicit mock override even if env says live', async () => {
    process.env.INFORU_MODE = 'live';
    const res = await sendSms({ toPhone: '+972', body: 'x' }, { mode: 'mock' });
    expect(res.mode).toBe('mock');
  });
});

describe('sendSms — live mode', () => {
  it('fails fast (no fetch) when credentials are missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const res = await sendSms({ toPhone: '+972', body: 'x' }, { mode: 'live' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/credentials missing/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the Basic-auth envelope and parses success (StatusId=1)', async () => {
    process.env.INFORU_USER = 'user1';
    process.env.INFORU_TOKEN = 'tok1';
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ StatusId: 1, Data: { MessageId: 'sms-1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock as never);

    const res = await sendSms({ toPhone: '+972501234567', body: 'code' }, { mode: 'live' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('inforu');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('user1:tok1').toString('base64')}`,
    );
    expect(res.ok).toBe(true);
    expect(res.providerMsgId).toBe('sms-1');
  });
});
