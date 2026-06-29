// GET /api/meta/connect/[token]/authorize  (PUBLIC)
//
// Starts the session-less Meta OAuth for an external client: re-validates the
// connect token (service role), resolves the client_id FROM THE TOKEN (never a
// session), signs a CSRF state carrying the connectToken (NOT a userId), and
// 302-redirects to the Facebook Login dialog. Meta returns to
// /api/meta/connect/callback with ?code&state.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { signState } from '@/lib/meta-oauth';
import { randomBytes } from 'crypto';
import { CONNECT_TOKEN_REGEX, lookupConnectClient, connectLinkState } from '@/lib/meta-connect';
import {
  META_OAUTH_DIALOG,
  META_OAUTH_SCOPES,
  META_LOGIN_CONFIG_ID,
  META_APP_ID,
  metaRedirectUri,
  assertMetaAppConfigured,
} from '@/lib/meta-config';

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token;

  // The token is the sole access control: regex-precheck + rate-limit before
  // any DB hit, then re-validate against the live row (single-use + expiry).
  if (!CONNECT_TOKEN_REGEX.test(token)) {
    return NextResponse.redirect(new URL(`/connect/${token}`, req.nextUrl.origin));
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const rl = checkRateLimit(`connect-authorize:${ip}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  try {
    assertMetaAppConfigured();

    const admin = createAdminClient();
    const client = await lookupConnectClient(admin, token);
    if (connectLinkState(client) !== 'valid' || !client) {
      // Bounce back to the public page, which shows the proper invalid/expired view.
      return NextResponse.redirect(new URL(`/connect/${token}`, req.nextUrl.origin));
    }

    // returnTo is the public done page; bound to an internal path.
    const returnTo = `/connect/${token}/done`;

    // CSRF state — OMIT userId (the external client has no session). The
    // connectToken is the binding the callback re-validates.
    const state = signState({
      clientId: client.id,
      connectToken: token,
      returnTo,
      nonce: randomBytes(16).toString('hex'),
    });

    const qp = new URLSearchParams({
      client_id: META_APP_ID,
      redirect_uri: metaRedirectUri('connect'),
      response_type: 'code',
      state,
    });
    if (META_LOGIN_CONFIG_ID) {
      qp.set('config_id', META_LOGIN_CONFIG_ID);
    } else {
      qp.set('scope', META_OAUTH_SCOPES.join(','));
    }

    return NextResponse.redirect(`${META_OAUTH_DIALOG}?${qp.toString()}`);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
