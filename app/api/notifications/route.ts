import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/notifications — list (newest first) + unread count
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [list, countRes] = await Promise.all([
    supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
    supabase.rpc('unread_notif_count', { p_user_id: user.id }),
  ]);

  return NextResponse.json({ items: list.data ?? [], unread: countRes.data ?? 0 });
}

// PATCH /api/notifications?id=... — mark one as read
// PATCH /api/notifications?all=true — mark all as read
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  const all = url.searchParams.get('all') === 'true';

  if (all) {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    return NextResponse.json({ ok: true });
  }

  if (id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Missing id or all' }, { status: 400 });
}

// DELETE /api/notifications?id=...
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('notifications').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
