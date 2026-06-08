// Characterization tests for MESSAGING attribution (Email / SMS / WhatsApp blasts).
//
// messages and message_series are NOT created through an API route — both are
// built INLINE in client components (app/(dashboard)/messages/page.tsx and
// app/(dashboard)/series/page.tsx) via the browser Supabase client. There is no
// handler to import, so — mirroring the pure-logic sections of
// tests/landing-leads.test.ts — these tests:
//   1. exercise the REAL active-client reader (lib/active-client) against a
//      stubbed document.cookie, and
//   2. mirror the exact inline default-selection + insert payloads the two
//      components build, asserting blasts attribute to the active client by
//      default while remaining overridable.
//
// Verified-against-source facts this file locks:
//   • messages.client_id        — selC?.id ?? null               (messages/page.tsx:83)
//   • message_series.client_id  — selC?.id ?? null               (series/page.tsx:126)
//   • both selectors now DEFAULT selC to the active client (cookie) after the
//     client list loads, via readActiveClientFromDocument()
//     (messages/page.tsx + series/page.tsx useEffect).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readActiveClientFromDocument } from '@/lib/active-client';
import type { MetaClient } from '@/types';

// readActiveClientCookie only accepts a 36-char UUID-format value.
const ACTIVE = '33333333-3333-3333-3333-333333333333';

function client(id: string, name: string): MetaClient {
  return {
    id, user_id: 'owner-1', name, industry: null, emoji: '🏢', token: 't',
    meta_user_id: null, meta_user_name: null, pages: [], ad_accounts: [],
    selected_page_id: null, selected_ad_account_id: null, status: 'connected',
    posts_published: 0, campaigns_created: 0, connected_at: '', updated_at: '',
  };
}

const CLIENTS = [client(ACTIVE, 'לקוח פעיל'), client('client-other', 'אחר')];

// ── Mirror of the default-selection effect in BOTH components ──────────
// After clients load, default the selector to the active client (cookie);
// fall back to null ("ללא") when there is no active client or no match.
function pickDefaultClient(clients: MetaClient[]): MetaClient | null {
  const activeId = readActiveClientFromDocument();
  if (activeId) {
    const active = clients.find(c => c.id === activeId);
    if (active) return active;
  }
  return null;
}

// ── Mirror of the inline messages insert payload (messages/page.tsx:81) ──
function messagePayload(selC: MetaClient | null) {
  return {
    user_id:   'owner-1',
    client_id: selC?.id ?? null,
    channel:   'email',
    framework: 'aida',
    subject:   'נושא',
    body:      'גוף',
    cta:       'לחצו כאן',
    meta:      { brief: 'בריף' },
  };
}

// ── Mirror of the inline message_series insert payload (series/page.tsx:124) ──
function seriesPayload(selC: MetaClient | null) {
  return {
    user_id:       'owner-1',
    client_id:     selC?.id ?? null,
    name:          'קמפיין',
    goal:          'lead_nurture',
    duration_days: 60,
    channels:      ['email', 'whatsapp'],
    status:        'draft',
  };
}

function setCookie(value: string | undefined) {
  (globalThis as any).document = value === undefined ? undefined : { cookie: value };
}

beforeEach(() => setCookie(undefined));
afterEach(() => { delete (globalThis as any).document; });

// ════════════════════════════════════════════════════════════════════
// 1. Default selection — selector defaults to the active client (cookie)
// ════════════════════════════════════════════════════════════════════
describe('messaging selector defaults to the active client (cookie)', () => {
  it('picks the active client when its cookie matches a loaded client', () => {
    setCookie(`admaster_active_client=${ACTIVE}`);
    expect(pickDefaultClient(CLIENTS)?.id).toBe(ACTIVE);
  });

  it('falls back to null ("ללא") when no active-client cookie is set', () => {
    expect(pickDefaultClient(CLIENTS)).toBeNull();
  });

  it('falls back to null when the cookie names a client absent from the list', () => {
    setCookie('admaster_active_client=99999999-9999-9999-9999-999999999999');
    expect(pickDefaultClient(CLIENTS)).toBeNull();
  });

  it('ignores a malformed (non-UUID) cookie value', () => {
    setCookie('admaster_active_client=not-a-uuid');
    expect(pickDefaultClient(CLIENTS)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. messages insert — carries the active client_id by default
// ════════════════════════════════════════════════════════════════════
describe('messages insert payload (inline) attributes to the active client', () => {
  it('client_id defaults to the active client when the selector is left untouched', () => {
    setCookie(`admaster_active_client=${ACTIVE}`);
    const selC = pickDefaultClient(CLIENTS);            // default selection
    expect(messagePayload(selC).client_id).toBe(ACTIVE);
  });

  it('user can still override the default to another client', () => {
    setCookie(`admaster_active_client=${ACTIVE}`);
    const overridden = CLIENTS.find(c => c.id === 'client-other')!;
    expect(messagePayload(overridden).client_id).toBe('client-other');
  });

  it('user can clear the selection ("ללא") → client_id null', () => {
    setCookie(`admaster_active_client=${ACTIVE}`);
    expect(messagePayload(null).client_id).toBeNull();
  });

  it('client_id is null when there is no active client and none is chosen', () => {
    expect(messagePayload(pickDefaultClient(CLIENTS)).client_id).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. message_series insert — carries the active client_id by default
// ════════════════════════════════════════════════════════════════════
describe('message_series insert payload (inline) attributes to the active client', () => {
  it('client_id defaults to the active client when the selector is left untouched', () => {
    setCookie(`admaster_active_client=${ACTIVE}`);
    const selC = pickDefaultClient(CLIENTS);
    expect(seriesPayload(selC).client_id).toBe(ACTIVE);
  });

  it('user can still override the default to another client', () => {
    setCookie(`admaster_active_client=${ACTIVE}`);
    const overridden = CLIENTS.find(c => c.id === 'client-other')!;
    expect(seriesPayload(overridden).client_id).toBe('client-other');
  });

  it('client_id is null when there is no active client and none is chosen', () => {
    expect(seriesPayload(pickDefaultClient(CLIENTS)).client_id).toBeNull();
  });
});
