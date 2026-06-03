import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { briefCompletion } from '@/lib/briefing-template';
import type { BriefValues } from '@/types';

// Verify the client [id] belongs to the authenticated user; returns the user
// or null. Centralizes the ownership gate shared by GET/PUT.
async function ownedClient(clientId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, ok: false as const };
  const { data: client } = await supabase
    .from('meta_clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', user.id)
    .maybeSingle();
  return { user, ok: !!client };
}

// GET /api/clients/[id]/brief  (auth required)
// Load the marketer's brief for a client → { values, status, completion }.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, ok } = await ownedClient(params.id);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ok)   return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const supabase = createClient();
    const { data: brief } = await supabase
      .from('briefs')
      .select('values, status')
      .eq('client_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!brief) return NextResponse.json({ values: {}, status: null, completion: 0 });

    return NextResponse.json({
      values:     brief.values ?? {},
      status:     brief.status,
      completion: briefCompletion((brief.values ?? {}) as Record<string, unknown>),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/clients/[id]/brief  (auth required)
// Upsert the client's brief. Body: { values }. Ensures a brief_codes row
// exists (so a public link can later be issued), then upserts the briefs row
// keyed by client_id. Returns { ok, completion }.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, ok } = await ownedClient(params.id);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ok)   return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const body = await req.json() as { values?: BriefValues };
    const values = body.values ?? ({} as BriefValues);

    // Trusted write (gated above) → admin client to avoid RLS friction, same as
    // the brief-link route.
    const admin = createAdminClient();

    // Ensure a brief_codes row exists for this client (mirrors brief-link style).
    const { data: existingCode } = await admin
      .from('brief_codes')
      .select('code')
      .eq('client_id', params.id)
      .maybeSingle();

    let code: string;
    if (existingCode) {
      code = existingCode.code;
    } else {
      code = randomBytes(4).toString('hex').toUpperCase();
      const { error } = await admin
        .from('brief_codes')
        .insert({ code, client_id: params.id, user_id: user.id });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const completion = briefCompletion(values as Record<string, unknown>);
    const status     = completion >= 100 ? 'complete' : 'new';

    // Upsert the briefs row keyed by client_id.
    const { data: existing } = await admin
      .from('briefs')
      .select('id')
      .eq('client_id', params.id)
      .maybeSingle();

    if (existing) {
      const { error } = await admin
        .from('briefs')
        .update({ values, status, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await admin
        .from('briefs')
        .insert({ code, user_id: user.id, client_id: params.id, values, status });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, completion });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
