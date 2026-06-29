// tests/master-studio/retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withRetry, isTransientError, classifyError } from '@/lib/master-studio/retry';

const noSleep = () => Promise.resolve();

describe('isTransientError', () => {
  it('treats 429 / 5xx / 408 as transient', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 408 })).toBe(true);
  });
  it('treats network / overloaded messages as transient', () => {
    expect(isTransientError({ message: 'fetch failed' })).toBe(true);
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ message: 'Overloaded' })).toBe(true);
  });
  it('does NOT treat 4xx (non-429) or parse errors as transient', () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ message: 'invalid json' })).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError('boom')).toBe(false);
  });
});

describe('classifyError', () => {
  it('flags timeouts', () => {
    expect(classifyError({ message: 'Request timed out' })).toBe('timeout');
    expect(classifyError({ code: 'ETIMEDOUT' })).toBe('timeout');
  });
  it('flags provider errors', () => {
    expect(classifyError({ status: 529, message: 'Overloaded' })).toBe('provider');
    expect(classifyError({ status: 429 })).toBe('provider');
  });
  it('flags parse errors', () => {
    expect(classifyError({ message: 'Unexpected token in JSON' })).toBe('parse');
  });
});

describe('withRetry', () => {
  it('retries ONCE on a transient error, then succeeds', async () => {
    let calls = 0;
    const runner = vi.fn(async () => {
      calls++;
      if (calls === 1) throw { status: 503, message: 'overloaded' };
      return 'ok';
    });
    const wrapped = withRetry(runner, { sleep: noSleep });
    await expect(wrapped('s', 'u', 100)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('does NOT retry a non-transient error', async () => {
    let calls = 0;
    const runner = async () => {
      calls++;
      throw { status: 400, message: 'bad request' };
    };
    const wrapped = withRetry(runner, { sleep: noSleep });
    await expect(wrapped('s', 'u', 100)).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });

  it('gives up after exhausting retries on persistent transient errors', async () => {
    let calls = 0;
    const runner = async () => {
      calls++;
      throw { status: 500, message: 'server error' };
    };
    const wrapped = withRetry(runner, { sleep: noSleep, retries: 1 });
    await expect(wrapped('s', 'u', 100)).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(2); // initial + 1 retry
  });

  it('passes args through and returns first-try result without retrying', async () => {
    const runner = vi.fn(async (s: string, u: string, t: number) => `${s}|${u}|${t}`);
    const wrapped = withRetry(runner, { sleep: noSleep });
    await expect(wrapped('sys', 'usr', 42)).resolves.toBe('sys|usr|42');
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
