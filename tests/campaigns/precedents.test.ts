// Unit tests for lib/campaigns/precedents.ts — the graceful episodic recaller.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decide } from '@/lib/decision-engine';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';

// Mock the episodic module BEFORE importing the unit under test.
const recallSimilarMock = vi.fn();
const defaultEmbedderMock = vi.fn();
vi.mock('@/lib/episodic', () => ({
  recallSimilar: (...args: unknown[]) => recallSimilarMock(...args),
  defaultEmbedder: () => defaultEmbedderMock(),
}));

import { decisionContextText, episodicRecaller } from '@/lib/campaigns/precedents';

const decision = decide({ client: { id: 'c1', name: 'Acme' }, insights: sampleInsights(), strategy: null });
// The recaller never touches the client itself — the mocked recallSimilar does.
const admin = {} as unknown as SupabaseClient;

afterEach(() => {
  recallSimilarMock.mockReset();
  defaultEmbedderMock.mockReset();
});

describe('decisionContextText', () => {
  it('mirrors the episode-composition vocabulary (angle/audience/funnel/rationale)', () => {
    const text = decisionContextText(decision);
    expect(text).toContain(`Angle: ${decision.angle}`);
    expect(text).toContain(decision.sub_audience);
    expect(text).toContain(decision.funnel_stage);
    expect(text).toContain(decision.rationale);
  });
});

describe('episodicRecaller', () => {
  it('returns summaries + episode ids on success (client scope, k respected)', async () => {
    defaultEmbedderMock.mockReturnValue({ id: 'test', embed: async () => [[0]] });
    recallSimilarMock.mockResolvedValue({
      scope: 'client', k: 3,
      matches: [
        { id: 'ep-1', precedent_summary: '[win] …' },
        { id: 'ep-2', precedent_summary: '[loss] …' },
      ],
    });
    const block = await episodicRecaller(admin, 3)({ clientId: 'c1', ownerUserId: 'o1', decision });
    expect(block.summaries).toEqual(['[win] …', '[loss] …']);
    expect(block.episodeIds).toEqual(['ep-1', 'ep-2']);
    expect(block.note).toBeUndefined();
    const [, , query] = recallSimilarMock.mock.calls[0] as [unknown, unknown, { scope: string; k: number }];
    expect(query.scope).toBe('client');
    expect(query.k).toBe(3);
  });

  it('no embedder key → degrades to zero precedents with a note (never throws)', async () => {
    defaultEmbedderMock.mockImplementation(() => { throw new Error('GOOGLE_AI_API_KEY missing'); });
    const block = await episodicRecaller(admin)({ clientId: 'c1', ownerUserId: 'o1', decision });
    expect(block.summaries).toEqual([]);
    expect(block.note).toContain('precedent recall skipped');
    expect(recallSimilarMock).not.toHaveBeenCalled();
  });

  it('recall failure → degrades with a note (never throws)', async () => {
    defaultEmbedderMock.mockReturnValue({ id: 'test', embed: async () => [[0]] });
    recallSimilarMock.mockRejectedValue(new Error('rpc down'));
    const block = await episodicRecaller(admin)({ clientId: 'c1', ownerUserId: 'o1', decision });
    expect(block.summaries).toEqual([]);
    expect(block.note).toContain('rpc down');
  });
});
