import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import type { BriefValues } from '@/types';

// POST /api/briefs/submit
// Called by client (no auth) when submitting brief form
export async function POST(req: NextRequest) {
  try {
    const { code, values } = await req.json() as { code: string; values: BriefValues };

    if (!code || !values) {
      return NextResponse.json({ error: 'Missing code or values' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify code exists and get the marketer's user_id
    const { data: briefCode, error: codeErr } = await admin
      .from('brief_codes')
      .select('user_id')
      .eq('code', code.toUpperCase())
      .single();

    if (codeErr || !briefCode) {
      return NextResponse.json({ error: 'קוד בריף לא קיים' }, { status: 404 });
    }

    // Insert brief submission
    const { data, error } = await admin
      .from('briefs')
      .insert({
        code:    code.toUpperCase(),
        user_id: briefCode.user_id,
        values,
        status:  'new',
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, id: data.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
