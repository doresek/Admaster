// Tests for the dormant-safe creative-image path.
//
// (a) injected fake generator → returns the uploaded URL, artifact content gets
//     image_url wired through masterStudioGenerator.
// (b) no provider configured → returns null and the creative falls back
//     (imageUrl undefined) WITHOUT throwing.
// (c) provider/generator throws → returns null (dormant-safe).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── uploadToStorage is mocked so nothing touches Supabase Storage ────────────
const uploadMock = vi.fn();
vi.mock('@/lib/image-storage', () => ({
  GENERATED_IMAGES_BUCKET: 'generated-images',
  uploadToStorage: (...args: unknown[]) => uploadMock(...args),
}));
// callVertexImageGen must never run in these tests (no injected generator uses it).
const vertexMock = vi.fn();
vi.mock('@/lib/vertex-ai', () => ({
  callVertexImageGen: (...args: unknown[]) => vertexMock(...args),
}));

import {
  generateAndStoreCreativeImage,
  hasImageProvider,
} from '@/lib/campaigns/creative-image';

const fakeSupabase = {} as unknown as SupabaseClient;

const PROVIDER_KEYS = ['GOOGLE_SERVICE_ACCOUNT_JSON', 'IDEOGRAM_API_KEY', 'OPENAI_API_KEY'] as const;
function clearProviderEnv() {
  for (const k of PROVIDER_KEYS) delete process.env[k];
}

beforeEach(() => {
  clearProviderEnv();
  uploadMock.mockReset();
  vertexMock.mockReset();
});
afterEach(() => {
  clearProviderEnv();
});

describe('hasImageProvider', () => {
  it('is false with no provider env', () => {
    expect(hasImageProvider()).toBe(false);
  });
  it('is true when any provider key is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(hasImageProvider()).toBe(true);
  });
});

describe('generateAndStoreCreativeImage', () => {
  // (a) injected fake generator → uploads bytes and returns the public URL
  it('returns the uploaded URL from an injected generator', async () => {
    uploadMock.mockResolvedValue('https://cdn.example.com/u1/img.png');
    const generate = vi.fn().mockResolvedValue({ base64: 'AAAA', mimeType: 'image/png' });

    const url = await generateAndStoreCreativeImage(fakeSupabase, 'u1', 'a bright feed ad', {
      deps: { generate },
    });

    expect(url).toBe('https://cdn.example.com/u1/img.png');
    expect(generate).toHaveBeenCalledWith('a bright feed ad', '1:1');
    expect(uploadMock).toHaveBeenCalledWith(fakeSupabase, 'u1', 'AAAA', 'image/png');
    expect(vertexMock).not.toHaveBeenCalled();
  });

  it('honours a custom aspect ratio', async () => {
    uploadMock.mockResolvedValue('https://cdn.example.com/u1/wide.png');
    const generate = vi.fn().mockResolvedValue({ base64: 'BBBB', mimeType: 'image/png' });

    await generateAndStoreCreativeImage(fakeSupabase, 'u1', 'wide ad', {
      aspectRatio: '16:9',
      deps: { generate },
    });

    expect(generate).toHaveBeenCalledWith('wide ad', '16:9');
  });

  // (b) no provider → null, no throw, no upload
  it('returns null with no provider configured (dormant) and never throws', async () => {
    const url = await generateAndStoreCreativeImage(fakeSupabase, 'u1', 'some prompt');
    expect(url).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('returns null for an empty prompt even with an injected generator', async () => {
    const generate = vi.fn();
    const url = await generateAndStoreCreativeImage(fakeSupabase, 'u1', '   ', { deps: { generate } });
    expect(url).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  // (c) generator throws → null (dormant-safe)
  it('returns null when the generator throws (dormant-safe)', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('quota exhausted'));
    const url = await generateAndStoreCreativeImage(fakeSupabase, 'u1', 'prompt', { deps: { generate } });
    expect(url).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('returns null when upload throws (dormant-safe)', async () => {
    uploadMock.mockRejectedValue(new Error('storage down'));
    const generate = vi.fn().mockResolvedValue({ base64: 'AAAA', mimeType: 'image/png' });
    const url = await generateAndStoreCreativeImage(fakeSupabase, 'u1', 'prompt', { deps: { generate } });
    expect(url).toBeNull();
  });

  it('returns null when the generator yields no bytes', async () => {
    const generate = vi.fn().mockResolvedValue(null);
    const url = await generateAndStoreCreativeImage(fakeSupabase, 'u1', 'prompt', { deps: { generate } });
    expect(url).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
