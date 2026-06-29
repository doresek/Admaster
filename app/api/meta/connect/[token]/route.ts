// GET /api/meta/connect/[token]  (PUBLIC resolver)
//
// Resolves a client-connect link's branding + validity by token. The 64-hex
// token IS the authorization (no session). Regex pre-checked + rate-limited to
// blunt enumeration, then a service-role lookup (RLS bypass, like the brief
// resolver). Single-use + 72h expiry.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { CONNECT_TOKEN_REGEX, lookupConnectClient, connectLinkState } from '@/lib/meta-connect';

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  // Cheap rejection of malformed tokens — no DB hit for bot/scan traffic.
  if (!CONNECT_TOKEN_REGEX.test(params.token)) {
    return NextResponse.json({ valid: false, reason: 'invalid' }, { status: 400 });
  }

  // Rate-limit by IP: 30 lookups / minute (matches the brief resolver).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rl = checkRateLimit(`connect-token:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const admin = createAdminClient();
  const client = await lookupConnectClient(admin, params.token);
  const state = connectLinkState(client);

  if (state !== 'valid' || !client) {
    // Clean, uniform payload for invalid / expired / consumed — never leak which.
    return NextResponse.json({ valid: false, reason: state });
  }

  // agency_name from the owner's users.name (faithful to the brief flow).
  const { data: agency } = await admin
    .from('users')
    .select('name')
    .eq('id', client.user_id)
    .maybeSingle();

  return NextResponse.json({
    valid: true,
    agencyName: agency?.name ?? null,
    clientName: client.name ?? null,
  });
}
