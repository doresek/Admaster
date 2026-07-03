// GET /api/meta/connect/callback?code=...&state=...  (PUBLIC)
//
// Completes the session-less client-connect round-trip:
//   1. Verify the state JWT (CSRF). It carries connectToken + clientId, NOT a
//      session userId — the external client has none.
//   2. Re-validate connect_token (service role): still unconsumed + unexpired.
//   3. code → short-lived → long-lived token (using the CONNECT redirect URI).
//   4. Fetch identity (Pages + ad accounts) — same helper as the dashboard.
//   5. INSERT a meta_connections row via the SERVICE ROLE. agency_user_id is
//      resolved server-side from meta_clients.user_id — never a session.
//   6. Mark the link consumed (single-use), then redirect to the public done page.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';
import {
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMetaIdentity,
} from '@/lib/meta-oauth';
import { metaRedirectUri } from '@/lib/meta-config';
import { lookupConnectClient, connectLinkState } from '@/lib/meta-connect';

// Bounce to the public done page with a status the page can render.
function done(req: NextRequest, token: string, params: Record<string, string>) {
  const url = new URL(`/connect/${token}/done`, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get('code');
  const stateRaw = sp.get('state');
  const oauthError = sp.get('error');

  // We don't know the token until state is decoded; recover it for redirects.
  let token = '';

  try {
    // 1. CSRF: verify signature + expiry. Must carry a connectToken.
    const state = stateRaw ? verifyState(stateRaw) : null;
    if (!state || !state.connectToken) {
      return done(req, token, { meta: 'error', reason: 'bad_state' });
    }
    token = state.connectToken;

    if (oauthError) {
      return done(req, token, { meta: 'cancelled' });
    }
    if (!code) {
      return done(req, token, { meta: 'error', reason: 'missing_code' });
    }

    // 2. Re-validate the single-use token against the live row. Resolve the
    //    client + agency_user_id FROM THE TOKEN — never a session.
    const admin = createAdminClient();
    const client = await lookupConnectClient(admin, token);
    if (connectLinkState(client) !== 'valid' || !client) {
      return done(req, token, { meta: 'error', reason: 'link_invalid' });
    }
    // The token's clientId and the looked-up row must agree.
    if (client.id !== state.clientId) {
      return done(req, token, { meta: 'error', reason: 'client_mismatch' });
    }

    // 3. Token exchange — using the CONNECT redirect URI (must match authorize).
    const short = await exchangeCodeForToken(code, metaRedirectUri('connect'));
    const long = await exchangeForLongLivedToken(short.access_token);

    // 4. Identity (Pages + ad accounts), same shape as the dashboard flow.
    const identity = await fetchMetaIdentity(long.access_token);

    // 5. INSERT a meta_connections row via the service role (RLS bypass).
    //    agency_user_id = the owning agency user, resolved server-side.
    const token_encrypted = encrypt(long.access_token);
    const pages = identity.pages;
    const adAccounts = identity.adAccounts;

    const { error: insErr } = await admin
      .from('meta_connections')
      .insert({
        client_id: client.id,
        agency_user_id: client.user_id,
        token_encrypted,
        meta_user_id: identity.metaUserId,
        meta_user_name: identity.metaUserName,
        pages,
        ad_accounts: adAccounts,
        selected_page_id: pages[0]?.id ?? null,
        selected_ad_account_id: adAccounts[0]?.id ?? null,
        status: 'connected',
        // Expiry for pipe-health (C-06). expires_in absent/0 ⇒ long-lived/never-expiring.
        token_expires_at: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
      });

    if (insErr) {
      return done(req, token, { meta: 'error', reason: 'store_failed' });
    }

    // 6. Single-use: mark the link consumed so it can't be replayed.
    await admin
      .from('meta_clients')
      .update({ connect_consumed_at: new Date().toISOString() })
      .eq('id', client.id);

    return done(req, token, { meta: 'connected' });
  } catch {
    return done(req, token, { meta: 'error', reason: 'exchange_failed' });
  }
}
