// Tests for lib/intelligence/artifacts.ts — the content_artifacts data layer.
import { describe, it, expect } from 'vitest';
import { recordArtifact, recordArtifactSafe, listArtifacts, updateArtifactStatus, contextHash } from '@/lib/intelligence/artifacts';
import { makeFakeDb } from './fake-admin';

describe('recordArtifact', () => {
  it('inserts a content_artifacts row with the right shape + tags', async () => {
    const db = makeFakeDb();
    const out = await recordArtifact(db.admin, {
      clientId:    'c1',
      ownerUserId: 'u1',
      type:        'post',
      content:     { post: 'שלום עולם', hashtags: ['#a', '#b'] },
      framework:   'pas',
      angle:       'שאלה פרובוקטיבית',
      insightIds:  ['i1', 'i2'],
      generatedFrom: { model: 'claude-sonnet-4-6', context_hash: 'deadbeef' },
    });

    expect(db.content_artifacts).toHaveLength(1);
    const row = db.content_artifacts[0];
    expect(row.client_id).toBe('c1');
    expect(row.owner_user_id).toBe('u1');
    expect(row.type).toBe('post');
    expect(row.content).toEqual({ post: 'שלום עולם', hashtags: ['#a', '#b'] });
    expect(row.framework).toBe('pas');
    expect(row.angle).toBe('שאלה פרובוקטיבית');
    expect(row.insight_ids).toEqual(['i1', 'i2']);
    expect(row.generated_from).toEqual({ model: 'claude-sonnet-4-6', context_hash: 'deadbeef' });
    expect(row.status).toBe('draft');           // default
    expect(out.id).toBeTruthy();
  });

  it('normalizes an empty insightIds array to null and defaults optional tags', async () => {
    const db = makeFakeDb();
    await recordArtifact(db.admin, {
      clientId: 'c1', ownerUserId: 'u1', type: 'creative_image',
      content: { url: 'https://x/y.png' }, insightIds: [],
    });
    const row = db.content_artifacts[0];
    expect(row.insight_ids).toBeNull();
    expect(row.framework).toBeNull();
    expect(row.parent_id).toBeNull();
    expect(row.status).toBe('draft');
  });

  it('recordArtifactSafe never throws (returns null) on a failing client', async () => {
    const brokenAdmin: any = { from: () => { throw new Error('boom'); } };
    const out = await recordArtifactSafe(brokenAdmin, {
      clientId: 'c1', ownerUserId: 'u1', type: 'post', content: {},
    });
    expect(out).toBeNull();
  });
});

describe('listArtifacts / updateArtifactStatus', () => {
  it('lists by client (and by type) and updates status', async () => {
    const db = makeFakeDb();
    await recordArtifact(db.admin, { clientId: 'c1', ownerUserId: 'u1', type: 'post', content: { p: 1 } });
    const img = await recordArtifact(db.admin, { clientId: 'c1', ownerUserId: 'u1', type: 'creative_image', content: { u: 'x' } });

    const all = await listArtifacts(db.admin, 'c1');
    expect(all).toHaveLength(2);
    const onlyImages = await listArtifacts(db.admin, 'c1', 'creative_image');
    expect(onlyImages).toHaveLength(1);
    expect(onlyImages[0].id).toBe(img.id);

    const updated = await updateArtifactStatus(db.admin, img.id, 'approved');
    expect(updated.status).toBe('approved');
  });
});

describe('contextHash', () => {
  it('is stable and differs for different inputs', () => {
    expect(contextHash('abc')).toBe(contextHash('abc'));
    expect(contextHash('abc')).not.toBe(contextHash('abd'));
    expect(contextHash('')).toMatch(/^[0-9a-f]{8}$/);
  });
});
