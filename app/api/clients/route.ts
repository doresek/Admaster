import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';
import { createClient as createClientRecord, listClients } from '@/lib/clients';

// POST /api/clients
// Body: { name (required), email?, phone?, company?, notes? }
// Creates a client IDENTITY only. This is the clean-model replacement for
// POST /api/meta/clients creation — it NEVER calls Meta/Graph and never writes
// a credential. Meta connect stays an optional step on the client workspace.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
      name?: string; email?: string; phone?: string; company?: string; notes?: string;
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

    const client = await createClientRecord(supabase, {
      ownerUserId: user.id,
      name,
      email:   body.email   ?? null,
      phone:   body.phone   ?? null,
      company: body.company ?? null,
      notes:   body.notes   ?? null,
    });

    return NextResponse.json(client);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/clients — list the authenticated user's clients (newest first).
export async function GET() {
  try {
    const supabase = await createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clients = await listClients(supabase, user.id);
    return NextResponse.json(clients);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
