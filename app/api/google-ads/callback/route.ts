import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const STATE_COOKIE = 'g_ads_oauth_state';

function backToSettings(url: string, qs: Record<string, string>) {
  const dest = new URL('/google-ads', url);
  for (const [k, v] of Object.entries(qs)) dest.searchParams.set(k, v);
  const res = NextResponse.redirect(dest);
  // Always clear the nonce — single use.
  res.cookies.delete(STATE_COOKIE);
  return res;
}

// GET /api/google-ads/callback?code=...&state=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code        = searchParams.get('code');
  const state       = searchParams.get('state');
  const oauthError  = searchParams.get('error');
  const cookieState = req.cookies.get(STATE_COOKIE)?.value;

  if (oauthError) return backToSettings(req.url, { error: oauthError });
  if (!code || !state || !cookieState || state !== cookieState) {
    return backToSettings(req.url, { error: 'invalid_state' });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return backToSettings(req.url, { error: 'unauthorized' });

  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return backToSettings(req.url, { error: 'env_missing' });
  }

  try {
    // 1) Exchange code for tokens.
    const tokenRes = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.refresh_token) {
      // No refresh_token usually means the user previously granted consent and
      // we didn't force prompt=consent. The init route does force it, so this
      // should be rare — surface it explicitly.
      return backToSettings(req.url, { error: tokenData.error ?? 'no_refresh_token' });
    }

    // 2) Fetch identity for display purposes.
    const userinfoRes = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userinfo = await userinfoRes.json();
    if (!userinfoRes.ok || !userinfo.id) {
      return backToSettings(req.url, { error: 'userinfo_failed' });
    }

    // 3) Upsert connection — same (user, Google account) replaces refresh_token.
    //    Matches the unique index google_ads_connections_user_google_uniq.
    const { error: upsertErr } = await supabase
      .from('google_ads_connections')
      .upsert({
        user_id:           user.id,
        refresh_token:     tokenData.refresh_token,
        google_user_id:    userinfo.id,
        google_user_email: userinfo.email ?? null,
        status:            'connected',
        updated_at:        new Date().toISOString(),
      }, { onConflict: 'user_id,google_user_id' });

    if (upsertErr) return backToSettings(req.url, { error: 'db_upsert_failed' });

    return backToSettings(req.url, { status: 'connected' });
  } catch {
    return backToSettings(req.url, { error: 'unexpected' });
  }
}
