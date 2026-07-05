import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_CLIENT_COOKIE, readActiveClientCookie } from '@/lib/active-client';

// GET — list all clients + currently-active id
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Identity-only list from the v2 `clients` table. `clients` has no emoji /
  // industry columns, so surface stable placeholders (emoji '🏢') for the few
  // UI surfaces that still read them; they no longer drive any Meta behavior.
  const { data: rows } = await supabase
    .from('clients')
    .select('id, name')
    .eq('owner_user_id', user.id)
    .order('name');
  const clients = (rows ?? []).map(c => ({ id: c.id, name: c.name, industry: null, emoji: '🏢' }));

  const active = readActiveClientCookie(req.headers.get('cookie') ?? '');
  // Verify the active client still belongs to this user
  const validActive = active && clients?.some(c => c.id === active) ? active : null;

  // For the active client, resolve the most-recent brief (same logic as
  // buildAiContext) so /create can tell whether generation will actually be
  // grounded in a real client brief + avatar, and pass brief_id explicitly.
  let brief_id: string | null = null;
  let has_brief = false;
  if (validActive) {
    const { data: brief } = await supabase
      .from('briefs')
      .select('id, values')
      .eq('user_id', user.id)
      .eq('client_id', validActive)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (brief) {
      brief_id = brief.id;
      const values = (brief.values ?? {}) as Record<string, unknown>;
      // Matches buildAiContext: a brief only injects context if it has
      // at least one non-empty string field.
      has_brief = Object.values(values).some(v => typeof v === 'string' && v.trim().length > 0);
    }
  }

  return NextResponse.json({ clients: clients ?? [], active: validActive, brief_id, has_brief });
}

// POST — set active client (body: { id: string | null })
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json() as { id: string | null };

  // Verify ownership
  if (id) {
    const { data } = await supabase
      .from('clients')
      .select('id')
      .eq('id', id)
      .eq('owner_user_id', user.id)
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
