// Unit tests for checkRateLimitDurable (lib/rate-limit.ts) — the durable,
// Postgres-backed limiter (check_rate_limit RPC, migration 032).
//
// Contract under test:
//   • RPC true  → allowed  (ok: true)
//   • RPC false → blocked  (ok: false, retryAfter = window in seconds)
//   • RPC error → FAIL OPEN (ok: true)   ← availability over strictness
//   • RPC throws → FAIL OPEN (ok: true)
//
// The admin Supabase client is mocked so no real DB is touched.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  rpc: null as null | ((fn: string, args: any) => Promise<any>),
}));

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    rpc: (fn: string, args: any) => H.rpc!(fn, args),
  }),
}));

import { checkRateLimitDurable } from '@/lib/rate-limit';

beforeEach(() => {
  H.rpc = null;
});

describe('checkRateLimitDurable', () => {
  it('allows when the RPC returns true', async () => {
    H.rpc = async () => ({ data: true, error: null });
    const r = await checkRateLimitDurable('k', { max: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true);
  });

  it('passes key/max/window-seconds through to the RPC', async () => {
    const calls: any[] = [];
    H.rpc = async (fn, args) => { calls.push({ fn, args }); return { data: true, error: null }; };
    await checkRateLimitDurable('mykey', { max: 7, windowMs: 90_000 });
    expect(calls[0].fn).toBe('check_rate_limit');
    expect(calls[0].args).toEqual({ p_key: 'mykey', p_max: 7, p_window_seconds: 90 });
  });

  it('blocks when the RPC returns false, with retryAfter = window seconds', async () => {
    H.rpc = async () => ({ data: false, error: null });
    const r = await checkRateLimitDurable('k', { max: 5, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(60);
  });

  it('FAILS OPEN when the RPC returns an error', async () => {
    H.rpc = async () => ({ data: null, error: { message: 'boom' } });
    const r = await checkRateLimitDurable('k', { max: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true);
  });

  it('FAILS OPEN when the client throws', async () => {
    H.rpc = async () => { throw new Error('network down'); };
    const r = await checkRateLimitDurable('k', { max: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true);
  });
});
