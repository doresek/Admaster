// Reconciliation — the honesty layer. Proves the verdict boundaries (1.3 /
// 2.0 inclusive on the healthy side), the zero-truth cases, the channel
// mapping (documented in reconciliation.ts header), the unique-key upsert,
// and the end-to-end runReconciliation count-vs-claims flow.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeReconciliation,
  mapChannel,
  runReconciliation,
  upsertReconciliation,
  type ChannelSignal,
} from '../reconciliation';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const CLIENT = 'c-1';
const OWNER  = 'u-1';

describe('computeReconciliation — verdict boundaries', () => {
  it('ratio ≤ 1.3 → healthy (boundary inclusive)', () => {
    expect(computeReconciliation({ platformClaimed: 10, crmTruth: 10 }).verdict).toBe('healthy');
    expect(computeReconciliation({ platformClaimed: 13, crmTruth: 10 })).toMatchObject({ ratio: 1.3, verdict: 'healthy' });
  });

  it('1.3 < ratio ≤ 2 → inflated (2.0 boundary inclusive)', () => {
    expect(computeReconciliation({ platformClaimed: 14, crmTruth: 10 })).toMatchObject({ ratio: 1.4, verdict: 'inflated' });
    expect(computeReconciliation({ platformClaimed: 20, crmTruth: 10 })).toMatchObject({ ratio: 2, verdict: 'inflated' });
  });

  it('ratio > 2 → broken', () => {
    expect(computeReconciliation({ platformClaimed: 21, crmTruth: 10 })).toMatchObject({ ratio: 2.1, verdict: 'broken' });
  });

  it('under-claiming (ratio < 1) is healthy — platforms cannot see every lead', () => {
    expect(computeReconciliation({ platformClaimed: 3, crmTruth: 10 })).toMatchObject({ ratio: 0.3, verdict: 'healthy' });
  });

  it('truth=0, claimed=0 → healthy with null ratio; truth=0, claimed>0 → broken', () => {
    expect(computeReconciliation({ platformClaimed: 0, crmTruth: 0 })).toMatchObject({ ratio: null, verdict: 'healthy' });
    expect(computeReconciliation({ platformClaimed: 5, crmTruth: 0 })).toMatchObject({ ratio: null, verdict: 'broken' });
  });

  it('notes are Hebrew (owner-facing, rendered verbatim)', () => {
    expect(computeReconciliation({ platformClaimed: 13, crmTruth: 10 }).note).toContain('תקין');
    expect(computeReconciliation({ platformClaimed: 20, crmTruth: 10 }).note).toContain('מנפחת');
    expect(computeReconciliation({ platformClaimed: 30, crmTruth: 10 }).note).toContain('חריג');
  });

  it('garbage numerics are clamped, not propagated', () => {
    expect(computeReconciliation({ platformClaimed: Number.NaN, crmTruth: -5 })).toMatchObject({ ratio: null, verdict: 'healthy' });
  });
});

describe('mapChannel — documented priority order', () => {
  const sig = (over: Partial<ChannelSignal> = {}): ChannelSignal => ({
    fbclid: null, gclid: null, ctwa_clid: null, utm: {}, ...over,
  });

  it('gclid wins everything (only exists on Google Ads clicks)', () => {
    expect(mapChannel(sig({ gclid: 'g1', utm: { source: 'facebook', medium: 'cpc' } }))).toBe('google');
  });
  it('google-family utm sources → google', () => {
    expect(mapChannel(sig({ utm: { source: 'google' } }))).toBe('google');
    expect(mapChannel(sig({ utm: { source: 'YouTube' } }))).toBe('google');
  });
  it('meta sources split by paid medium', () => {
    expect(mapChannel(sig({ utm: { source: 'facebook', medium: 'cpc' } }))).toBe('meta_paid');
    expect(mapChannel(sig({ utm: { source: 'Instagram', medium: 'paid_social' } }))).toBe('meta_paid');
    expect(mapChannel(sig({ utm: { source: 'facebook' } }))).toBe('meta_organic');
    expect(mapChannel(sig({ utm: { source: 'fb', medium: 'social' } }))).toBe('meta_organic');
  });
  it('whatsapp via source or ctwa_clid', () => {
    expect(mapChannel(sig({ utm: { source: 'whatsapp' } }))).toBe('whatsapp');
    expect(mapChannel(sig({ ctwa_clid: 'c1' }))).toBe('whatsapp');
  });
  it('bare fbclid (no utm labels) → meta_organic, never paid', () => {
    expect(mapChannel(sig({ fbclid: 'f1' }))).toBe('meta_organic');
  });
  it('nothing / no touchpoint → direct', () => {
    expect(mapChannel(sig())).toBe('direct');
    expect(mapChannel(null)).toBe('direct');
  });
});

