import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_CLIENT_COOKIE, readActiveClientCookie } from '@/lib/active-client';

// GET — list all clients + currently-active id
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: clients } = await supabase
    .from('meta_clients')
    .select('id, name, industry, emoji')
    .eq('user_id', user.id)
    .order('name');

  const active = readActiveClientCookie(req.headers.get('cookie') ?? '');
  // Verify the active client still belongs to this user
  const validActive = active && clients?.some(c => c.id === active) ? active : null;

  return NextResponse.json({ clients: clients ?? [], active: validActive });
}

// POST — set active client (body: { id: string | null })
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json() as { id: string | null };

  // Verify ownership
  if (id) {
    const { data } = await supabase
      .from('meta_clients')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, active: id });
  if (id) {
    res.cookies.set(ACTIVE_CLIENT_COOKIE, id, {
      path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    res.cookies.set(ACTIVE_CLIENT_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return res;
}
