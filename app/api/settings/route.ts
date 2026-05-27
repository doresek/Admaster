import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED = [
  'notif_approval','notif_lead','notif_series','notif_credits_low','notif_billing','notif_support','notif_email',
  'theme','default_platform','default_tone','default_framework',
];

// GET /api/settings — fetch user's settings + profile
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [settingsRes, profileRes] = await Promise.all([
    supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('users').select('id, name, email, plan, credits').eq('id', user.id).single(),
  ]);

  return NextResponse.json({
    settings: settingsRes.data ?? null,
    profile:  profileRes.data,
  });
}

// PATCH /api/settings — update preferences and/or profile name
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  // Update user profile name (other fields require auth flow)
  if (typeof body.name === 'string' && body.name.trim()) {
    await supabase.from('users').update({ name: body.name.trim(), updated_at: new Date().toISOString() }).eq('id', user.id);
  }

  // Update settings
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const k of ALLOWED) {
    if (body[k] !== undefined) updates[k] = body[k];
  }

  if (Object.keys(updates).length > 1) {
    await supabase.from('user_settings')
      .upsert({ user_id: user.id, ...updates }, { onConflict: 'user_id' });
  }

  return NextResponse.json({ ok: true });
}

// POST /api/settings/password — change password
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { password } = await req.json();
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'הסיסמה חייבת להכיל לפחות 8 תווים' }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/settings — danger zone: delete the user's account (cascades)
export async function DELETE() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Delete profile row (cascades to all owned data via FK on delete cascade)
  await supabase.from('users').delete().eq('id', user.id);
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
