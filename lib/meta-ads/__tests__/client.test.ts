import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { META_GRAPH_VERSION } from '../../meta-config';
import {
  MetaAdsClient,
  MetaAdsApiError,
  parseGraphError,
  encodeParams,
} from '../index';

describe('MetaAdsClient construction & dry-run defaults', () => {
  it('defaults to dry-run and normalises the ad account id', () => {
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '123' });
    expect(c.dryRun).toBe(true);
    expect(c.adAccountId).toBe('act_123');
  });

  it('keeps an already-prefixed ad account id', () => {
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: 'act_999' });
    expect(c.adAccountId).toBe('act_999');
  });

  it('uses the graph version from meta-config by default', () => {
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1' });
    expect(c.graphVersion).toBe(META_GRAPH_VERSION);
    expect(c.graphBase).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}`);
  });

  it('honours an explicit graphVersion override', () => {
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1', graphVersion: 'v19.0' });
    expect(c.graphBase).toBe('https://graph.facebook.com/v19.0');
  });

  it('starts with an empty call log', () => {
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1' });
    expect(c.calls).toEqual([]);
  });
});

describe('encodeParams', () => {
  it('stringifies scalars and JSON-encodes objects/arrays, dropping null/undefined', () => {
    const out = encodeParams({
      a: 'x',
      n: 5,
      b: true,
      o: { k: 1 },
      arr: [1, 2],
      skip: undefined,
      skip2: null,
    });
    expect(out).toEqual({
      a: 'x',
      n: '5',
      b: 'true',
      o: '{"k":1}',
      arr: '[1,2]',
    });
    expect('skip' in out).toBe(false);
    expect('skip2' in out).toBe(false);
  });

  it('never includes an access_token (caller adds it only on live POST)', () => {
    const out = encodeParams({ name: 'c' });
    expect('access_token' in out).toBe(false);
  });
});

describe('parseGraphError', () => {
  it('parses a full { error } envelope', () => {
    const e = parseGraphError({
      error: {
        message: 'Invalid parameter',
        type: 'OAuthException',
        code: 100,
        error_subcode: 1487390,
        error_user_title: 'Bad budget',
        error_user_msg: 'Daily budget too low',
        fbtrace_id: 'abc',
      },
    });
    expect(e.message).toBe('Invalid parameter');
    expect(e.code).toBe(100);
    expect(e.error_subcode).toBe(1487390);
    expect(e.error_user_msg).toBe('Daily budget too low');
    expect(e.fbtrace_id).toBe('abc');
  });

  it('handles a bare error object and a non-object body', () => {
    expect(parseGraphError({ message: 'x', code: 7 }).code).toBe(7);
    expect(parseGraphError('boom').message).toBe('Unknown Graph API error');
    expect(parseGraphError(null).code).toBe(-1);
  });
});

describe('live mode HTTP path (mocked fetch)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT call fetch in dry-run mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1' });
    await c.createCampaign({ name: 'c', objective: 'OUTCOME_LEADS' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to the versioned graph URL with access_token and returns the real id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: '120000000000001' }), { status: 200 }),
    );
    const c = new MetaAdsClient({
      accessToken: 'SECRET',
      adAccountId: '42',
      dryRun: false,
    });
    const res = await c.createCampaign({ name: 'Live', objective: 'OUTCOME_SALES' });

    expect(res).toEqual({ id: '120000000000001', dryRun: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/act_42/campaigns`);
    expect(init?.method).toBe('POST');
    const body = String(init?.body);
    expect(body).toContain('access_token=SECRET');
    expect(body).toContain('objective=OUTCOME_SALES');
    // recorded call log must NOT contain the token
    expect(JSON.stringify(c.calls[0].params)).not.toContain('SECRET');
  });

  it('throws MetaAdsApiError carrying the parsed envelope on a Graph error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'Unsupported post request', code: 100, fbtrace_id: 'zz' },
        }),
        { status: 400 },
      ),
    );
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1', dryRun: false });

    await expect(c.createCampaign({ name: 'x', objective: 'OUTCOME_TRAFFIC' })).rejects.toMatchObject(
      {
        name: 'MetaAdsApiError',
        httpStatus: 400,
        graphError: { code: 100, fbtrace_id: 'zz' },
      },
    );
  });

  it('prefers error_user_msg for the thrown message when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'generic', error_user_msg: 'Friendly message', code: 100 },
        }),
        { status: 400 },
      ),
    );
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1', dryRun: false });
    await expect(
      c.createCampaign({ name: 'x', objective: 'OUTCOME_TRAFFIC' }),
    ).rejects.toThrow('Friendly message');
  });

  it('wraps network failures as MetaAdsApiError with status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const c = new MetaAdsClient({ accessToken: 't', adAccountId: '1', dryRun: false });
    const err = await c
      .createCampaign({ name: 'x', objective: 'OUTCOME_TRAFFIC' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(MetaAdsApiError);
    expect(err.httpStatus).toBe(0);
  });
});
