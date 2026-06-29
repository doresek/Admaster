// Tests for buildAiContext client-core emission (MASTER-PLAN W2.4a).
//
// Locks in two behaviours:
//   (a) a client WITH a structured `avatar` + `business_analysis` emits the new
//       `=== BUSINESS ANALYSIS ===` and `=== CLIENT AVATAR ===` blocks (and the
//       structured field values) into `combined`.
//   (b) a pre-spine client (NO core) with a legacy `briefs.avatar` still renders
//       the legacy "Saved customer avatar" text block and emits NEITHER new
//       marker — i.e. no regression for pre-spine clients.
//
// The Supabase mock mirrors tests/brief-flow.test.ts: each `.from(table)`
// resolves to a pre-canned fixture, terminal resolvers collapse array fixtures
// to their first row.

import { describe, it, expect } from 'vitest';
import { buildAiContext } from '@/lib/ai-context';

function makeSupabase(tables: Record<string, { data: any }>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: null };
      const one = () =>
        Promise.resolve(
          Array.isArray(result.data) ? { data: result.data[0] ?? null } : result,
        );
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: one,
        single: one,
      };
      return builder;
    },
  } as any;
}

const USER_ID = 'user-1';
const CLIENT_ID = 'client-1';

// Note: the marker glyphs use the box-drawing ═══ that buildAiContext emits.
const BA_MARKER = '═══ BUSINESS ANALYSIS ═══';
const AVATAR_MARKER = '═══ CLIENT AVATAR ═══';

describe('buildAiContext: client-core BUSINESS ANALYSIS + structured AVATAR', () => {
  it('(a) client WITH avatar + business_analysis emits both new blocks and field values', async () => {
    const supabase = makeSupabase({
      meta_clients: {
        data: {
          id: CLIENT_ID,
          name: 'Bloom',
          industry: 'florist',
          emoji: '🌸',
          core_generated_at: '2026-06-01T00:00:00Z',
          business_analysis: {
            completeness_score: 82,
            strengths: ['s1', 's2', 's3', 's4', 's5', 's6-should-be-capped'],
            gaps: ['g1', 'g2'],
            refinements: ['r1'],
          },
          avatar: {
            name: 'Dana the Bride',
            age: 29,
            occupation: 'event planner',
            pains: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6-capped'],
            desires: ['d1'],
            fears: ['f1'],
            objections: ['o1'],
            awareness_level: '3 - solution aware',
            recommended_angle: 'aspirational lifestyle',
            voice_quotes: ['"I want it perfect"'],
            buying_triggers: ['engagement'],
            recommended_creative_angles: ['soft pastels', 'natural light'],
          },
        },
      },
      briefs: { data: [] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });

    expect(ctx.combined).toContain(BA_MARKER);
    expect(ctx.combined).toContain(AVATAR_MARKER);
    // business_analysis field value
    expect(ctx.combined).toContain('completeness_score: 82');
    // avatar structured field values
    expect(ctx.combined).toContain('name: Dana the Bride');
    expect(ctx.combined).toContain('recommended_angle: aspirational lifestyle');
    expect(ctx.combined).toContain('recommended_creative_angles: soft pastels | natural light');
    // list capping: 6th item must NOT appear
    expect(ctx.combined).not.toContain('s6-should-be-capped');
    expect(ctx.combined).not.toContain('p6-capped');
    // ordering: BUSINESS ANALYSIS appears before CLIENT AVATAR
    expect(ctx.combined.indexOf(BA_MARKER)).toBeLessThan(ctx.combined.indexOf(AVATAR_MARKER));
  });

  it('(a2) transitional avatar shim { v1_text } emits raw text under the avatar marker', async () => {
    const supabase = makeSupabase({
      meta_clients: {
        data: {
          id: CLIENT_ID,
          name: 'Bloom',
          industry: null,
          emoji: null,
          business_analysis: null,
          avatar: { v1_text: 'persona: busy mom\nfears: wasting money' },
        },
      },
      briefs: { data: [] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toContain(AVATAR_MARKER);
    expect(ctx.combined).toContain('persona: busy mom');
    expect(ctx.combined).not.toContain(BA_MARKER); // no business_analysis present
  });

  it('(b) NO core but legacy briefs.avatar still renders legacy block and emits NO new markers', async () => {
    const supabase = makeSupabase({
      meta_clients: {
        // Pre-spine client: core columns are null.
        data: { id: CLIENT_ID, name: 'Bloom', industry: null, emoji: null, business_analysis: null, avatar: null, core_generated_at: null },
      },
      briefs: {
        data: [
          {
            values: { biz_name: 'Bloom', biz_what: 'fresh flowers' },
            avatar: 'LEGACY AVATAR: a 35yo bride planning her wedding',
            ads: null,
            funnel: null,
            status: 'has_avatar',
          },
        ],
      },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });

    // legacy avatar text block still renders (no regression)
    expect(ctx.combined).toContain('Saved customer avatar');
    expect(ctx.combined).toContain('LEGACY AVATAR: a 35yo bride planning her wedding');
    // and NO new client-core markers
    expect(ctx.combined).not.toContain(BA_MARKER);
    expect(ctx.combined).not.toContain(AVATAR_MARKER);
  });

  it('(b2) when client core avatar exists, the legacy briefs.avatar block is suppressed (no duplicate)', async () => {
    const supabase = makeSupabase({
      meta_clients: {
        data: {
          id: CLIENT_ID,
          name: 'Bloom',
          industry: null,
          emoji: null,
          business_analysis: null,
          avatar: { name: 'Core Dana', desires: ['d1'] },
        },
      },
      briefs: {
        data: [
          { values: { biz_name: 'Bloom', biz_what: 'fresh flowers' }, avatar: 'LEGACY TEXT AVATAR', ads: null, funnel: null, status: 'has_avatar' },
        ],
      },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toContain(AVATAR_MARKER);
    expect(ctx.combined).toContain('name: Core Dana');
    // legacy slice must NOT also render
    expect(ctx.combined).not.toContain('Saved customer avatar');
    expect(ctx.combined).not.toContain('LEGACY TEXT AVATAR');
  });
});
