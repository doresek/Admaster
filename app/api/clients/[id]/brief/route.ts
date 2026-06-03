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

    // Ensure a brief_codes row exists for this client (so a public link can
    // later be issued). The unique constraint on brief_codes(client_id)
    // guarantees ≤1 row, so SELECT-then-INSERT-if-missing is race-safe here.
    // We must NOT clobber an existing token/expires_at — this path only needs
    // a `code` to exist — so we only INSERT a fresh row when none exists.
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
        .upsert(
          { code, client_id: params.id, user_id: user.id },
          { onConflict: 'client_id' }
        );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const completion = briefCompletion(values as Record<string, unknown>);

    // Never downgrade status: read the current status once and only ever move
    // forward. 'complete' / 'has_avatar' are preserved unless completion drops
    // below 100 — in which case we keep them (never → 'new').
    const { data: existingBrief } = await admin
      .from('briefs')
      .select('status')
      .eq('client_id', params.id)
      .maybeSingle();
    const prev = existingBrief?.status as string | undefined;
    const status =
      completion >= 100              ? 'complete'
      : prev === 'complete'          ? 'complete'
      : prev === 'has_avatar'        ? 'has_avatar'
      :                                'new';

    // Race-safe upsert keyed by client_id. `code` + `user_id` are stable, so
    // including them in the payload is harmless on update and required on
    // first insert.
    const { error } = await admin
      .from('briefs')
      .upsert(
        {
          client_id:  params.id,
          values,
          status,
          updated_at: new Date().toISOString(),
          code,
          user_id:    user.id,
        },
        { onConflict: 'client_id' }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, completion });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
