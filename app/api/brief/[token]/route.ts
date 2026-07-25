// app/api/brief/[token]/route.ts
// GET — fetch a brief by its token. Public; the token is the auth.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const TOKEN_REGEX = /^[a-f0-9]{64}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  if (!TOKEN_REGEX.test(params.token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('briefs')
    .select(
      'id, token, values, current_step, progress_pct, status, expires_at, client_name'
    )
    .eq('token', params.token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Expired' }, { status: 410 });
  }

  return NextResponse.json(data);
}
