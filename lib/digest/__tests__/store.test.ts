// lib/digest/store — draft upsert-recompose, immutability of approved/sent
// digests (typed rejection), and the draft→approved state machine.

import { describe, expect, it } from 'vitest';
import type { DigestSources } from '@/lib/capability-contracts';
import { composeDigest } from '../compose';
import { approveDigest, getDigest, listDigests, saveDigest, type SaveDigestInput } from '../store';
import { dentalWeekInputs, CLIENT_ID, OWNER_ID, PERIOD } from './fixtures';
import { mockSupabase } from './mock-supabase';

function saveInput(overrides: Partial<SaveDigestInput> = {}): SaveDigestInput {
  const composed = composeDigest(dentalWeekInputs());
  return {
    clientId:     CLIENT_ID,
    ownerUserId:  OWNER_ID,
    kind:         'weekly',
    periodStart:  PERIOD.start,
    periodEnd:    PERIOD.end,
    content:      composed.content,
    renderedText: composed.rendered_text,
    sources:      composed.sources,
    ...overrides,
  };
}

const EMPTY_SOURCES: DigestSources =
  { campaign_ids: [], decision_ids: [], diagnosis_ids: [], hypothesis_ids: [] };

describe('saveDigest — upsert on (client, kind, period_start)', () => {
  it('inserts a draft, then recomposition overwrites the SAME row', async () => {
    const mock = mockSupabase();

    const first = await saveDigest(mock.client, saveInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.digest.status).toBe('draft');

    const second = await saveDigest(mock.client, saveInput({ renderedText: 'גרסה מעודכנת' }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.digest.id).toBe(first.digest.id);      // same row, not a duplicate
    expect(second.digest.rendered_text).toBe('גרסה מעודכנת');
    expect(mock.rows('digests')).toHaveLength(1);
  });

  it('rejects overwriting an APPROVED digest with a typed rejection', async () => {
    const mock = mockSupabase();
    const first = await saveDigest(mock.client, saveInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const approved = await approveDigest(mock.client, first.digest.id, CLIENT_ID, OWNER_ID);
    expect(approved.ok).toBe(true);

    const overwrite = await saveDigest(mock.client, saveInput({ renderedText: 'ניסיון דריסה' }));
    expect(overwrite).toEqual({ ok: false, reason: 'immutable', status: 'approved' });
    // the approved narrative is untouched — it is the audit artifact (§1.3)
    const row = await getDigest(mock.client, first.digest.id, OWNER_ID);
    expect(row?.rendered_text).not.toBe('ניסיון דריסה');
    expect(row?.status).toBe('approved');
  });

  it('rejects overwriting a SENT digest', async () => {
    const mock = mockSupabase();
    mock.seed('digests', [{
      id: 'digest-sent', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      kind: 'weekly', period_start: PERIOD.start, period_end: PERIOD.end,
      content: {}, rendered_text: 'נשלח', sources: EMPTY_SOURCES,
      status: 'sent', created_at: '2026-06-29T08:00:00Z',
    }]);
    const result = await saveDigest(mock.client, saveInput());
    expect(result).toEqual({ ok: false, reason: 'immutable', status: 'sent' });
  });

  it('scopes the upsert by kind — a monthly digest never collides with the weekly', async () => {
    const mock = mockSupabase();
    const weekly = await saveDigest(mock.client, saveInput());
    const monthly = await saveDigest(mock.client, saveInput({ kind: 'monthly', periodEnd: '2026-06-30' }));
    expect(weekly.ok && monthly.ok).toBe(true);
    expect(mock.rows('digests')).toHaveLength(2);
  });
});

describe('approveDigest — state machine (draft → approved only)', () => {
  it('approves a draft', async () => {
    const mock = mockSupabase();
    const saved = await saveDigest(mock.client, saveInput());
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const result = await approveDigest(mock.client, saved.digest.id, CLIENT_ID, OWNER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest.status).toBe('approved');
  });

  it('rejects approving an already-approved digest (not_draft)', async () => {
    const mock = mockSupabase();
    const saved = await saveDigest(mock.client, saveInput());
    if (!saved.ok) return;
    await approveDigest(mock.client, saved.digest.id, CLIENT_ID, OWNER_ID);

    const again = await approveDigest(mock.client, saved.digest.id, CLIENT_ID, OWNER_ID);
    expect(again).toEqual({ ok: false, reason: 'not_draft', status: 'approved' });
  });

  it('never runs backwards: a SENT digest cannot re-enter draft/approved', async () => {
    const mock = mockSupabase();
    mock.seed('digests', [{
      id: 'digest-sent', client_id: CLIENT_ID, owner_user_id: OWNER_ID,
      kind: 'weekly', period_start: PERIOD.start, period_end: PERIOD.end,
      content: {}, rendered_text: 'נשלח', sources: EMPTY_SOURCES,
      status: 'sent', created_at: '2026-06-29T08:00:00Z',
    }]);
    const result = await approveDigest(mock.client, 'digest-sent', CLIENT_ID, OWNER_ID);
    expect(result).toEqual({ ok: false, reason: 'not_draft', status: 'sent' });
    expect(mock.rows('digests')[0]?.status).toBe('sent');
  });

  it('unknown id → not_found', async () => {
    const mock = mockSupabase();
    const result = await approveDigest(mock.client, 'nope', CLIENT_ID, OWNER_ID);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('getDigest / listDigests', () => {
  it('lists a client digests newest period first, owner-scoped', async () => {
    const mock = mockSupabase();
    await saveDigest(mock.client, saveInput({ periodStart: '2026-06-15', periodEnd: '2026-06-21' }));
    await saveDigest(mock.client, saveInput());
    mock.seed('digests', [
      ...mock.rows('digests'),
      { id: 'other-owner', client_id: CLIENT_ID, owner_user_id: 'someone-else',
        kind: 'weekly', period_start: '2026-06-22', period_end: '2026-06-28',
        content: {}, rendered_text: '', sources: EMPTY_SOURCES, status: 'draft',
        created_at: '2026-06-29T08:00:00Z' },
    ]);

    const digests = await listDigests(mock.client, { clientId: CLIENT_ID, ownerUserId: OWNER_ID });
    expect(digests.map((d) => d.period_start)).toEqual(['2026-06-22', '2026-06-15']);
    expect(digests.some((d) => d.id === 'other-owner')).toBe(false);
  });

  it('getDigest is owner-scoped', async () => {
    const mock = mockSupabase();
    const saved = await saveDigest(mock.client, saveInput());
    if (!saved.ok) return;
    expect(await getDigest(mock.client, saved.digest.id, OWNER_ID)).not.toBeNull();
    expect(await getDigest(mock.client, saved.digest.id, 'someone-else')).toBeNull();
  });
});
