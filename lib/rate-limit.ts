// Rate limiting — two flavours:
//
//  • checkRateLimit (SYNC, in-memory token bucket) — best-effort, PER-PROCESS.
//    On serverless it resets on cold start and is not shared across instances,
//    so it is only a cheap first-line burst guard. Kept unchanged because ~10
//    call sites consume it synchronously (`const rl = checkRateLimit(...)`).
//
//  • checkRateLimitDurable (ASYNC, Postgres-backed via the check_rate_limit RPC
//    from migration 032) — DURABLE and cross-instance. Use this to gate anything
//    that costs money (LLM calls, credits). It FAILS OPEN on any RPC error so a
//    transient DB blip never takes down a real endpoint.
//
// Trusted IP source note: callers derive the identifier from x-forwarded-for,
// which is client-spoofable unless the platform strips/normalises it. IP
// extraction is intentionally left to each caller (out of scope here).

import { createAdminClient } from '@/lib/supabase/server';

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

/**
 * Durable, cross-instance rate limit backed by the SECURITY DEFINER
 * `check_rate_limit` RPC (migration 032). Fixed-window: allows up to `cfg.max`
 * requests per `cfg.windowMs`, atomically, shared across all serverless
 * instances via the `public.rate_limits` table.
 *
 * Returns the SAME `RateLimitResult` shape as the sync limiter so callers read
 * `rl.ok` identically. On ANY RPC error the call FAILS OPEN (`ok: true`) with a
 * `console.warn` — availability over strictness (the table exists post-032).
 *
 * `retryAfter` is a conservative upper bound (the full window) since the RPC
 * does not report the remaining window.
 */
export async function checkRateLimitDurable(
  key: string,
  cfg: RateLimitConfig,
): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.ceil(cfg.windowMs / 1000));
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key:            key,
      p_max:            cfg.max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn(`[rate-limit] durable check failed for "${key}", failing open:`, error.message);
      return { ok: true, remaining: cfg.max, retryAfter: 0 };
    }
    // RPC returns TRUE when allowed. Treat only an explicit `false` as blocked.
    if (data === false) {
      return { ok: false, remaining: 0, retryAfter: windowSeconds };
    }
    return { ok: true, remaining: 0, retryAfter: 0 };
  } catch (e: any) {
    console.warn(`[rate-limit] durable check threw for "${key}", failing open:`, e?.message);
    return { ok: true, remaining: cfg.max, retryAfter: 0 };
  }
}

// Periodic cleanup so the Map doesn't grow forever.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes idle
    for (const [k, b] of buckets) if (b.updatedAt < cutoff) buckets.delete(k);
  }, 5 * 60 * 1000).unref?.();
}
