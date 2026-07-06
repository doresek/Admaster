// app/api/gbp/audit/route.ts
//
//   POST /api/gbp/audit   run the GBP completeness audit (P1-GBP-1)
//
// Body: { client_id: string, state: GbpProfileState (owner-described) }
// →     { audit: GbpAudit }
//
// The audit runs SERVER-side so the atom-derived suggestions (services list,
// prepared 750-char description) never require shipping the client's living
// insight atoms to the browser. Deterministic — NO credits, NO LLM.
//
// Manual-assist mode: no GBP API call happens here (allowlist not granted —
// G0-GBP is an owner action); the response is a checklist the owner executes
// by hand via the deep links.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getClient } from '@/lib/clients';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { auditCompleteness, coerceProfileState } from '@/lib/gbp';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      client_id?: string;
      state?: unknown;
    };
    if (!body.client_id || typeof body.client_id !== 'string') {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
    }

    // Ownership check — the audit reads this client's atoms.
    const client = await getClient(supabase, body.client_id, user.id);
    if (!client) return NextResponse.json({ error: 'הלקוח לא נמצא' }, { status: 404 });

    const state = coerceProfileState(body.state);

    // Active insight atoms ground the prepared values. Best-effort: a read
    // failure degrades to an atom-less audit, never a 500.
    const admin = createAdminClient();
    let atoms: Awaited<ReturnType<typeof listActiveInsights>> = [];
    try {
      atoms = await listActiveInsights(admin, body.client_id);
    } catch (e: any) {
      console.error('[gbp/audit] listActiveInsights failed:', e?.message ?? e);
    }

    const audit = auditCompleteness(state, atoms);
    return NextResponse.json({ audit });
  } catch (err: any) {
    console.error('[gbp/audit] POST failed:', err?.message ?? err);
    return NextResponse.json({ error: 'שגיאה בהרצת הביקורת' }, { status: 500 });
  }
}
