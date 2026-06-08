// Characterization tests for the EMAIL / MESSAGING BLASTS feature.
//
// These lock in what the code does TODAY (warts included). Companion to
// tests/landing-leads.test.ts, tests/images-content.test.ts, tests/ad-analysis.test.ts.
//
// ⚠ KEY COUPLING FINDING (drives this file's approach):
// There are NO API route handlers for messaging. Every write happens INLINE in
// 'use client' React components via the browser Supabase client:
//   • messages         — app/(dashboard)/messages/page.tsx:81  (in generate())
//   • message_series   — app/(dashboard)/series/page.tsx:124    (in saveSeries())
//   • series_messages  — app/(dashboard)/series/page.tsx:135    (in saveSeries())
// None is an importable handler, so the "drive the real handler" approach used
// for landing/images/tools is NOT feasible here. Instead, the tests below are
// FAITHFUL MIRRORS of the exact insert-payload construction in those components
// (line-for-line), locking the client-linkage semantics. Treat the mirror like
// the SQL-trigger mirror in tests/brief-flow.test.ts: update it in lockstep with
// the source.
//
// Verified-against-source schema facts (003_messages_and_series.sql):
//   messages         (:11)  id, user_id(FK,NOT NULL), client_id(FK meta_clients,
//                           ON DELETE SET NULL, NULLABLE), channel('email'|'sms'|'whatsapp'),
//                           framework, subject, body(NOT NULL), cta, meta, created_at
//                           — indexed on client_id (idx_messages_client)
//   message_series   (:33)  id, user_id(FK,NOT NULL), client_id(FK meta_clients,
//                           ON DELETE SET NULL, NULLABLE), name(NOT NULL), goal,
//                           duration_days(NOT NULL), channels, status, created_at, updated_at
//   series_messages  (:46)  id, series_id(FK message_series, NOT NULL, cascade),
//                           day_offset, channel, framework, subject, body(NOT NULL),
//                           position, created_at  — NO client_id (links via series_id)
//   RLS: messages/message_series "own" (user_id); series_messages "via_series".

import { describe, it, expect } from 'vitest';

type Client = { id: string; industry?: string | null };

// ════════════════════════════════════════════════════════════════════
// MIRRORS of the inline insert-payload construction in the dashboards.
// ════════════════════════════════════════════════════════════════════

// Mirror of messages/page.tsx:81-90 (generate() → supabase.from('messages').insert)
function buildMessageInsert(args: {
  userId: string; selC: Client | null;
  channel: string; fw: string;
  result: { subject: string; body: string; cta: string };
  brief: string;
}) {
  return {
    user_id:   args.userId,
    client_id: args.selC?.id ?? null,
    channel:   args.channel,
    framework: args.fw,
    subject:   args.result.subject || null,
    body:      args.result.body,
    cta:       args.result.cta,
    meta:      { brief: args.brief },
  };
}

// Mirror of series/page.tsx:124-132 (saveSeries() → message_series insert)
function buildSeriesInsert(args: {
  userId: string; selC: Client | null;
  name: string; goal: string; duration: number; channels: string[];
}) {
  return {
    user_id:       args.userId,
    client_id:     args.selC?.id ?? null,
    name:          args.name,
    goal:          args.goal,
    duration_days: args.duration,
    channels:      args.channels,
    status:        'draft',
  };
}

// Mirror of series/page.tsx:135-142 (saveSeries() → series_messages insert .map)
function buildSeriesMessagesInsert(
  seriesId: string,
  scheduled: Array<{ day_offset: number; channel: string; subject?: string; body: string; position: number }>,
) {
  return scheduled.map(m => ({
    series_id:  seriesId,
    day_offset: m.day_offset,
    channel:    m.channel,
    subject:    m.subject ?? null,
    body:       m.body,
    position:   m.position,
  }));
}

