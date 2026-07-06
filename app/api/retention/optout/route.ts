// app/api/retention/optout/route.ts
//
// PUBLIC one-click opt-out (no auth) — the compliance anchor (CP-6b T6).
//
// POST { token, channel? } → SECURITY-DEFINER RPC retention_opt_out(p_token,
// p_channel) from migration 052: sets the opted_out_at TOMBSTONE (first-write-
// wins, idempotent) and flips the contact's active series_enrollments to
// 'opted_out'. The RPC is granted to anon — same token-RPC pattern as
// /api/approvals/public (get_approval_by_token).
//
// Public ⇒ rate-limited per IP (burst guard; the RPC itself is idempotent and
// leaks nothing beyond found/not-found).

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CHANNELS = new Set(['email', 'sms', 'whatsapp']);

/** Pure ANON client — no cookies: opt-out must work with zero session. */
function createAnonClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rl = checkRateLimit(`retention-optout:${ip}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || token.length > 200) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }
  const channel = typeof body.channel === 'string' && CHANNELS.has(body.channel)
    ? body.channel
    : null;

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc('retention_opt_out', {
    p_token: token,
    p_channel: channel,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = data as { success?: boolean; error?: string } | null;
  if (!result?.success) {
    return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
