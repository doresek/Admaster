import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// GET /api/briefs/code-meta?code=ABC123
// Called by client brief form (no auth) to show agency name
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from('brief_codes')
    .select('agency_name, created_at')
    .eq('code', code.toUpperCase())
    .single();

  if (!data) return NextResponse.json({ error: 'Code not found' }, { status: 404 });
  return NextResponse.json(data);
}
