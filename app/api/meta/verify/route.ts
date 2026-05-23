import { NextRequest, NextResponse } from 'next/server';

const GRAPH = 'https://graph.facebook.com/v19.0';

// GET /api/meta/verify?token=EAAxx...
// Used when adding a new Meta client — verifies token and fetches pages/adaccounts
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  try {
    // Verify token + get user info
    const meRes = await fetch(`${GRAPH}/me?access_token=${token}&fields=name,id`);
    const me = await meRes.json();
    if (me.error) throw new Error(me.error.message);

    // Get pages
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${token}&fields=id,name,fan_count,category,access_token`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data ?? [];

    // Get ad accounts (optional — might not have ads permissions)
    let adAccounts: any[] = [];
    try {
      const adsRes = await fetch(`${GRAPH}/me/adaccounts?access_token=${token}&fields=id,name,currency,amount_spent,account_status`);
      const adsData = await adsRes.json();
      adAccounts = adsData.data ?? [];
    } catch (_) {}

    return NextResponse.json({ id: me.id, name: me.name, pages, adAccounts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
