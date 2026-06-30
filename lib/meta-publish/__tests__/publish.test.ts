import { afterEach, describe, expect, it, vi } from 'vitest';
import { META_GRAPH_VERSION } from '../../meta-config';
import {
  MetaGraphError,
  MetaPublishClient,
  createMediaContainer,
  publishMedia,
  publishPagePhoto,
  publishPagePost,
} from '../index';

describe('MetaPublishClient construction', () => {
  it('defaults to dry-run and the configured graph version', () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });
    expect(c.dryRun).toBe(true);
    expect(c.graphVersion).toBe(META_GRAPH_VERSION);
    expect(c.graphBase).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}`);
    expect(c.calls).toEqual([]);
  });

  it('honours a graphVersion override', () => {
    const c = new MetaPublishClient({ accessToken: 'tok', graphVersion: 'v18.0' });
    expect(c.graphBase).toBe('https://graph.facebook.com/v18.0');
  });

  it('throws without an access token', () => {
    // @ts-expect-error intentionally missing accessToken
    expect(() => new MetaPublishClient({})).toThrow(/accessToken/);
  });
});

describe('dry-run Page publishing', () => {
  it('publishPagePost returns a synthetic id and records the feed payload', async () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });
    const res = await publishPagePost(c, {
      pageId: 'PAGE1',
      message: 'hello world',
      link: 'https://example.com',
    });

    expect(res.id).toBe('dryrun_post_1');
    expect(c.calls).toHaveLength(1);
    const call = c.calls[0];
    expect(call.dryRun).toBe(true);
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/PAGE1/feed');
    expect(call.endpoint).toBe(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/PAGE1/feed`,
    );
    expect(call.payload).toEqual({ message: 'hello world', link: 'https://example.com' });
    // The token must never be recorded.
    expect(JSON.stringify(call)).not.toContain('tok');
  });

  it('publishPagePost omits link when not provided', async () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });
    await publishPagePost(c, { pageId: 'P', message: 'no link' });
    expect(c.calls[0].payload).toEqual({ message: 'no link' });
  });

  it('publishPagePhoto records url + caption and returns synthetic id', async () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });
    const res = await publishPagePhoto(c, {
      pageId: 'PAGE2',
      message: 'a caption',
      imageUrl: 'https://cdn.example.com/a.jpg',
    });

    expect(res.id).toBe('dryrun_post_1');
    expect(c.calls[0].path).toBe('/PAGE2/photos');
    expect(c.calls[0].payload).toEqual({
      url: 'https://cdn.example.com/a.jpg',
      caption: 'a caption',
    });
  });

  it('increments the synthetic id per call', async () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });
    const a = await publishPagePost(c, { pageId: 'P', message: 'one' });
    const b = await publishPagePost(c, { pageId: 'P', message: 'two' });
    expect(a.id).toBe('dryrun_post_1');
    expect(b.id).toBe('dryrun_post_2');
    expect(c.calls).toHaveLength(2);
  });
});

describe('dry-run Instagram two-step flow', () => {
  it('creates a container then publishes it, in order', async () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });

    const container = await createMediaContainer(c, {
      igUserId: 'IG1',
      imageUrl: 'https://cdn.example.com/post.jpg',
      caption: 'shalom',
    });
    expect(container.id).toBe('dryrun_post_1');

    const published = await publishMedia(c, {
      igUserId: 'IG1',
      creationId: container.id,
    });
    expect(published.id).toBe('dryrun_post_2');

    // Ordering: /media must precede /media_publish.
    expect(c.calls.map((x) => x.path)).toEqual([
      '/IG1/media',
      '/IG1/media_publish',
    ]);

    // Step 1 payload carries image_url + caption.
    expect(c.calls[0].payload).toEqual({
      image_url: 'https://cdn.example.com/post.jpg',
      caption: 'shalom',
    });
    // Step 2 forwards the container id as creation_id.
    expect(c.calls[1].payload).toEqual({ creation_id: 'dryrun_post_1' });
  });

  it('createMediaContainer omits caption when absent', async () => {
    const c = new MetaPublishClient({ accessToken: 'tok' });
    await createMediaContainer(c, { igUserId: 'IG1', imageUrl: 'https://x/y.jpg' });
    expect(c.calls[0].payload).toEqual({ image_url: 'https://x/y.jpg' });
  });
});

describe('live mode (mocked fetch)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to Graph with the token in the Authorization header and returns the id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: '123_456' }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const c = new MetaPublishClient({ accessToken: 'SECRET', dryRun: false });
    const res = await publishPagePost(c, { pageId: 'P', message: 'hi' });

    expect(res.id).toBe('123_456');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as any).mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/P/feed`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer SECRET');
    // Body is form-encoded with the message, token absent.
    const body = init.body as URLSearchParams;
    expect(body.get('message')).toBe('hi');
    expect(body.toString()).not.toContain('SECRET');
    // The recorded call still excludes the token.
    expect(c.calls[0].dryRun).toBe(false);
    expect(JSON.stringify(c.calls[0])).not.toContain('SECRET');
  });

  it('parses a Graph error envelope into a typed MetaGraphError', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: 'Invalid OAuth access token.',
          type: 'OAuthException',
          code: 190,
          error_subcode: 463,
          fbtrace_id: 'AbCdEf',
        },
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const c = new MetaPublishClient({ accessToken: 'bad', dryRun: false });

    await expect(
      publishPagePost(c, { pageId: 'P', message: 'hi' }),
    ).rejects.toBeInstanceOf(MetaGraphError);

    try {
      await publishPagePost(c, { pageId: 'P', message: 'hi' });
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as MetaGraphError;
      expect(e).toBeInstanceOf(MetaGraphError);
      expect(e.message).toBe('Invalid OAuth access token.');
      expect(e.type).toBe('OAuthException');
      expect(e.code).toBe(190);
      expect(e.errorSubcode).toBe(463);
      expect(e.fbtraceId).toBe('AbCdEf');
      expect(e.status).toBe(400);
    }
  });

  it('runs the IG two-step live with a real creation_id between calls', async () => {
    const responses = [{ id: 'CONTAINER_99' }, { id: 'MEDIA_77' }];
    let i = 0;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => responses[i++],
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const c = new MetaPublishClient({ accessToken: 'tok', dryRun: false });
    const container = await createMediaContainer(c, {
      igUserId: 'IG',
      imageUrl: 'https://x/y.jpg',
    });
    const published = await publishMedia(c, { igUserId: 'IG', creationId: container.id });

    expect(container.id).toBe('CONTAINER_99');
    expect(published.id).toBe('MEDIA_77');
    const secondBody = (fetchMock as any).mock.calls[1][1].body as URLSearchParams;
    expect(secondBody.get('creation_id')).toBe('CONTAINER_99');
  });
});
