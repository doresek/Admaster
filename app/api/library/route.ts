import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PATCH /api/library?id=... — update content metadata (favorite/tags/folder/title)
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const body = await req.json();
  const updates: Record<string, any> = {};
  if (body.favorite !== undefined) updates.favorite = !!body.favorite;
  if (body.tags     !== undefined) updates.tags     = Array.isArray(body.tags) ? body.tags : [];
  if (body.folder   !== undefined) updates.folder   = body.folder || null;
  if (body.title    !== undefined) updates.title    = body.title || null;
  if (body.client_id !== undefined) updates.client_id = body.client_id || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('generated_content')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/library?id=...
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('generated_content').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
