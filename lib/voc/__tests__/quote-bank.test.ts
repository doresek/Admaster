// lib/voc/quote-bank — filters, limit clamping, recency ordering, owner
// scoping, and the prompt-injection formatting (copy ammunition, §6.3).

import { describe, expect, it } from 'vitest';
import type { VocQuoteRow } from '@/lib/capability-contracts';
import { formatQuotesForPrompt, getQuoteBank } from '../quote-bank';
import { mockSupabase, type MockRow } from './mock-supabase';

const CLIENT = 'client-1';
const OWNER  = 'owner-1';

let seq = 0;
function quoteRow(overrides: Partial<MockRow> = {}): MockRow {
  seq++;
  return {
    id: `q-${seq}`,
    document_id: 'doc-1',
    client_id: CLIENT,
    owner_user_id: OWNER,
    quote: `ציטוט ${seq}`,
    extractable: 'pain',
    polarity: 'positive',
    segment_tags: {},
    atom_action: null,
    funnel_fit: 'TOFU',
    created_at: `2026-07-0${Math.min(seq, 9)}T00:00:00Z`,
    ...overrides,
  };
}

function harness(rows: MockRow[]) {
  const sb = mockSupabase();
  sb.seed('voc_quotes', rows);
  return sb;
}

describe('getQuoteBank', () => {
  it('returns the client+owner quotes newest first', async () => {
    const sb = harness([
      quoteRow({ id: 'old',  created_at: '2026-07-01T00:00:00Z' }),
      quoteRow({ id: 'new',  created_at: '2026-07-03T00:00:00Z' }),
      quoteRow({ id: 'mid',  created_at: '2026-07-02T00:00:00Z' }),
    ]);

    const quotes = await getQuoteBank(sb.client, CLIENT, OWNER);
    expect(quotes.map((q) => q.id)).toEqual(['new', 'mid', 'old']);
  });

  it('filters by extractable and funnelFit', async () => {
    const sb = harness([
      quoteRow({ id: 'pain-tofu',  extractable: 'pain',  funnel_fit: 'TOFU' }),
      quoteRow({ id: 'proof-bofu', extractable: 'proof', funnel_fit: 'BOFU' }),
      quoteRow({ id: 'pain-bofu',  extractable: 'pain',  funnel_fit: 'BOFU' }),
    ]);

    const pains = await getQuoteBank(sb.client, CLIENT, OWNER, { extractable: 'pain' });
    expect(pains.map((q) => q.id).sort()).toEqual(['pain-bofu', 'pain-tofu']);

    const painBofu = await getQuoteBank(sb.client, CLIENT, OWNER, { extractable: 'pain', funnelFit: 'BOFU' });
    expect(painBofu.map((q) => q.id)).toEqual(['pain-bofu']);
  });

  it('applies the limit (and clamps absurd values into [1, 50])', async () => {
    const sb = harness(Array.from({ length: 5 }, () => quoteRow()));

    expect(await getQuoteBank(sb.client, CLIENT, OWNER, { limit: 2 })).toHaveLength(2);
    expect(await getQuoteBank(sb.client, CLIENT, OWNER, { limit: 0 })).toHaveLength(1);
    expect(await getQuoteBank(sb.client, CLIENT, OWNER, { limit: 9999 })).toHaveLength(5);
  });

  it('never returns another owner/client rows', async () => {
    const sb = harness([
      quoteRow({ id: 'mine' }),
      quoteRow({ id: 'other-client', client_id: 'client-2' }),
      quoteRow({ id: 'other-owner', owner_user_id: 'owner-2' }),
    ]);

    const quotes = await getQuoteBank(sb.client, CLIENT, OWNER);
    expect(quotes.map((q) => q.id)).toEqual(['mine']);
  });

  it('throws a labeled error on a DB failure', async () => {
    const sb = harness([]);
    sb.failOn.add('select:voc_quotes');
    await expect(getQuoteBank(sb.client, CLIENT, OWNER)).rejects.toThrow(/getQuoteBank/);
  });
});

describe('formatQuotesForPrompt', () => {
  it('renders one tagged line per quote', () => {
    const rows: VocQuoteRow[] = [
      {
        id: 'q1', document_id: 'd1', client_id: CLIENT, owner_user_id: OWNER,
        quote: 'הייתי מתביישת לחייך', extractable: 'pain', polarity: 'positive',
        segment_tags: {}, atom_action: null, funnel_fit: 'TOFU', created_at: '2026-07-01T00:00:00Z',
      },
      {
        id: 'q2', document_id: 'd1', client_id: CLIENT, owner_user_id: OWNER,
        quote: 'בלי לחץ', extractable: 'proof', polarity: 'positive',
        segment_tags: {}, atom_action: null, funnel_fit: null, created_at: '2026-07-01T00:00:00Z',
      },
    ];
    expect(formatQuotesForPrompt(rows)).toBe(
      '- "הייתי מתביישת לחייך" [pain · TOFU]\n- "בלי לחץ" [proof]',
    );
  });

  it('returns an empty string for an empty bank', () => {
    expect(formatQuotesForPrompt([])).toBe('');
  });
});
