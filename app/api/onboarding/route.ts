// app/api/onboarding/route.ts
// First-run onboarding state, stored on users.onboarding (jsonb). No credits.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('users').select('onboarding').eq('id', user.id).maybeSingle();
  return NextResponse.json({ onboarding: data?.onboarding ?? {} });
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: cur } = await supabase.from('users').select('onboarding').eq('id', user.id).maybeSingle();
  const merged = { ...(cur?.onboarding ?? {}), ...patch };

  const { error } = await supabase.from('users').update({ onboarding: merged }).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, onboarding: merged });
}
