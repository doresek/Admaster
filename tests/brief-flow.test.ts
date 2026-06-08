// Characterization tests for the BRIEF flow.
//
// These lock in what the code does TODAY (warts included), not what we may
// want later. They are a safety net for an upcoming refactor of the brief →
// client matching / Brand-DNA merge path.
//
// Covered:
//   1. buildAiContext brief→client matching by biz_name substring (lib/ai-context.ts)
//      — including the ambiguous two-similar-clients case.
//   2. buildAiContext Brand-DNA merge from users.brand.
//   3. The brief status derivation new / has_avatar / complete.
//      (NOTE: this lives in a SQL BEFORE-UPDATE trigger — update_brief_status in
//       supabase/migrations/001_schema.sql — so it is not importable JS. The
//       function below is a faithful MIRROR of that trigger and the assertions
//       lock its documented truth table. See the coupling finding in the report.)

import { describe, it, expect } from 'vitest';
import { buildAiContext } from '@/lib/ai-context';

// ── Minimal chainable Supabase mock ─────────────────────────────
// buildAiContext issues three query shapes, all terminating in either
// `.maybeSingle()` or `.limit(n)`. Each `.from(table)` resolves to the
// pre-canned result for that table, regardless of the chained filters.
// Terminal resolvers (.maybeSingle/.single) collapse an array fixture to its
// first row — emulating `.order(...).limit(1).maybeSingle()`. Object fixtures
// (users/meta_clients, explicit-briefId) pass straight through.
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

