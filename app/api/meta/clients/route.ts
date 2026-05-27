import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';

const GRAPH = 'https://graph.facebook.com/v19.0';

// POST /api/meta/clients
// Body: { name, industry, emoji, token }
// Verifies token with Meta, encrypts it, and inserts a new meta_clients row.
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, industry, emoji, token } = await req.json() as {
      name: string; industry?: string; emoji?: string; token: string;
    };
    if (!name || !token) {
      return NextResponse.json({ error: 'Missing name or token' }, { status: 400 });
    }

    // Verify token + fetch Meta metadata (server-side; token never leaves server)
    const meRes = await fetch(`${GRAPH}/me?access_token=${encodeURIComponent(token)}&fields=name,id`);
    const me = await meRes.json();
    if (me.error) return NextResponse.json({ error: me.error.message }, { status: 400 });

    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(token)}&fields=id,name,fan_count,category,access_token`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data ?? [];

    let adAccounts: any[] = [];
    try {
      const adsRes = await fetch(`${GRAPH}/me/adaccounts?access_token=${encodeURIComponent(token)}&fields=id,name,currency,amount_spent,account_status`);
      const adsData = await adsRes.json();
      adAccounts = adsData.data ?? [];
    } catch (_) {}

    const token_encrypted = encrypt(token);

    const { data, error } = await supabase.from('meta_clients').insert({
      user_id:                user.id,
      name,
      industry:               industry ?? null,
      emoji:                  emoji ?? '🏢',
      token_encrypted,
      meta_user_id:           me.id,
      meta_user_name:         me.name,
      pages,
      ad_accounts:            adAccounts,
      selected_page_id:       pages[0]?.id ?? null,
      selected_ad_account_id: adAccounts[0]?.id ?? null,
      status:                 'connected',
    }).select('id, user_id, name, industry, emoji, meta_user_id, meta_user_name, pages, ad_accounts, selected_page_id, selected_ad_account_id, status, posts_published, campaigns_created, connected_at, updated_at').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
