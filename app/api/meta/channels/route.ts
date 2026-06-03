import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/meta/channels?clientId=... — the client's pages + ad accounts (id+name)
// plus the current saved selection, for the launcher's page/account pickers.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

  const { data: client } = await supabase
    .from('meta_clients')
    .select('pages, ad_accounts, selected_page_id, selected_ad_account_id')
    .eq('id', clientId).eq('user_id', user.id).maybeSingle();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  return NextResponse.json({
    pages:       (client.pages ?? []).map((p: any) => ({ id: p.id, name: p.name })),
    adAccounts:  (client.ad_accounts ?? []).map((a: any) => ({ id: a.id, name: a.name })),
    selectedPageId:      client.selected_page_id,
    selectedAdAccountId: client.selected_ad_account_id,
  });
}