// ════════════════════════════════════════════════════════════════
// 1. Brief → client matching by briefs.client_id (deterministic link)
// ════════════════════════════════════════════════════════════════
// The biz_name substring matching has been removed. The brief inherits its
// client_id at submit time, and buildAiContext now looks it up directly:
//   briefs WHERE client_id = activeClientId ORDER BY submitted_at DESC LIMIT 1.
// The mock returns whatever the (client_id-filtered) briefs query would yield.
describe('buildAiContext: brief→client matching by client_id', () => {
  it('resolves the brief linked to the active client by client_id', async () => {
    const supabase = makeSupabase({
      users:        { data: { brand: null } },
      meta_clients: { data: { id: CLIENT_ID, name: 'Pizza Palace', industry: null, emoji: '🍕' } },
      briefs:       { data: [
        { values: { biz_name: 'Pizza Palace Tel Aviv', biz_what: 'wood-fired pizza' }, avatar: null, ads: null, funnel: null, status: 'new' },
      ] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.briefText).toContain('wood-fired pizza');
  });

  it('matches even when biz_name bears NO resemblance to the client name (name is irrelevant now)', async () => {
    // Old substring logic would have failed this; the client_id link does not.
    const supabase = makeSupabase({
      users:        { data: { brand: null } },
      meta_clients: { data: { id: CLIENT_ID, name: 'Pizza Palace', industry: null, emoji: null } },
      briefs:       { data: [
        { values: { biz_name: 'Totally Different Co', biz_what: 'omakase bar' }, avatar: null, ads: null, funnel: null, status: 'new' },
      ] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.briefText).toContain('omakase bar');
  });

  it('client with no linked brief → briefText empty', async () => {
    const supabase = makeSupabase({
      users:        { data: { brand: null } },
      meta_clients: { data: { id: CLIENT_ID, name: 'Pizza Palace', industry: null, emoji: null } },
      briefs:       { data: [] },   // client_id filter matched nothing
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.briefText).toBe('');
  });

  it('FORMERLY-AMBIGUOUS: two similarly-named businesses now resolve by client_id, not name', async () => {
    // Two "Bloom" businesses exist, but the client_id filter returns only the
    // one belonging to the active client — deterministic, no name tie-break.
    // The mock yields the client_id-filtered row (Bloom Bakery for this client).
    const supabase = makeSupabase({
      users:        { data: { brand: null } },
      meta_clients: { data: { id: CLIENT_ID, name: 'Bloom', industry: null, emoji: null } },
      briefs:       { data: [
        { values: { biz_name: 'Bloom Bakery', biz_what: 'artisan bread' }, avatar: null, ads: null, funnel: null, status: 'new' },
      ] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.briefText).toContain('artisan bread');     // the row linked to THIS client
    expect(ctx.briefText).not.toContain('fresh flowers'); // the other Bloom is never considered
  });

  it('no active client → brief lookup is skipped entirely (briefText empty)', async () => {
    const supabase = makeSupabase({
      users:  { data: { brand: null } },
      briefs: { data: [
        { values: { biz_name: 'Pizza Palace', biz_what: 'pizza' }, avatar: null, ads: null, funnel: null, status: 'new' },
      ] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID }); // no clientId
    expect(ctx.client).toBeNull();
    expect(ctx.briefText).toBe('');
  });

  it('explicit briefId bypasses client_id lookup and loads that brief directly', async () => {
    const supabase = makeSupabase({
      users:  { data: { brand: null } },
      briefs: { data: { values: { biz_name: 'Anything', biz_what: 'explicit brief body' }, avatar: null, ads: null, funnel: null, status: 'new' } },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, briefId: 'brief-99' });
    expect(ctx.briefText).toContain('explicit brief body');
  });
});

// ════════════════════════════════════════════════════════════════
// 2. Brand DNA merge from users.brand
// ════════════════════════════════════════════════════════════════
describe('buildAiContext: Brand DNA merge', () => {
  it('formats present brand fields into the BRAND DNA block', async () => {
    const supabase = makeSupabase({
      users: { data: { brand: {
        name: 'AdMaster', tagline: 'We scale', tone: 'bold', audience: 'SMBs', usp: 'AI-first',
      } } },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID });
    expect(ctx.brand).toEqual({ name: 'AdMaster', tagline: 'We scale', tone: 'bold', audience: 'SMBs', usp: 'AI-first' });
    expect(ctx.brandText).toContain("MARKETER'S BRAND DNA");
    expect(ctx.brandText).toContain('Brand name: AdMaster');
    expect(ctx.brandText).toContain('Brand voice/tone: bold');
    expect(ctx.brandText).toContain('Primary audience: SMBs');
  });

  it('omits fields that are absent (only present keys render lines)', async () => {
    const supabase = makeSupabase({
      users: { data: { brand: { name: 'AdMaster', website: 'x.co' } } },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID });
    expect(ctx.brandText).toContain('Brand name: AdMaster');
    expect(ctx.brandText).toContain('Website: x.co');
    expect(ctx.brandText).not.toContain('Tagline:');
    expect(ctx.brandText).not.toContain('Phone:');
  });

  it('null brand → empty brandText and null brand', async () => {
    const supabase = makeSupabase({ users: { data: { brand: null } } });
    const ctx = await buildAiContext(supabase, { userId: USER_ID });
    expect(ctx.brand).toBeNull();
    expect(ctx.brandText).toBe('');
  });

  it('brand object with no usable values → empty brandText (no DNA header)', async () => {
    const supabase = makeSupabase({ users: { data: { brand: { name: '', tagline: '' } } } });
    const ctx = await buildAiContext(supabase, { userId: USER_ID });
    expect(ctx.brandText).toBe('');
  });

  it('combined merges brand + client + brief in that order, joined by blank lines', async () => {
    const supabase = makeSupabase({
      users:        { data: { brand: { name: 'AdMaster' } } },
      meta_clients: { data: { id: CLIENT_ID, name: 'Bloom', industry: 'florist', emoji: '🌸' } },
      briefs:       { data: [
        { values: { biz_name: 'Bloom', biz_what: 'fresh flowers' }, avatar: null, ads: null, funnel: null, status: 'new', submitted_at: '2026-02-01' },
      ] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toBe([ctx.brandText, ctx.clientText, ctx.briefText].join('\n\n'));
    // sanity: all three segments are non-empty here
    expect(ctx.brandText).not.toBe('');
    expect(ctx.clientText).toContain('Bloom');
    expect(ctx.briefText).toContain('fresh flowers');
  });
});

// ════════════════════════════════════════════════════════════════
// 3. Brief status derivation (new / has_avatar / complete)
// ════════════════════════════════════════════════════════════════
// MIRROR of the SQL trigger public.update_brief_status (001_schema.sql:220-234).
// This is intentionally NOT exported from production code — see coupling finding.
// NOTE: as of migration 015_brief_status_insert the trigger fires on
// BEFORE INSERT OR UPDATE (was UPDATE-only), so the same derivation now applies
// at insert time too. The truth table below is unchanged — only the firing
// events changed in SQL.
// Trigger logic (BEFORE INSERT OR UPDATE on briefs):
//   funnel IS NOT NULL  → 'complete'
//   ELSIF avatar NOT NULL → 'has_avatar'
//   ELSE                  → 'new'
function deriveBriefStatus(b: { avatar: string | null; funnel: string | null }):
  'new' | 'has_avatar' | 'complete' {
  if (b.funnel != null) return 'complete';
  if (b.avatar != null) return 'has_avatar';
  return 'new';
}

describe('brief status derivation (mirror of SQL trigger update_brief_status)', () => {
  it('no avatar, no funnel → new', () => {
    expect(deriveBriefStatus({ avatar: null, funnel: null })).toBe('new');
  });

  it('avatar present, no funnel → has_avatar', () => {
    expect(deriveBriefStatus({ avatar: 'some avatar', funnel: null })).toBe('has_avatar');
  });

  it('funnel present → complete (regardless of avatar)', () => {
    expect(deriveBriefStatus({ avatar: null, funnel: 'a funnel' })).toBe('complete');
  });

  it('funnel wins over avatar when both are present', () => {
    expect(deriveBriefStatus({ avatar: 'some avatar', funnel: 'a funnel' })).toBe('complete');
  });
});
