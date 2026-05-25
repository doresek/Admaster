import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAccessToken, listAccessibleCustomers, GoogleAdsError } from '@/lib/google-ads/client';
import type { GoogleAdsCustomerRef } from '@/types';

// GET /api/google-ads/accounts?connectionId=...
// Refreshes the customer_ids cache for a connection and returns the list.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connectionId = req.nextUrl.searchParams.get('connectionId');
  if (!connectionId) {
    return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 });
  }

  // RLS scopes this to the current user, but we filter on user_id too for clarity.
  const { data: conn, error: selErr } = await supabase
    .from('google_ads_connections')
    .select('id, refresh_token')
    .eq('id', connectionId)
    .eq('user_id', user.id)
    .single();
  if (selErr || !conn) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  try {
    const accessToken = await getAccessToken(conn.refresh_token);
    const ids         = await listAccessibleCustomers(accessToken);
    const customers: GoogleAdsCustomerRef[] = ids.map((id) => ({ id }));

    await supabase
      .from('google_ads_connections')
      .update({
        customer_ids:   customers,
        status:         'connected',
        last_synced_at: new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      })
      .eq('id', conn.id);

    return NextResponse.json({ customers });
  } catch (err) {
    const e = err as GoogleAdsError;
    // invalid_grant from Google = the refresh_token is dead. Mark the row so
    // the UI can prompt a re-connect instead of looking healthy.
    if (e instanceof GoogleAdsError && e.message === 'invalid_grant') {
      await supabase
        .from('google_ads_connections')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', conn.id);
    }
    return NextResponse.json(
      { error: e?.message ?? 'unexpected' },
      { status: e?.status ?? 500 },
    );
  }
}

// DELETE /api/google-ads/accounts?connectionId=...
// Disconnects (removes the row). RLS scopes to the current user.
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const connectionId = req.nextUrl.searchParams.get('connectionId');
  if (!connectionId) {
    return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 });
  }

  const { error: delErr } = await supabase
    .from('google_ads_connections')
    .delete()
    .eq('id', connectionId)
    .eq('user_id', user.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
