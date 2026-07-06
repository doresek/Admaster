import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomBytes } from 'node:crypto';

// Create a new approval request.
// The public /approve/[token] page can only see the row's `content` jsonb
// (via the get_approval_by_token RPC), so everything the ad preview needs —
// client name + resolved grounded atoms (the WHY) — is SNAPSHOTTED into
// `content` here at creation time. No new columns.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { client_id, title, content, grounded_in } = await req.json();
  if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 });

  const token = randomBytes(16).toString('hex');

  // Snapshot the client name so the ad frame can show WHOSE business this is
  // even on the anonymous public page.
  let clientName: string | null = null;
  if (client_id) {
    const { data: c } = await supabase
      .from('clients')
      .select('name')
      .eq('id', client_id)
      .maybeSingle();
    clientName = c?.name ?? null;
  }

  // Resolve grounded atom ids → content snapshots (same approach as
  // command-center's resolveInsights: tolerant of a missing table / bad ids).
  let grounding: { id: string; content: string | null; confidence: number | null; layer: string | null }[] = [];
  if (Array.isArray(grounded_in) && grounded_in.length > 0) {
    const unique = Array.from(new Set(grounded_in.filter((x): x is string => typeof x === 'string' && !!x))).slice(0, 12);
    if (unique.length > 0) {
      const { data: rows, error: gErr } = await supabase
        .from('client_insights')
        .select('id, content, confidence, layer')
        .in('id', unique);
      if (!gErr && Array.isArray(rows)) {
        grounding = rows.map((r) => ({
          id: r.id,
          content: r.content ?? null,
          confidence: r.confidence ?? null,
          layer: r.layer ?? null,
        }));
      }
    }
  }

  // Enrich only object payloads; unknown/string payloads pass through untouched.
  const enriched =
    content && typeof content === 'object' && !Array.isArray(content)
      ? {
          ...content,
          ...(clientName && !content.client_name ? { client_name: clientName } : {}),
          ...(grounding.length > 0 ? { grounding } : {}),
        }
      : content;

  const { data, error } = await supabase.from('approvals').insert({
    user_id:   user.id,
    client_id: client_id ?? null,
    token,
    title:     title ?? null,
    content:   enriched,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approval: data, token });
}

// List approvals for current user (optionally scoped to one client)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = new URL(req.url).searchParams.get('client_id');

  let query = supabase.from('approvals')
    .select('*')
    .eq('user_id', user.id);
  if (clientId) query = query.eq('client_id', clientId);

  const { data } = await query.order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

// Mark an approved item as published (mig 053 widened the status CHECK).
// Narrow allow-list on purpose: the ONLY transition this route performs is
// approved → published — approve/reject stay on the token-respond flow, and no
// caller-supplied status is ever written verbatim.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string };
  if (!body.id || body.action !== 'mark_published') {
    return NextResponse.json({ error: 'Expected { id, action: "mark_published" }' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('approvals')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', body.id)
    .eq('user_id', user.id)
    .eq('status', 'approved') // only an approved item can become published
    .select('id, status, published_at')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Approval not found or not in approved state' }, { status: 404 });

  return NextResponse.json(data);
}

// Delete an approval
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('approvals').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
