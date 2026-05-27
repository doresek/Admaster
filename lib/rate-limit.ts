// In-memory rate limiter (token bucket).
// NOTE: This works per-process. For multi-instance deploys, swap the Map
// for Redis (Upstash) — keep the same API.

type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitConfig {
  /** Max requests allowed within `windowMs`. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the bucket refills enough for another request. */
  retryAfter: number;
}

/**
 * Check + consume one token. Bucket refills linearly across `windowMs`.
 * Returns `ok: false` with a `retryAfter` (seconds) when out of tokens.
 */
export function checkRateLimit(key: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const refillPerMs = cfg.max / cfg.windowMs;

  const b = buckets.get(key);
  if (!b) {
    buckets.set(key, { tokens: cfg.max - 1, updatedAt: now });
    return { ok: true, remaining: cfg.max - 1, retryAfter: 0 };
  }

  const elapsed = now - b.updatedAt;
  const refilled = Math.min(cfg.max, b.tokens + elapsed * refillPerMs);

  if (refilled < 1) {
    const needed = 1 - refilled;
    return { ok: false, remaining: 0, retryAfter: Math.ceil(needed / refillPerMs / 1000) };
  }

  b.tokens = refilled - 1;
  b.updatedAt = now;
  return { ok: true, remaining: Math.floor(b.tokens), retryAfter: 0 };
}

// Periodic cleanup so the Map doesn't grow forever.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes idle
    for (const [k, b] of buckets) if (b.updatedAt < cutoff) buckets.delete(k);
  }, 5 * 60 * 1000).unref?.();
}
