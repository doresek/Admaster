// app/api/measurement/route.ts
//
//   GET  /api/measurement   client-scoped funnel-lead list (the UI wave's feed)
//                           ?clientId=&stage=&limit=
//   POST /api/measurement   one-tap stage mark (plan §2 "stages" step)
//                           body: { clientId, leadId, stage, value?, note? }
//                           → markStage(markedVia 'ui')
//
// Auth + ownership pattern per app/api/voc/route.ts: cookie-authed user client
// for identity, explicit clients-table ownership check (RLS-scoped) BEFORE any
// work, admin client for the data layer (funnel tables are owner-only RLS;
// the data layer still scopes every query by client_id + owner_user_id).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { LeadStage } from '@/lib/capability-contracts';
import { LIST_LEADS_MAX_LIMIT, listLeads, markStage } from '@/lib/measurement';

export const runtime = 'nodejs';

const VALID_STAGES: readonly LeadStage[] = [
  'new', 'contacted', 'qualified', 'meeting', 'closed_won', 'closed_lost', 'irrelevant',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE_CHARS = 500;
const MAX_VALUE_ILS = 100_000_000; // sanity cap on a "deal value" from the UI

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isLeadStage = (v: unknown): v is LeadStage =>
  typeof v === 'string' && (VALID_STAGES as readonly string[]).includes(v);

/** RLS-scoped ownership check: the row comes back only to its owner. */
async function ownsClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
): Promise<boolean> {
  const { data } = await supabase.from('clients').select('id').eq('id', clientId).maybeSingle();
  return Boolean(data);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = req.nextUrl.searchParams;
    const clientId = params.get('clientId')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }

    const stageRaw = params.get('stage') ?? undefined;
    if (stageRaw !== undefined && !isLeadStage(stageRaw)) {
      return NextResponse.json(
        { error: `stage must be one of ${VALID_STAGES.join(', ')}` },
        { status: 400 },
      );
    }

    const limitRaw = params.get('limit');
    const limit = limitRaw !== null ? Number.parseInt(limitRaw, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > LIST_LEADS_MAX_LIMIT)) {
      return NextResponse.json(
        { error: `limit must be an integer between 1 and ${LIST_LEADS_MAX_LIMIT}` },
        { status: 400 },
      );
    }

    if (!(await ownsClient(supabase, clientId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const leads = await listLeads(createAdminClient(), clientId, user.id, {
      ...(stageRaw !== undefined && isLeadStage(stageRaw) ? { stage: stageRaw } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return NextResponse.json({ leads });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: unknown = await req.json().catch(() => null);
    if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : '';
    if (!UUID_RE.test(leadId)) {
      return NextResponse.json({ error: 'leadId must be a UUID' }, { status: 400 });
    }
    if (!isLeadStage(body.stage)) {
      return NextResponse.json(
        { error: `stage must be one of ${VALID_STAGES.join(', ')}` },
        { status: 400 },
      );
    }
    const stage: LeadStage = body.stage;

    let value: number | null = null;
    if (body.value !== undefined && body.value !== null) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0 || body.value > MAX_VALUE_ILS) {
        return NextResponse.json(
          { error: `value must be a number between 0 and ${MAX_VALUE_ILS}` },
          { status: 400 },
        );
      }
      value = body.value;
    }

    let note: string | null = null;
    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== 'string' || body.note.length > MAX_NOTE_CHARS) {
        return NextResponse.json(
          { error: `note must be a string of at most ${MAX_NOTE_CHARS} chars` },
          { status: 400 },
        );
      }
      note = body.note;
    }

    if (!(await ownsClient(supabase, clientId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await markStage(createAdminClient(), {
      leadId, clientId, ownerUserId: user.id, stage, value, note, markedVia: 'ui',
    });

    if (!result.ok) {
      const status =
        result.reason === 'lead_not_found'     ? 404 :
        result.reason === 'invalid_transition' ? 409 : 500;
      return NextResponse.json({ error: result.message, reason: result.reason }, { status });
    }

    return NextResponse.json({
      ok:       true,
      lead:     result.lead,
      event:    result.event,
      learning: result.learning,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