describe('upsertReconciliation — unique (client, channel, period_start)', () => {
  let db: SupabaseMock;
  beforeEach(() => { db = mockSupabase(); });

  const input = (over: Record<string, unknown> = {}) => ({
    clientId: CLIENT, ownerUserId: OWNER, channel: 'meta_paid',
    periodStart: '2026-06-01', periodEnd: '2026-07-01',
    platformClaimed: 10, crmTruth: 8, ratio: 1.25, note: 'x',
    ...over,
  });

  it('re-running a period refreshes the row instead of duplicating it', async () => {
    await upsertReconciliation(db.client, input());
    await upsertReconciliation(db.client, input({ platformClaimed: 12, ratio: 1.5 }));
    const rows = db.rows('channel_reconciliation');
    expect(rows).toHaveLength(1);
    expect(rows[0].platform_claimed).toBe(12);

    // a different channel or period_start is a NEW row
    await upsertReconciliation(db.client, input({ channel: 'google' }));
    await upsertReconciliation(db.client, input({ periodStart: '2026-07-01' }));
    expect(db.rows('channel_reconciliation')).toHaveLength(3);
  });

  it('throws on a DB error (reconciliation is a background job — loud failure)', async () => {
    db.failOn.add('upsert:channel_reconciliation');
    await expect(upsertReconciliation(db.client, input())).rejects.toThrow('upsertReconciliation');
  });
});

describe('runReconciliation — CRM truth by first touch vs platform claims', () => {
  let db: SupabaseMock;
  beforeEach(() => { db = mockSupabase(); });

  const lead = (id: string, createdAt: string): MockRow => ({
    id, client_id: CLIENT, owner_user_id: OWNER, created_at: createdAt,
  });
  const tp = (leadId: string, over: MockRow = {}): MockRow => ({
    id: `tp-${leadId}${String(over.captured_at ?? '')}`, lead_id: leadId,
    client_id: CLIENT, owner_user_id: OWNER,
    fbclid: null, gclid: null, ctwa_clid: null, meta_lead_id: null,
    utm: {}, landing_path: null, referrer: null, user_agent: null,
    captured_at: '2026-06-05T00:00:00.000Z',
    ...over,
  });

  it('counts in-period leads per FIRST-touch channel and upserts one row per channel', async () => {
    db.seed('funnel_leads', [
      lead('l1', '2026-06-03T10:00:00.000Z'),
      lead('l2', '2026-06-10T10:00:00.000Z'),
      lead('l3', '2026-06-20T10:00:00.000Z'),   // no touchpoint → direct
      lead('out', '2026-05-20T10:00:00.000Z'),  // outside period
    ]);
    db.seed('lead_touchpoints', [
      tp('l1', { utm: { source: 'facebook', medium: 'cpc' } }),
      // l2: first touch is meta_paid, later touch google — FIRST wins
      tp('l2', { utm: { source: 'facebook', medium: 'cpc' }, captured_at: '2026-06-01T00:00:00.000Z' }),
      tp('l2', { gclid: 'g', captured_at: '2026-06-09T00:00:00.000Z' }),
      tp('out', { utm: { source: 'facebook', medium: 'cpc' } }),
    ]);

    const results = await runReconciliation(db.client, CLIENT, OWNER, {
      period: { start: '2026-06-01', end: '2026-07-01' },
      platformClaimed: { meta_paid: 4 },
    });

    const byChannel = new Map(results.map((r) => [r.channel, r]));
    expect(byChannel.get('meta_paid')).toMatchObject({ claimed: 4, truth: 2 });
    expect(byChannel.get('meta_paid')?.computed).toMatchObject({ ratio: 2, verdict: 'inflated' });
    expect(byChannel.get('direct')).toMatchObject({ claimed: 0, truth: 1 });
    expect(byChannel.get('direct')?.computed.verdict).toBe('healthy');
    expect(db.rows('channel_reconciliation')).toHaveLength(2);
  });

  it('platform claims on a channel with ZERO CRM truth reconcile as broken', async () => {
    const results = await runReconciliation(db.client, CLIENT, OWNER, {
      period: { start: '2026-06-01', end: '2026-07-01' },
      platformClaimed: { google: 7 },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ channel: 'google', claimed: 7, truth: 0 });
    expect(results[0].computed.verdict).toBe('broken');
  });

  it('empty period + no claims → no rows, no writes', async () => {
    const results = await runReconciliation(db.client, CLIENT, OWNER, {
      period: { start: '2026-06-01', end: '2026-07-01' },
      platformClaimed: {},
    });
    expect(results).toEqual([]);
    expect(db.rows('channel_reconciliation')).toHaveLength(0);
  });
});
