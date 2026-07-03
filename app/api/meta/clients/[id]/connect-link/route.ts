// POST /api/meta/clients/[id]/connect-link  (AUTHENTICATED agency)
//
// Mints a single-use, 72h-expiring client-connect magic-link for a meta_clients
// row the caller owns. The returned link lets an external client authorize THEIR
// OWN Meta account without logging into AdMaster (see app/connect/[token]).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mintConnectLink, ConnectLinkError } from '@/lib/meta-connect';
import { connectLink } from '@/lib/share';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // mintConnectLink verifies ownership (404 if the client isn't the caller's)
    // and persists connect_token/expires/consumed on the owner meta_clients row,
    // retrying on a unique-index collision.
    const minted = await mintConnectLink(supabase, user.id, (await params).id);

    return NextResponse.json({
      link: connectLink(minted.token),
      expiresAt: minted.expires_at,
    });
  } catch (err: any) {
    if (err instanceof ConnectLinkError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err.message ?? 'Failed to mint connect link' }, { status: 500 });
  }
}
