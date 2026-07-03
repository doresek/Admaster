// tests/whatsapp/route.test.ts — POST /api/whatsapp/send: auth + input
// validation + passthrough to sendWhatsApp (which is mocked here).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  sendArgs: null as Record<string, unknown> | null,
  sendResult: { ok: true, status: 'sent', id: 'row-1', providerMsgId: 'mock-x', persisted: true, mode: 'mock' },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null } }) },
  }),
}));

vi.mock('@/lib/whatsapp', () => ({
  sendWhatsApp: vi.fn(async (args: Record<string, unknown>) => { h.sendArgs = args; return h.sendResult; }),
}));

import { POST } from '@/app/api/whatsapp/send/route';

function makeReq(body: unknown): any {
  return new Request('http://localhost/api/whatsapp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.userId = 'u1';
  h.sendArgs = null;
  h.sendResult = { ok: true, status: 'sent', id: 'row-1', providerMsgId: 'mock-x', persisted: true, mode: 'mock' };
});

describe('POST /api/whatsapp/send', () => {
  it('401s when unauthenticated', async () => {
    h.userId = null;
    const res = await POST(makeReq({ clientId: 'c1', toPhone: '050', body: 'hi' }));
    expect(res.status).toBe(401);
  });

  it('400s on invalid JSON', async () => {
    const res = await POST(makeReq('{not json'));
    expect(res.status).toBe(400);
  });

  it.each([
    [{ toPhone: '050', body: 'hi' }, 'clientId'],
    [{ clientId: 'c1', body: 'hi' }, 'toPhone'],
    [{ clientId: 'c1', toPhone: '050' }, 'body'],
  ])('400s when a required field is missing (%#)', async (body, _missing) => {
    const res = await POST(makeReq(body));
    expect(res.status).toBe(400);
  });

  it('sends with owner stamped from the session and passes grounding through', async () => {
    const res = await POST(makeReq({
      clientId: 'c1',
      toPhone: '0501234567',
      body: 'הצעה',
      templateName: 'bofu_offer',
      campaignId: 'camp-1',
      grounded_in: ['ins-1', 'ins-2'],
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.status).toBe('sent');
    expect(h.sendArgs).toMatchObject({
      clientId: 'c1',
      ownerUserId: 'u1',          // stamped from the authed session, not the body
      toPhone: '0501234567',
      body: 'הצעה',
      templateName: 'bofu_offer',
      campaignId: 'camp-1',
      groundedIn: ['ins-1', 'ins-2'],
    });
  });

  it('returns 502 when the provider send failed', async () => {
    h.sendResult = { ok: false, status: 'failed', id: null, providerMsgId: null, persisted: false, mode: 'live' } as any;
    const res = await POST(makeReq({ clientId: 'c1', toPhone: '050', body: 'hi' }));
    expect(res.status).toBe(502);
  });

  it('ignores non-string grounded_in entries', async () => {
    await POST(makeReq({ clientId: 'c1', toPhone: '050', body: 'hi', grounded_in: ['a', 1, null, 'b'] }));
    expect((h.sendArgs as any).groundedIn).toEqual(['a', 'b']);
  });
});
