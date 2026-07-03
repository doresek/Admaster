import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { signState } from '@/lib/meta-oauth';
import { randomBytes } from 'crypto';
import {
  META_OAUTH_DIALOG,
  META_OAUTH_SCOPES,
  META_LOGIN_CONFIG_ID,
  META_APP_ID,
  metaRedirectUri,
  assertMetaAppConfigured,
} from '@/lib/meta-config';

// GET /api/meta/oauth/authorize?clientId=<meta_clients.id>&returnTo=<path>
//
// Starts the per-client Meta OAuth connect: validates the caller owns the
// client, signs a state JWT (CSRF), and 302-redirects to the Facebook Login
// dialog. The dialog returns to /api/meta/oauth/callback with ?code&state.
export async function GET(req: NextRequest) {
  try {
    assertMetaAppConfigured();

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId || !/^[0-9a-fA-F-]{36}$/.test(clientId)) {
      return NextResponse.json({ error: 'Missing or invalid clientId' }, { status: 400 });
    }

    // The client must exist and belong to this user before we hand off to Meta.
    const { data: client } = await supabase
      .from('meta_clients')
      .select('id')
      .eq('id', clientId)
      .eq('user_id', user.id)
      .single();
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    // returnTo is an internal path only — never an absolute URL (open-redirect guard).
    const rawReturn = req.nextUrl.searchParams.get('returnTo') || '/clients';
    const returnTo = rawReturn.startsWith('/') && !rawReturn.startsWith('//') ? rawReturn : '/clients';

    const state = signState({
      userId: user.id,
      clientId,
      returnTo,
      nonce: randomBytes(16).toString('hex'),
    });

    const params = new URLSearchParams({
      client_id: META_APP_ID,
      redirect_uri: metaRedirectUri(),
      response_type: 'code',
      state,
    });

    // Two login modes:
    //  • Business Login (config_id set) — the production path; the granted
    //    permissions come from the app's Login-for-Business configuration.
    //  • Classic scope login (no config_id) — works with a Tester account in
    //    dev, so the round-trip is fully exercisable without the live business
    //    config. We request our scope list explicitly.
    if (META_LOGIN_CONFIG_ID) {
      params.set('config_id', META_LOGIN_CONFIG_ID);
    } else {
      params.set('scope', META_OAUTH_SCOPES.join(','));
    }

    return NextResponse.redirect(`${META_OAUTH_DIALOG}?${params.toString()}`);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
