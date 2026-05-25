import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/adwords';
const STATE_COOKIE = 'g_ads_oauth_state';

// GET /api/google-ads/connect — kicks off Google OAuth.
// Sets a single-use nonce cookie that the callback verifies (CSRF).
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId    = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Google OAuth env vars missing' }, { status: 500 });
  }

  const nonce = randomBytes(24).toString('base64url');

  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          redirectUri,
    response_type:         'code',
    scope:                 SCOPE,
    // offline + consent guarantees a refresh_token on every connect, even if
    // the user has previously authorized this client.
    access_type:           'offline',
    prompt:                'consent',
    include_granted_scopes: 'true',
    state:                 nonce,
  });

  const res = NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   600, // 10 minutes
  });
  return res;
}
