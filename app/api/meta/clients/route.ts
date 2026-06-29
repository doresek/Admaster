import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';
import { META_GRAPH_BASE } from '@/lib/meta-config';

const GRAPH = META_GRAPH_BASE;

// POST /api/meta/clients
// Body: { name, industry, emoji, token? }
// Brief-first: only `name` is required. When a Meta token is supplied we verify
// it with Meta, encrypt it, and store the connected assets (legacy paste path).
// When no token is supplied we insert an identity-only client (status 'new')
// that can be connected to Meta later via OAuth or a token paste.
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, phone, email, company, industry, emoji, token } = await req.json() as {
      name: string; phone?: string; email?: string; company?: string; industry?: string; emoji?: string; token?: string;
    };
    if (!name) {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 });
    }

    // Defaults for the identity-only (no-token) path.
    let token_encrypted: string | null = null;
    let meta_user_id: string | null = null;
    let meta_user_name: string | null = null;
    let pages: any[] = [];
    let adAccounts: any[] = [];
    let status: 'new' | 'connected' = 'new';

    // Guard the Meta path on a real (non-empty, non-whitespace) token. An empty
    // string / whitespace / absent token must NEVER hit the Graph API or encrypt
    // — this is the structural fix for the name-only-create OAuth bug.
    if (token && token.trim()) {
      // Verify token + fetch Meta metadata (server-side; token never leaves server)
      const meRes = await fetch(`${GRAPH}/me?access_token=${encodeURIComponent(token)}&fields=name,id`);
      const me = await meRes.json();
      if (me.error) return NextResponse.json({ error: me.error.message }, { status: 400 });

      const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(token)}&fields=id,name,fan_count,category,access_token`);
      const pagesData = await pagesRes.json();
      pages = pagesData.data ?? [];

      try {
        const adsRes = await fetch(`${GRAPH}/me/adaccounts?access_token=${encodeURIComponent(token)}&fields=id,name,currency,amount_spent,account_status`);
        const adsData = await adsRes.json();
        adAccounts = adsData.data ?? [];
      } catch (_) {}

      token_encrypted = encrypt(token);
      meta_user_id    = me.id;
      meta_user_name  = me.name;
      status          = 'connected';
    }

    const { data, error } = await supabase.from('meta_clients').insert({
      user_id:                user.id,
      name,
      phone:                  phone ?? null,
      email:                  email ?? null,
      company:                company ?? null,
      industry:               industry ?? null,
      emoji:                  emoji ?? '🏢',
      token_encrypted,
      meta_user_id,
      meta_user_name,
      pages,
      ad_accounts:            adAccounts,
      selected_page_id:       pages[0]?.id ?? null,
      selected_ad_account_id: adAccounts[0]?.id ?? null,
      status,
    }).select('id, user_id, name, phone, email, company, industry, emoji, meta_user_id, meta_user_name, pages, ad_accounts, selected_page_id, selected_ad_account_id, status, posts_published, campaigns_created, connected_at, updated_at').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