// ════════════════════════════════════════════════════════════════════
// 1. messages insert — client_id IS sourced from the page's client selector
// ════════════════════════════════════════════════════════════════════
describe('messages insert (mirror of messages/page.tsx)', () => {
  const result = { subject: 'נושא', body: 'גוף ההודעה', cta: 'הזמן עכשיו' };

  it('client_id = the selected client id when one is chosen (real in-UI link)', () => {
    const payload = buildMessageInsert({
      userId: 'owner-1', selC: { id: 'client-A', industry: 'bakery' },
      channel: 'email', fw: 'aida', result, brief: 'מבצע קיץ',
    });
    expect(payload.client_id).toBe('client-A');
    expect(payload).toEqual({
      user_id: 'owner-1', client_id: 'client-A', channel: 'email', framework: 'aida',
      subject: 'נושא', body: 'גוף ההודעה', cta: 'הזמן עכשיו', meta: { brief: 'מבצע קיץ' },
    });
  });

  it('client_id = null when no client is selected (selector defaults to "ללא"/none)', () => {
    const payload = buildMessageInsert({
      userId: 'owner-1', selC: null, channel: 'sms', fw: 'pas', result, brief: 'x',
    });
    expect(payload.client_id).toBeNull();
  });

  it('subject collapses to null on non-email channels (result.subject is "")', () => {
    const payload = buildMessageInsert({
      userId: 'owner-1', selC: null, channel: 'whatsapp', fw: 'aida',
      result: { subject: '', body: 'b', cta: 'c' }, brief: 'x',
    });
    expect(payload.subject).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. series insert — parent carries client_id; children link via series_id
// ════════════════════════════════════════════════════════════════════
describe('series insert (mirror of series/page.tsx)', () => {
  it('message_series.client_id = selected client; status defaults to draft', () => {
    const payload = buildSeriesInsert({
      userId: 'owner-1', selC: { id: 'client-B' },
      name: 'Nurture', goal: 'lead_nurture', duration: 30, channels: ['email', 'sms'],
    });
    expect(payload).toEqual({
      user_id: 'owner-1', client_id: 'client-B', name: 'Nurture', goal: 'lead_nurture',
      duration_days: 30, channels: ['email', 'sms'], status: 'draft',
    });
  });

  it('message_series.client_id = null when none selected', () => {
    const payload = buildSeriesInsert({
      userId: 'owner-1', selC: null, name: 'N', goal: 'launch', duration: 7, channels: [],
    });
    expect(payload.client_id).toBeNull();
  });

  it('series_messages rows carry series_id only — NO client_id (attribution is two-hop)', () => {
    const rows = buildSeriesMessagesInsert('series-1', [
      { day_offset: 0, channel: 'email', subject: 'יום 1', body: 'ברוך הבא', position: 0 },
      { day_offset: 3, channel: 'sms',                       body: 'תזכורת',  position: 1 },
    ]);
    expect(rows[0]).toEqual({ series_id: 'series-1', day_offset: 0, channel: 'email', subject: 'יום 1', body: 'ברוך הבא', position: 0 });
    expect(rows[1].subject).toBeNull();              // subject ?? null when absent
    for (const r of rows) expect('client_id' in r).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. ATTRIBUTION MODEL (pure logic)
// ════════════════════════════════════════════════════════════════════

// 3a. messages — DIRECT client_id (optional). Unlike leads/images, the link is
// present and populated whenever the user selects a client; null otherwise.
type MessageRow = { id: string; client_id: string | null };
function messagesPerClient(rows: MessageRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of rows) {
    const bucket = m.client_id ?? '__unattributed__';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('attribution: messages — direct, optional client_id', () => {
  it('attributes by the row’s own client_id; null rows are unattributed', () => {
    const rows: MessageRow[] = [
      { id: 'm1', client_id: 'client-A' },
      { id: 'm2', client_id: 'client-A' },
      { id: 'm3', client_id: null },
    ];
    expect(messagesPerClient(rows)).toEqual({ 'client-A': 2, __unattributed__: 1 });
  });
});

// 3b. series_messages — TWO-HOP via series_id → message_series.client_id.
type SeriesMsg = { id: string; series_id: string };
type Series    = { id: string; client_id: string | null };
function seriesMessagesPerClient(msgs: SeriesMsg[], series: Series[]): Record<string, number> {
  const seriesToClient = new Map(series.map(s => [s.id, s.client_id]));
  const counts: Record<string, number> = {};
  for (const m of msgs) {
    const clientId = seriesToClient.get(m.series_id) ?? null;
    const bucket = clientId ?? '__unattributed__';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('attribution: series_messages — two-hop via parent series', () => {
  it('inherits the parent series client; messages of a null-client series are unattributed', () => {
    const series: Series[] = [{ id: 's1', client_id: 'client-A' }, { id: 's2', client_id: null }];
    const msgs: SeriesMsg[] = [
      { id: 'sm1', series_id: 's1' },
      { id: 'sm2', series_id: 's1' },
      { id: 'sm3', series_id: 's2' },
    ];
    expect(seriesMessagesPerClient(msgs, series)).toEqual({ 'client-A': 2, __unattributed__: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════
// READ-PATH + COUPLING FINDINGS — documented, not driven
// ════════════════════════════════════════════════════════════════════
// (a) No API routes exist; writes are inline in client components (see header).
//     The payload mirrors above are the regression anchor for those inserts.
// (b) Client linkage is REAL and POPULATED whenever the user picks a client in
//     the per-page selector (selC). But the selector DEFAULTS TO NONE ("ללא"),
//     and it is INDEPENDENT of the global active-client cookie used by the AI
//     routes (readActiveClientCookie) — messaging never reads that cookie. So a
//     blast is attributable to a client only when explicitly selected on that page.
// (c) READS ARE user_id-ONLY despite client_id being populated AND indexed
//     (idx_messages_client): messages/page.tsx:43 selects ...eq('user_id')...limit(20);
//     series/page.tsx:58 selects ...eq('user_id'); recommendations + dashboard
//     counts are user_id-scoped too. No reader filters or groups by client_id —
//     the attribution data is captured but never used on read.
// (d) AI copy generation goes through useAI() → /api/ai (generated_content), a
//     separate path; the message body persisted here is the post-generation text,
//     not a generated_content row link.
