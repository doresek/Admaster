import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// POST /api/clients/[id]/brief-link  (auth required)
// Create-or-rotate a public 7-day briefing token for the authenticated
// user's client [id]. Returns { url, token, expires_at }.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = params.id;

    // Verify the client belongs to the authenticated user.
    const { data: client } = await supabase
      .from('meta_clients')
      .select('id, name')
      .eq('id', clientId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    // Optional agency name for branding on the public page.
    const { data: profile } = await supabase
      .from('users')
      .select('name')
      .eq('id', user.id)
      .maybeSingle();

    const token      = randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 7 * 864e5).toISOString();

    // Trusted write (gated by the auth + ownership check above) → admin client
    // to avoid RLS friction.
    const admin = createAdminClient();

    // Create-or-rotate: one brief_codes row per client_id.
    const { data: existing } = await admin
      .from('brief_codes')
      .select('code')
      .eq('client_id', clientId)
      .maybeSingle();

    let code: string;
    if (existing) {
      code = existing.code;
      const { error } = await admin
        .from('brief_codes')
        .update({ token, expires_at })
        .eq('client_id', clientId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      code = randomBytes(4).toString('hex').toUpperCase();
      const { error } = await admin
        .from('brief_codes')
        .insert({
          code,
          token,
          expires_at,
          client_id:   clientId,
          user_id:     user.id,
          agency_name: profile?.name ?? null,
        });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ url: `/brief/${token}`, token, expires_at });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
