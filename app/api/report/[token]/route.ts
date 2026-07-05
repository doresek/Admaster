// GET /api/report/[token]
// Public resolver — fetch a minted report share's snapshot by token. The token
// IS the authorization. Rate-limited + regex pre-checked to blunt enumeration.
// Reads via the SERVICE ROLE (createAdminClient); there is no anon RLS policy.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { REPORT_TOKEN_REGEX, resolveReportShare } from './resolve';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Cheap rejection of malformed tokens — no DB hit for bot/scan traffic.
  if (!REPORT_TOKEN_REGEX.test((await params).token)) {
    return NextResponse.json({ valid: false, error: 'Invalid token' }, { status: 400 });
  }

  // Rate-limit by IP: 30 lookups / minute. The token is unguessable, but this
  // caps brute-force scanning of the resolver regardless.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rl = checkRateLimit(`report-token:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const admin = createAdminClient();
  const resolved = await resolveReportShare(admin, (await params).token);

  if (!resolved.valid) {
    // 410 Gone for an expired link, 404 for an unknown one.
    return NextResponse.json(resolved, { status: resolved.expired ? 410 : 404 });
  }

  return NextResponse.json(resolved);
}
