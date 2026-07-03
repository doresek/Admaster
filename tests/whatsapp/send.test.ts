// tests/whatsapp/send.test.ts — sendWhatsApp() composes the whatsapp_messages
// row (incl. grounded_in), records it via the admin client, and degrades
// gracefully when the table is absent. Supabase + the InforU adapter are mocked.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InforUSendResult } from '@/lib/whatsapp/types';

// Hoisted holder: the per-test fake admin + the adapter's canned result.
const h = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  insertError: null as { message: string; code?: string } | null,
  sendResult: null as InforUSendResult | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        h.inserted = row;
        return {
          select: () => ({
            single: async () =>
              h.insertError
                ? { data: null, error: h.insertError }
                : { data: { id: 'row-1' }, error: null },
          }),
        };
      },
    }),
  }),
}));

vi.mock('@/lib/whatsapp/inforu', () => ({
  sendViaInforU: vi.fn(async () => h.sendResult!),
}));

import { sendWhatsApp } from '@/lib/whatsapp/send';

const baseInput = {
  clientId: 'c1',
  ownerUserId: 'u1',
  toPhone: '0501234567',
  body: 'הצעה אישית בשבילך',
};

beforeEach(() => {
  h.inserted = null;
  h.insertError = null;
  h.sendResult = { ok: true, status: 'sent', providerMsgId: 'mock-abc', mode: 'mock' };
});

describe('sendWhatsApp', () => {
  it('composes the row correctly (incl. grounded_in) and persists it', async () => {
    const res = await sendWhatsApp({
      ...baseInput,
      templateName: 'bofu_offer',
      campaignId: 'camp-1',
      artifactId: 'art-1',
      groundedIn: ['ins-1', 'ins-2'],
    });

    expect(h.inserted).toEqual({
      client_id: 'c1',
      owner_user_id: 'u1',
      campaign_id: 'camp-1',
      artifact_id: 'art-1',
      to_phone: '0501234567',
      body: 'הצעה אישית בשבילך',
      template_name: 'bofu_offer',
      provider: 'inforu',
      provider_msg_id: 'mock-abc',
      status: 'sent',
      grounded_in: ['ins-1', 'ins-2'],
      error: null,
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe('sent');
    expect(res.id).toBe('row-1');
    expect(res.persisted).toBe(true);
    expect(res.providerMsgId).toBe('mock-abc');
  });

  it('defaults optional fields to null / empty grounding', async () => {
    await sendWhatsApp(baseInput);
    expect(h.inserted).toMatchObject({
      campaign_id: null,
      artifact_id: null,
      template_name: null,
      grounded_in: [],
      provider: 'inforu',
    });
  });

  it('records a failed provider send with the error, status failed', async () => {
    h.sendResult = { ok: false, status: 'failed', providerMsgId: null, mode: 'live', error: 'boom' };
    const res = await sendWhatsApp(baseInput);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
    expect(h.inserted).toMatchObject({ status: 'failed', error: 'boom', provider_msg_id: null });
  });

  it('degrades gracefully (persisted:false) when the table is absent', async () => {
    h.insertError = { message: 'relation "whatsapp_messages" does not exist', code: '42P01' };
    const res = await sendWhatsApp(baseInput);
    expect(res.ok).toBe(true);        // provider send still succeeded
    expect(res.status).toBe('sent');
    expect(res.persisted).toBe(false);
    expect(res.id).toBeNull();
  });

  it('surfaces a real DB error (not a missing-table) as a failure', async () => {
    h.insertError = { message: 'permission denied', code: '42501' };
    const res = await sendWhatsApp(baseInput);
    expect(res.ok).toBe(true);        // provider outcome preserved on ok
    expect(res.persisted).toBe(false);
    expect(res.error).toBe('permission denied');
  });
});
