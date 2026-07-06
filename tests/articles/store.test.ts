// tests/articles/store.test.ts — P3-2 store: Hebrew-safe slugs + idempotent
// idea persistence against an in-memory stub of the admin client.

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArticleTopic } from '@/lib/articles';
import { saveTopicsAsIdeas, topicSlug } from '@/lib/articles';

function topic(over: Partial<ArticleTopic> & { title_he: string }): ArticleTopic {
  return {
    query_patterns:   ['כמה עולה טיפול שורש'],
    intent:           'commercial',
    content_type:     'mofu_pricing_comparison',
    kind:             'article',
    atomIds:          ['00000000-0000-0000-0000-000000000001'],
    injectionAtomIds: [],
    score:            0.9,
    confidence:       0.8,
    voc_backed:       false,
    rationale_he:     'סיבה',
    ...over,
  };
}

interface StoredRow { client_id: string; slug: string; [k: string]: unknown }

/** In-memory admin stub honoring the unique(client_id, slug) constraint. */
function makeAdminStub(opts: { failOn?: string } = {}) {
  const rows: StoredRow[] = [];
  const admin = {
    from(table: string) {
      if (table !== 'articles') throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: StoredRow) => {
          if (opts.failOn && row.slug.startsWith(opts.failOn)) {
            return { error: { code: 'XX000', message: 'boom' } };
          }
          if (rows.some((r) => r.client_id === row.client_id && r.slug === row.slug)) {
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          rows.push(row);
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, rows };
}

const CLIENT = 'c0000000-0000-0000-0000-000000000001';
const OWNER  = 'u0000000-0000-0000-0000-000000000001';

describe('topicSlug', () => {
  it('is Hebrew-safe (ascii kebab + stable hash suffix) and deterministic', () => {
    const slug = topicSlug('כמה עולה טיפול שורש?');
    expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}$/);
    expect(topicSlug('כמה עולה טיפול שורש?')).toBe(slug);
  });

  it('distinct Hebrew titles yield distinct slugs even when transliteration collides', () => {
    expect(topicSlug('שן')).not.toBe(topicSlug('סן'));
  });
});

describe('saveTopicsAsIdeas', () => {
  it('creates idea rows with the 054 shape', async () => {
    const { admin, rows } = makeAdminStub();
    const t = topic({ title_he: 'כמה עולה טיפול שורש? מחיר, כדאיות וכל התשובות' });

    const res = await saveTopicsAsIdeas({ topics: [t], clientId: CLIENT, ownerUserId: OWNER, admin });

    expect(res).toEqual({ created: 1, skipped: 0 });
    expect(rows[0]).toMatchObject({
      client_id:     CLIENT,
      owner_user_id: OWNER,
      title:         t.title_he,
      kind:          'article',
      status:        'idea',
      keywords:      t.query_patterns,
      grounded_in:   t.atomIds,
      rationale:     t.rationale_he,
    });
    expect(rows[0].topic_source).toEqual(t);
  });

  it('re-save is idempotent: duplicates are skipped, never churned', async () => {
    const { admin, rows } = makeAdminStub();
    const topics = [topic({ title_he: 'כותרת אחת' }), topic({ title_he: 'כותרת שנייה' })];

    const first  = await saveTopicsAsIdeas({ topics, clientId: CLIENT, ownerUserId: OWNER, admin });
    const second = await saveTopicsAsIdeas({ topics, clientId: CLIENT, ownerUserId: OWNER, admin });

    expect(first).toEqual({ created: 2, skipped: 0 });
    expect(second).toEqual({ created: 0, skipped: 2 });
    expect(rows).toHaveLength(2);
  });

  it('is best-effort per row — one failure never loses the rest, never throws', async () => {
    const bad  = topic({ title_he: 'שגיאה' });
    const good = topic({ title_he: 'תקין לגמרי' });
    const { admin, rows } = makeAdminStub({ failOn: topicSlug(bad.title_he).slice(0, 8) });

    const res = await saveTopicsAsIdeas({
      topics: [bad, good], clientId: CLIENT, ownerUserId: OWNER, admin,
    });

    expect(res).toEqual({ created: 1, skipped: 1 });
    expect(rows).toHaveLength(1);
  });
});
