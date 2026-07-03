// Store tests over the in-memory PostgREST mock: append-only versioning (+ the
// documented unique-violation race retry), the funnel status state machine,
// the one-query coverage report with silent-pillar flags, and the composed
// synthesizeAndSave skip-on-identical discipline.

import { describe, expect, it } from 'vitest';
import { synthesizeArchitecture } from '../architecture';
import {
  coverageReport,
  getLatestArchitecture,
  listArchitectureVersions,
  listFunnels,
  saveArchitecture,
  saveFunnel,
  updateFunnelStatus,
} from '../store';
import { synthesizeAndSave } from '../synthesize-and-save';
import { designFunnel } from '../funnel';
import type { ArchitectureDraft } from '../types';
import { CLIENT_ID, OWNER_ID, allAtoms, dentalFixtures } from './fixtures';
import { mockSupabase, type MockRow } from './mock-supabase';

const draft = (): ArchitectureDraft =>
  synthesizeArchitecture({ insights: allAtoms() }).architecture;

const funnelDraft = () =>
  designFunnel({
    decision: { funnel_stage: 'BOFU', angle: 'לחייך בביטחון', awareness: 'most-aware' },
    insights: allAtoms(),
  }).funnel;

function harness() {
  const mock = mockSupabase();
  mock.uniqueOn('message_architectures', ['client_id', 'version']);
  return mock;
}

describe('saveArchitecture — append-only versioning', () => {
  it('first save is version 1; subsequent saves bump the version', async () => {
    const mock = harness();
    const v1 = await saveArchitecture(mock.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft(),
    });
    expect(v1.version).toBe(1);
    const v2 = await saveArchitecture(mock.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft(),
    });
    expect(v2.version).toBe(2);
    expect(mock.rows('message_architectures')).toHaveLength(2);
  });

  it('retries ONCE on a unique-violation race and lands on the next free version', async () => {
    const mock = harness();
    // Interleave a competing writer between read-max and insert, exactly once:
    // the store reads max=0, plans version 1, but the racer lands version 1
    // first → 23505 → retry reads max=1 and inserts version 2.
    let raced = false;
    mock.beforeInsert('message_architectures', () => {
      if (raced) return;
      raced = true;
      mock.rows('message_architectures').push({
        id: 'racer', client_id: CLIENT_ID, owner_user_id: OWNER_ID, version: 1,
        synth_meta: {}, created_at: '2026-06-01T00:00:00Z',
      });
    });

    const saved = await saveArchitecture(mock.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft(),
    });
    expect(saved.version).toBe(2);
    expect(mock.log.filter((l) => l === 'conflict:message_architectures')).toHaveLength(1);
    expect(mock.rows('message_architectures').map((r) => r.version).sort()).toEqual([1, 2]);
  });

  it('a persistent conflict (retry also loses) throws instead of looping', async () => {
    const mock = harness();
    // Pathological racer: ALWAYS lands the next version first.
    mock.beforeInsert('message_architectures', (payload) => {
      mock.rows('message_architectures').push({
        id: `racer-${String(payload.version)}`, client_id: CLIENT_ID, owner_user_id: OWNER_ID,
        version: payload.version, synth_meta: {}, created_at: '2026-06-01T00:00:00Z',
      });
    });
    await expect(
      saveArchitecture(mock.client, { clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft() }),
    ).rejects.toThrow(/version conflict persisted after retry/);
  });

  it('getLatestArchitecture returns the highest version; versions list is newest-first', async () => {
    const mock = harness();
    await saveArchitecture(mock.client, { clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft() });
    await saveArchitecture(mock.client, { clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft() });

    const latest = await getLatestArchitecture(mock.client, CLIENT_ID, OWNER_ID);
    expect(latest?.version).toBe(2);

    const versions = await listArchitectureVersions(mock.client, CLIENT_ID, OWNER_ID);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('getLatestArchitecture is null for a client with no synthesis yet', async () => {
    const mock = harness();
    expect(await getLatestArchitecture(mock.client, CLIENT_ID, OWNER_ID)).toBeNull();
  });
});

describe('funnel store — status state machine', () => {
  it('saves a draft funnel and lists it', async () => {
    const mock = harness();
    const saved = await saveFunnel(mock.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: funnelDraft(),
    });
    expect(saved.status).toBe('draft');
    expect(saved.campaign_id).toBeNull();
    const listed = await listFunnels(mock.client, CLIENT_ID, OWNER_ID);
    expect(listed.map((x) => x.id)).toEqual([saved.id]);
    expect(await listFunnels(mock.client, CLIENT_ID, OWNER_ID, 'active')).toEqual([]);
  });

  it('allows draft→active→archived', async () => {
    const mock = harness();
    const saved = await saveFunnel(mock.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: funnelDraft(),
    });
    const active = await updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'active');
    expect(active.status).toBe('active');
    const archived = await updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'archived');
    expect(archived.status).toBe('archived');
  });

  it('rejects every invalid transition', async () => {
    const mock = harness();
    const saved = await saveFunnel(mock.client, {
      clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: funnelDraft(),
    });
    // draft→archived skips activation.
    await expect(updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'archived'))
      .rejects.toThrow(/illegal transition draft→archived/);
    await updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'active');
    // active→draft goes backwards.
    await expect(updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'draft'))
      .rejects.toThrow(/illegal transition active→draft/);
    await updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'archived');
    // archived is terminal.
    await expect(updateFunnelStatus(mock.client, saved.id, OWNER_ID, 'active'))
      .rejects.toThrow(/illegal transition archived→active/);
  });

  it('errors on a missing funnel instead of silently no-oping', async () => {
    const mock = harness();
    await expect(updateFunnelStatus(mock.client, 'nope', OWNER_ID, 'active'))
      .rejects.toThrow(/not found/);
  });
});

