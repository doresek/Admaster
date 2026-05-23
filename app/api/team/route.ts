import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

// GET /api/team
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('team_members').select('*').eq('owner_id', user.id)
    .order('invited_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

// POST /api/team — invite member
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('plan').eq('id', user.id).single();

  // Check plan limits
  const { count } = await supabase.from('team_members').select('*', { count: 'exact', head: true }).eq('owner_id', user.id);
  const limits: Record<string, number> = { free: 0, starter: 2, pro: 5, agency: 20 };
  const limit = limits[profile?.plan ?? 'free'] ?? 0;
  if ((count ?? 0) >= limit) {
    return NextResponse.json({ error: `תוכנית ${profile?.plan} מאפשרת עד ${limit} חברי צוות` }, { status: 403 });
  }

  const { email, role, name } = await req.json();
  if (!email || !role) return NextResponse.json({ error: 'Missing email or role' }, { status: 400 });

  // Check if already invited
  const { data: existing } = await supabase
    .from('team_members').select('id').eq('owner_id', user.id).eq('email', email).single();
  if (existing) return NextResponse.json({ error: 'כבר הוזמן' }, { status: 409 });

  // Check if user exists
  const admin = createAdminClient();
  const { data: { users: existingUsers } } = await admin.auth.admin.listUsers();
  const existingUser = existingUsers?.find((u: any) => u.email === email);

  const { data: member } = await supabase.from('team_members').insert({
    owner_id:  user.id,
    member_id: existingUser?.id ?? null,
    email, name, role,
  }).select().single();

  // TODO: Send invitation email via Resend/SendGrid
  // await sendInviteEmail(email, name, user.name)

  return NextResponse.json(member);
}

// DELETE /api/team?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  await supabase.from('team_members').delete().eq('id', id!).eq('owner_id', user.id);
  return NextResponse.json({ success: true });
}

// PATCH /api/team — update role
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, role } = await req.json();
  await supabase.from('team_members').update({ role }).eq('id', id).eq('owner_id', user.id);
  return NextResponse.json({ success: true });
}
