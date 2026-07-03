// Wire-in test: masterStudioGenerator turns the studio's image PROMPT into a
// real stored URL when a provider is available (mocked here), stamping
// `image_url` into the artifact content (so publish.ts skips the placeholder)
// and setting `imageUrl` on the returned creative. With generation dormant
// (returns null) it keeps `image` = prompt only and imageUrl stays undefined.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decide } from '@/lib/decision-engine';
import { sampleInsights } from '@/lib/decision-engine/__tests__/fixtures';

const pipelineMock = vi.fn();
vi.mock('@/lib/master-studio/pipeline', () => ({
  runMasterPipeline: (...args: unknown[]) => pipelineMock(...args),
}));
vi.mock('@/lib/ai-context', () => ({
  buildAiContext: async () => ({ combined: 'CTX' }),
}));
const recordedArtifacts: Record<string, unknown>[] = [];
vi.mock('@/lib/intelligence/artifacts', () => ({
  contextHash: () => 'ctx-hash',
  recordArtifactWith: async (_f: unknown, args: Record<string, unknown>) => {
    recordedArtifacts.push(args);
    return { id: 'artifact-1' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/voc', () => ({
  getQuoteBank: async () => [],
  formatQuotesForPrompt: () => '',
}));
// The creative-image module is mocked so no provider / network is involved; the
// test toggles what it returns.
const creativeImageMock = vi.fn();
vi.mock('@/lib/campaigns/creative-image', () => ({
  generateAndStoreCreativeImage: (...args: unknown[]) => creativeImageMock(...args),
}));

import { masterStudioGenerator } from '@/lib/campaigns/generate';

const decision = decide({ client: { id: 'c1', name: 'Acme' }, insights: sampleInsights(), strategy: null });

function pipelineWinner(post: string) {
  return {
    ok: true,
    output: {
      winner: { draft: { post, hashtags: ['#x'], whatsapp: 'wa', image: 'AN IMAGE PROMPT' }, marketer: 'M', score: 9 },
      avatar: null,
    },
  };
}

function makeGenerator() {
  return masterStudioGenerator({
    userId: 'o1',
    supabase: {} as unknown as SupabaseClient,
    anthropic: {} as unknown as Anthropic,
    model: 'test-model',
  });
}

afterEach(() => {
  pipelineMock.mockReset();
  creativeImageMock.mockReset();
  recordedArtifacts.length = 0;
});

describe('masterStudioGenerator — creative image wire-in', () => {
  it('stamps image_url + sets imageUrl when generation yields a URL', async () => {
    pipelineMock.mockResolvedValue(pipelineWinner('פוסט נקי'));
    creativeImageMock.mockResolvedValue('https://cdn.example.com/o1/real.png');

    const creative = await makeGenerator()({
      clientId: 'c1', ownerUserId: 'o1', channel: 'meta_paid', decision,
    });

    // The generator was asked to turn the studio's prompt into a real image.
    expect(creativeImageMock).toHaveBeenCalledWith(expect.anything(), 'o1', 'AN IMAGE PROMPT');
    // Returned creative carries the real URL (publish.ts reads imageUrl).
    expect(creative.imageUrl).toBe('https://cdn.example.com/o1/real.png');
    // Artifact content has BOTH the prompt (image) and the URL (image_url).
    const content = recordedArtifacts[0].content as Record<string, unknown>;
    expect(content.image).toBe('AN IMAGE PROMPT');
    expect(content.image_url).toBe('https://cdn.example.com/o1/real.png');
  });

  it('dormant (null) → keeps image=prompt only, imageUrl undefined, no throw', async () => {
    pipelineMock.mockResolvedValue(pipelineWinner('פוסט נקי'));
    creativeImageMock.mockResolvedValue(null);

    const creative = await makeGenerator()({
      clientId: 'c1', ownerUserId: 'o1', channel: 'meta_paid', decision,
    });

    expect(creative.imageUrl).toBeUndefined();
    const content = recordedArtifacts[0].content as Record<string, unknown>;
    expect(content.image).toBe('AN IMAGE PROMPT');
    expect(content.image_url).toBeUndefined();
  });
});