describe('coverageReport — content-per-pillar over the window', () => {
  const artifact = (pillarKey: string | null, createdAt: string, via: 'content' | 'generated_from' = 'content'): MockRow => ({
    id: `art-${Math.random().toString(36).slice(2, 8)}`,
    client_id: CLIENT_ID,
    owner_user_id: OWNER_ID,
    content:        via === 'content' ? (pillarKey ? { pillar_ref: pillarKey } : {}) : {},
    generated_from: via === 'generated_from' ? (pillarKey ? { pillar_ref: pillarKey } : {}) : {},
    created_at: createdAt,
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  it('counts per pillar, flags the silent pillar, respects the window — with ONE artifacts query', async () => {
    const mock = harness();
    await saveArchitecture(mock.client, { clientId: CLIENT_ID, ownerUserId: OWNER_ID, draft: draft() });
    mock.seed('content_artifacts', [
      artifact('desire-core', daysAgo(2)),
      artifact('desire-core', daysAgo(10)),
      artifact('objection-main', daysAgo(5), 'generated_from'), // alternate tag location
      artifact('mechanism-proof', daysAgo(45)),                 // OUTSIDE the 30d window
      artifact(null, daysAgo(1)),                               // untagged — counts nowhere
    ]);

    const before = mock.log.filter((l) => l === 'select:content_artifacts').length;
    const report = await coverageReport(mock.client, CLIENT_ID, OWNER_ID, 30);
    expect(mock.log.filter((l) => l === 'select:content_artifacts').length - before).toBe(1);

    expect(report.window_days).toBe(30);
    const byKey = new Map(report.pillars.map((p) => [p.key, p]));
    expect(byKey.get('desire-core')?.artifact_count).toBe(2);
    expect(byKey.get('desire-core')?.silent).toBe(false);
    expect(byKey.get('desire-core')?.last_artifact_at).not.toBeNull();
    expect(byKey.get('objection-main')?.artifact_count).toBe(1);
    // mechanism's only artifact is outside the window → SILENT (the skill's
    // "silence is a decision" flag) — and identity never had content at all.
    expect(byKey.get('mechanism-proof')?.silent).toBe(true);
    expect(byKey.get('mechanism-proof')?.last_artifact_at).toBeNull();
    expect(byKey.get('identity-belonging')?.silent).toBe(true);
  });

  it('no architecture yet → empty typed report, no throw', async () => {
    const mock = harness();
    const report = await coverageReport(mock.client, CLIENT_ID, OWNER_ID, 30);
    expect(report).toEqual({ pillars: [], window_days: 30 });
  });

  it('rejects a nonsensical window', async () => {
    const mock = harness();
    await expect(coverageReport(mock.client, CLIENT_ID, OWNER_ID, 0)).rejects.toThrow(/windowDays/);
  });
});

describe('synthesizeAndSave — composition + no version churn', () => {
  const seedInsights = (mock: ReturnType<typeof mockSupabase>) => {
    mock.seed(
      'client_insights',
      allAtoms(dentalFixtures()).map((a) => ({ ...a })),
    );
  };

  it('first run persists version 1 with the trigger recorded', async () => {
    const mock = harness();
    seedInsights(mock);
    const result = await synthesizeAndSave(mock.client, CLIENT_ID, OWNER_ID, 'brief');
    expect(result.skipped).toBe(false);
    expect(result.diff).toBeNull();
    expect(result.architecture.version).toBe(1);
    expect(result.architecture.synth_meta.trigger).toBe('brief');
  });

  it('unchanged atoms → identical projection → SKIPPED, no new version', async () => {
    const mock = harness();
    seedInsights(mock);
    await synthesizeAndSave(mock.client, CLIENT_ID, OWNER_ID, 'brief');
    const second = await synthesizeAndSave(mock.client, CLIENT_ID, OWNER_ID, 'atom_drift');
    expect(second.skipped).toBe(true);
    expect(second.reason).toContain('no version churn');
    expect(second.architecture.version).toBe(1);
    expect(second.diff?.identical).toBe(true);
    expect(mock.rows('message_architectures')).toHaveLength(1);
  });

  it('a material atom change → new version with the diff attached', async () => {
    const mock = harness();
    seedInsights(mock);
    await synthesizeAndSave(mock.client, CLIENT_ID, OWNER_ID, 'brief');
    // The identity pillar's atoms get refuted → the pillar must vanish.
    for (const row of mock.rows('client_insights')) {
      if (row.kind === 'persona' || row.kind === 'unspoken_want') row.status = 'refuted';
    }
    const result = await synthesizeAndSave(mock.client, CLIENT_ID, OWNER_ID, 'atom_drift');
    expect(result.skipped).toBe(false);
    expect(result.architecture.version).toBe(2);
    expect(result.diff?.removed).toEqual(['identity-belonging']);
  });
});
