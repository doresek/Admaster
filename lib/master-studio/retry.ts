// lib/master-studio/retry.ts
import { type StageRunner } from './pipeline';

/**
 * True for transient provider errors worth one more attempt:
 * HTTP 408/429/5xx (Anthropic rate-limit / overloaded / server error) or
 * low-level network failures (reset/timeout/DNS).
 */
export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; name?: string; message?: string; code?: string };
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  const text = `${e.name ?? ''} ${e.code ?? ''} ${e.message ?? ''}`.toLowerCase();
  return /econnreset|etimedout|enotfound|eai_again|fetch failed|network|socket hang up|overloaded|rate.?limit|timeout|timed out/.test(text);
}

/**
 * Coarse classification of a pipeline failure for the `detail` field of an
 * error response. Helps distinguish a likely Vercel function timeout from a
 * provider/parse error during triage.
 */
export function classifyError(err: unknown): 'timeout' | 'provider' | 'parse' | 'unknown' {
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as { status?: number; name?: string; message?: string; code?: string };
  const status = typeof e.status === 'number' ? e.status : undefined;
  const text = `${e.name ?? ''} ${e.code ?? ''} ${e.message ?? ''}`.toLowerCase();
  if (/timeout|timed out|etimedout|esockettimedout|deadline/.test(text)) return 'timeout';
  if (status === 408 || status === 429 || (status !== undefined && status >= 500) ||
      /econnreset|enotfound|eai_again|fetch failed|network|socket hang up|overloaded|rate.?limit/.test(text)) {
    return 'provider';
  }
  if (/json|parse|unexpected token|tags|invalid/.test(text)) return 'parse';
  return 'unknown';
}

/**
 * Wraps a StageRunner so each stage call retries on a transient error, after a
 * short (linear) backoff. Defaults to ONE retry. `sleep` is injectable for tests.
 */
export function withRetry(
  runner: StageRunner,
  opts: { retries?: number; backoffMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): StageRunner {
  const retries = opts.retries ?? 1;
  const backoffMs = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (system, user, maxTokens) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await runner(system, user, maxTokens);
      } catch (err) {
        lastErr = err;
        if (attempt < retries && isTransientError(err)) {
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };
}
