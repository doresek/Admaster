import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';
import {
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMetaIdentity,
} from '@/lib/meta-oauth';
import { META_LOGIN_CONFIG_ID } from '@/lib/meta-config';

// Redirect helper — bounce back into the app with a status the UI can show.
function back(req: NextRequest, returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

// GET /api/meta/oauth/callback?code=...&state=...
//
// Completes the OAuth round-trip:
//   1. Verify the state JWT (CSRF) and confirm the session user matches.
//   2. code → short-lived token → long-lived token.
//   3. Fetch identity (Pages + ad accounts).
//   4. ENCRYPT the long-lived token (exact lib/crypto AES-256-GCM format) and
//      INSERT a new meta_connections child row (one client can own many
//      connections — agency model). meta_clients stays pure identity.
//   5. Redirect back to returnTo with a status flag.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const stateRaw = sp.get('state');
  const oauthError = sp.get('error'); // user denied, etc.

  // We don't know returnTo until state is decoded; default to /clients.
  let returnTo = '/clients';

  try {
    if (oauthError) {
      // User cancelled or Meta rejected — recover returnTo if state is intact.
      const s = stateRaw ? verifyState(stateRaw) : null;
      if (s) returnTo = s.returnTo;
      return back(req, returnTo, { meta: 'cancelled' });
    }
    if (!code || !stateRaw) {
      return back(req, returnTo, { meta: 'error', reason: 'missing_code_or_state' });
    }

    // 1. CSRF: verify signature + expiry.
    const state = verifyState(stateRaw);
    if (!state) return back(req, returnTo, { meta: 'error', reason: 'bad_state' });
    returnTo = state.returnTo;

    // The browser carries the Supabase session cookie on this top-level GET;
    // confirm the logged-in user is the one who started the flow.
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== state.userId) {
      return back(req, returnTo, { meta: 'error', reason: 'session_mismatch' });
    }

    // 2. Token exchange: code → short-lived → long-lived.
    const short = await exchangeCodeForToken(code);
    const long = await exchangeForLongLivedToken(short.access_token);

    // ── System-User / business-integration path ──────────────────────────
    // With Facebook Login for Business (META_LOGIN_CONFIG_ID set), `long` is a
    // business System-User token tied to the app's business integration —
    // long-lived/non-expiring and the correct credential for managing the
    // client's ad account at scale. With classic dev login it's an ordinary
    // ~60-day user token. Both store identically below; only the upstream
    // Business Login configuration differs, and that requires the live Meta app
    // + an approved business integration to fully exercise.
    const isBusinessToken = Boolean(META_LOGIN_CONFIG_ID);

    // 3. Identity (Pages + ad accounts), same shape as the manual flow.
    const identity = await fetchMetaIdentity(long.access_token);

    // 4. Encrypt with the EXACT lib/crypto format and INSERT a meta_connections
    //    child row. meta_clients is pure identity now — no credential/asset
    //    columns are written there. RLS (meta_connections_own) restricts the
    //    row to agency_user_id = the authenticated user.
    const token_encrypted = encrypt(long.access_token);
    const pages = identity.pages;
    const adAccounts = identity.adAccounts;

    const { error: insErr } = await supabase
      .from('meta_connections')
      .insert({
        client_id: state.clientId,
        agency_user_id: user.id,
        token_encrypted,
        meta_user_id: identity.metaUserId,
        meta_user_name: identity.metaUserName,
        pages,
        ad_accounts: adAccounts,
        selected_page_id: pages[0]?.id ?? null,
        selected_ad_account_id: adAccounts[0]?.id ?? null,
        status: 'connected',
      });

    if (insErr) return back(req, returnTo, { meta: 'error', reason: 'store_failed' });

    return back(req, returnTo, {
      meta: 'connected',
      client: state.clientId,
      via: isBusinessToken ? 'business' : 'oauth',
    });
  } catch (err: any) {
    return back(req, returnTo, { meta: 'error', reason: 'exchange_failed' });
  }
}
