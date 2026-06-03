import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { briefCompletion } from '@/lib/briefing-template';

// GET /api/briefs/by-token?token=...
// Public (no auth). Token-scoped read so the public fill page can hydrate
// existing answers (prevents a blank reopen from overwriting saved data).
// Returns ONLY { values, completion, client_name } for THAT token's client.
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')?.trim() || '';
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: briefCode, error: codeErr } = await admin
      .from('brief_codes')
      .select('client_id, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (codeErr || !briefCode) {
      return NextResponse.json({ error: 'קוד בריף לא קיים' }, { status: 404 });
    }

    if (briefCode.expires_at && new Date(briefCode.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'הקישור פג תוקף' }, { status: 410 });
    }

    let values: Record<string, unknown> = {};
    let client_name: string | null = null;

    if (briefCode.client_id) {
      const [{ data: brief }, { data: client }] = await Promise.all([
        admin
          .from('briefs')
          .select('values')
          .eq('client_id', briefCode.client_id)
          .maybeSingle(),
        admin
          .from('meta_clients')
          .select('name')
          .eq('id', briefCode.client_id)
          .maybeSingle(),
      ]);
      values      = (brief?.values ?? {}) as Record<string, unknown>;
      client_name = client?.name ?? null;
    }

    return NextResponse.json({
      values,
      completion: briefCompletion(values),
      client_name,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
