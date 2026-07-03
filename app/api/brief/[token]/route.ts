// GET /api/brief/[token]
// Public resolver — fetch a brief link's branding/validity by token. The token
// IS the authorization. Rate-limited + regex pre-checked to blunt enumeration.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

// Must match generateBriefToken() (randomBytes(32) -> 64 lowercase hex chars).
const TOKEN_REGEX = /^[a-f0-9]{64}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Cheap rejection of malformed tokens — no DB hit for bot/scan traffic.
  if (!TOKEN_REGEX.test((await params).token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  // Rate-limit by IP: 30 lookups / minute. The token is unguessable, but this
  // caps brute-force scanning of the resolver regardless.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rl = checkRateLimit(`brief-token:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('brief_codes')
    .select('agency_name, created_at')
    .eq('token', (await params).token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // [expiry hook] When brief_codes.expires_at exists, select it above and return
  // 410 here. v1 links are reusable and never expire.

  return NextResponse.json({ agency_name: data.agency_name, valid: true });
}
