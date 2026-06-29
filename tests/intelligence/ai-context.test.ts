// Tests for lib/ai-context.ts buildAiContext — specifically the Part-2 extension
// that returns the insight ids the context grounded on (for artifact tagging),
// while keeping the existing return fields.
import { describe, it, expect } from 'vitest';
import { buildAiContext } from '@/lib/ai-context';

// Minimal chainable Supabase mock: every builder method returns itself; the
// terminal reads (maybeSingle / awaited order) resolve canned data keyed by table.
function mockSupabase(data: Record<string, { single?: any; list?: any[] }>): any {
  return {
    from(table: string) {
      const b: any = {
        select: () => b,
        eq:     () => b,
        order:  () => b,
        limit:  () => b,
        maybeSingle: () => Promise.resolve({ data: data[table]?.single ?? null, error: null }),
        then: (resolve: any) => resolve({ data: data[table]?.list ?? [], error: null }),
      };
      return b;
    },
  };
}

describe('buildAiContext insightIds (Part-2 extension)', () => {
  it('returns the ids of the active insights it grounded on', async () => {
    const supabase = mockSupabase({
      clients:         { single: { id: 'c1', name: 'Acme' } },
      client_strategy: { single: null },
      briefs:          { single: null },
      client_insights: {
        list: [
          { id: 'i1', layer: 'business',  kind: 'real_usp', content: 'הליווי האישי', confidence: 0.9 },
          { id: 'i2', layer: 'customers', kind: 'pain',     content: 'אין זמן',       confidence: 0.8 },
          { id: 'i3', layer: 'bridge',    kind: 'platform', content: 'Facebook',       confidence: 0.7 },
        ],
      },
    });

    const ctx = await buildAiContext(supabase, { userId: 'u1', clientId: 'c1' });

    expect(ctx.insightIds).toEqual(['i1', 'i2', 'i3']);
    expect(ctx.client?.name).toBe('Acme');
    expect(ctx.combined).toContain('LIVING INSIGHTS');
  });

  it('returns an empty insightIds array when there is no client', async () => {
    const supabase = mockSupabase({});
    const ctx = await buildAiContext(supabase, { userId: 'u1' });
    expect(ctx.insightIds).toEqual([]);
    expect(ctx.client).toBeNull();
  });

  it('returns an empty insightIds array when the client has no active insights', async () => {
    const supabase = mockSupabase({
      clients:         { single: { id: 'c1', name: 'Acme' } },
      client_strategy: { single: null },
      briefs:          { single: null },
      client_insights: { list: [] },
    });
    const ctx = await buildAiContext(supabase, { userId: 'u1', clientId: 'c1' });
    expect(ctx.insightIds).toEqual([]);
  });
});
