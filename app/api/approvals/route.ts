import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

// Create a new approval request
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { client_id, title, content } = await req.json();
  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 });

  const token = randomBytes(16).toString('hex');

  const { data, error } = await supabase.from('approvals').insert({
    user_id:   user.id,
    client_id: client_id ?? null,
    token,
    title:     title ?? null,
    content,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approval: data, token });
}

// List approvals for current user
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('approvals')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

// Delete an approval
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('approvals').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
