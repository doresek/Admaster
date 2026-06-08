// Light tests for the client-card data helper (lib/client-card.ts).
// The underlying per-table client_id scoping is already covered elsewhere; this
// just locks the helper's ownership gate, parallel shape, and lead count.

import { describe, it, expect } from 'vitest';
import { fetchClientCardData, briefCompletionPct } from '@/lib/client-card';

// Chainable Supabase mock. Per-table results are pre-canned; terminal resolvers
// (.maybeSingle / awaited .limit / count head) return the configured payload.
function makeSupabase(tables: Record<string, any>) {
  return {
    from(table: string) {
      const res = tables[table] ?? {};
      const builder: any = {
        select: (_sel?: any, opts?: any) => { builder._head = opts?.head; return builder; },
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: res.one ?? null }),
        then: undefined,
      };
      // A head:true count select is awaited directly → resolve {count}.
      builder.then = (resolve: any) =>
        resolve(builder._head ? { count: res.count ?? 0 } : { data: res.rows ?? [] });
      return builder;
    },
  } as any;
}

describe('fetchClientCardData', () => {
  it('returns null when the client is not owned by the user', async () => {
    const supabase = makeSupabase({ meta_clients: { one: null } });
    const data = await fetchClientCardData(supabase, 'user-1', 'client-x');
    expect(data).toBeNull();
  });

  it('returns the assembled card for an owned client', async () => {
    const supabase = makeSupabase({
      meta_clients:     { one: { id: 'c1', name: 'Bloom', emoji: '🌸', industry: 'florist', status: 'connected' } },
      briefs:           { one: { id: 'b1', values: { biz_name: 'Bloom' }, status: 'new', submitted_at: '2026-02-01' } },
      generated_content:{ rows: [{ id: 'p1', type: 'post', platform: 'meta', output: { text: 'hi' }, created_at: '2026-02-02' }] },
      generated_images: { rows: [{ id: 'i1', image_url: 'u', prompt: 'p', created_at: '2026-02-02' }] },
      landing_pages:    { rows: [{ id: 'lp1', title: 'T', slug: 't', status: 'published', views: 5, conversions: 2 }] },
      landing_page_leads: { count: 7 },
    });

    const data = await fetchClientCardData(supabase, 'user-1', 'c1');
    expect(data).not.toBeNull();
    expect(data!.client.name).toBe('Bloom');
    expect(data!.brief?.id).toBe('b1');
    expect(data!.posts).toHaveLength(1);
    expect(data!.images).toHaveLength(1);
    expect(data!.landingPages).toHaveLength(1);
    expect(data!.leadCount).toBe(7);
  });

  it('skips the lead-count query and returns 0 when the client has no landing pages', async () => {
    const supabase = makeSupabase({
      meta_clients:  { one: { id: 'c1', name: 'Bloom', emoji: null, industry: null, status: 'connected' } },
      briefs:        { one: null },
      generated_content: { rows: [] },
      generated_images:  { rows: [] },
      landing_pages:     { rows: [] },
    });

    const data = await fetchClientCardData(supabase, 'user-1', 'c1');
    expect(data!.leadCount).toBe(0);
    expect(data!.brief).toBeNull();
    expect(data!.posts).toEqual([]);
  });
});

describe('briefCompletionPct', () => {
  it('is 0 for null/empty and rounds the filled ratio', () => {
    expect(briefCompletionPct(null)).toBe(0);
    expect(briefCompletionPct({})).toBe(0);
    // 21 fields; 21 filled → 100, a couple filled → small %.
    expect(briefCompletionPct({ biz_name: 'x' })).toBe(Math.round(100 / 21));
  });
});
