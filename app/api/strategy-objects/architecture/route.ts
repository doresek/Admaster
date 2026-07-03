// app/api/strategy-objects/architecture/route.ts
//
//   GET  /api/strategy-objects/architecture?clientId=
//        latest message-architecture version + the versions changelog for the
//        command center ("the owner sees the strategy as structure, not prose").
//   POST /api/strategy-objects/architecture   { clientId }
//        synthesize from the client's active atoms and persist the next
//        version (skipped when the projection is unchanged — no churn).
//
// Authed + owner-scoped per the app/api/campaigns pattern; ownership of the
// clientId is verified explicitly (foreign id → clean 404, not an empty wall).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getClient } from '@/lib/clients';
import { getLatestArchitecture, listArchitectureVersions } from '@/lib/strategy-objects/store';
import { synthesizeAndSave } from '@/lib/strategy-objects/synthesize-and-save';

export const runtime = 'nodejs';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const client = await getClient(supabase, clientId, user.id);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const admin = createAdminClient();
    const [latest, versions] = await Promise.all([
      getLatestArchitecture(admin, clientId, user.id),
      listArchitectureVersions(admin, clientId, user.id),
    ]);
    return NextResponse.json({ latest, versions });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Runtime-narrowed body parse (no compile-time assertion on untrusted JSON).
    const body: unknown = await req.json().catch(() => null);
    const clientId =
      isRecord(body) && typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const client = await getClient(supabase, clientId, user.id);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const result = await synthesizeAndSave(createAdminClient(), clientId, user.id, 'manual');
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
