// app/api/organic/plan/route.ts
//
//   POST /api/organic/plan          build + record a content-calendar plan (P1-5)
//   GET  /api/organic/plan?client_id=  the client's recorded plans + slot statuses
//
// POST body: { client_id: string, weeks?: 2|3|4 (default 2),
//              posts_per_week?: number (default 3, capped 1..6),
//              start_date?: 'YYYY-MM-DD' (default: next Sunday, server-computed) }
// → { campaign_id, rationale, slots: [{ schedule_id, date, post_type, topic,
//     angle, status, message, grounded_in }] }
//
// NO credits here: the plan is deterministic (deterministicExpander). LLM topic
// expansion is a later wire-in — swap the expander when that task lands.
//
// GET → { plans: [{ campaign_id, name, created_at, rationale, slots: [...] }] }
// newest plan first, slots by scheduled_at asc, each joined with its
// calendar_slot decision (topic/angle/post_type) by date.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getClient } from '@/lib/clients';
import { listActiveInsights } from '@/lib/intelligence/insights';
import {
  buildCalendarPlan,
  deterministicExpander,
  recordCalendarPlan,
  supabaseScheduleStore,
} from '@/lib/organic-calendar';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import { nextSundayISO, slotDateISO } from './helpers';

export const runtime = 'nodejs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DecisionRow {
  campaign_id: string | null;
  decision: Record<string, unknown>;
  grounded_in: string[] | null;
  rationale: string | null;
}

/** decision jsonb → display fields, defensive against malformed rows. */
function decisionFields(d: Record<string, unknown> | undefined) {
  return {
    post_type: typeof d?.post_type === 'string' ? (d.post_type as string) : 'tip',
    topic: typeof d?.topic === 'string' ? (d.topic as string) : '',
    angle: typeof d?.angle === 'string' ? (d.angle as string) : '',
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      client_id?: string;
      weeks?: number;
      posts_per_week?: number;
      start_date?: string;
    };
    if (!body.client_id || typeof body.client_id !== 'string') {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
    }
    if (body.start_date !== undefined && !ISO_DATE.test(String(body.start_date))) {
      return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 });
    }

    // Ownership check — the plan writes rows under this client.
    const client = await getClient(supabase, body.client_id, user.id);
    if (!client) return NextResponse.json({ error: 'הלקוח לא נמצא' }, { status: 404 });

    const weeks = (typeof body.weeks === 'number' ? body.weeks : 2) as 2 | 3 | 4;
    const postsPerWeek = typeof body.posts_per_week === 'number' ? body.posts_per_week : 3;
    const startDate = body.start_date ?? nextSundayISO(new Date());

    const admin = createAdminClient();

    // Active insight atoms ground the topics. Best-effort: a read failure
    // degrades to the generic-topics plan, never a 500.
    let atoms: Awaited<ReturnType<typeof listActiveInsights>> = [];
    try {
      atoms = await listActiveInsights(admin, body.client_id);
    } catch (e: any) {
      console.error('[organic/plan] listActiveInsights failed:', e?.message ?? e);
    }

    // Deterministic expander for now — the LLM topic expander is a later
    // wire-in (buildCalendarPlan already takes it as a seam).
    const plan = await buildCalendarPlan({
      atoms,
      config: { weeks, postsPerWeek, startDate },
      expander: deterministicExpander,
    });

    const recorded = await recordCalendarPlan({
      plan,
      clientId: body.client_id,
      ownerUserId: user.id,
      store: supabaseCampaignStore(admin),
      scheduleStore: supabaseScheduleStore(admin),
    });

    if (!recorded.persisted || !recorded.campaignId) {
      return NextResponse.json(
        { error: 'שמירת התוכנית נכשלה — נסה שוב בעוד רגע' },
        { status: 502 },
      );
    }

    // recordCalendarPlan doesn't return per-slot schedule ids — read them back
    // by campaign and join to plan slots by date (one slot per date per plan).
    const { data, error: rowsErr } = await admin
      .from('organic_schedule')
      .select('id, scheduled_at, status, message')
      .eq('campaign_id', recorded.campaignId)
      .order('scheduled_at', { ascending: true });
    if (rowsErr) console.error('[organic/plan] schedule read-back failed:', rowsErr.message);
    const rows = (data ?? []) as unknown as
      { id: string; scheduled_at: string; status: string; message: string | null }[];

    const rowByDate = new Map(rows.map((r) => [slotDateISO(r.scheduled_at), r]));

    const slots = plan.slots.map((s) => {
      const row = rowByDate.get(s.date);
      return {
        schedule_id: row?.id ?? null,
        date: s.date,
        post_type: s.post_type,
        topic: s.topic,
        angle: s.angle,
        status: row?.status ?? 'planned',
        message: row?.message ?? null,
        grounded_in: s.grounded_in,
        rationale: s.rationale,
      };
    });

    return NextResponse.json({
      campaign_id: recorded.campaignId,
      rationale: plan.rationale,
      slots_recorded: recorded.slotsInserted,
      slots,
    });
  } catch (err: any) {
    console.error('[organic/plan] POST failed:', err?.message ?? err);
    return NextResponse.json({ error: 'שגיאה ביצירת התוכנית' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('client_id');
    if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });

    const client = await getClient(supabase, clientId, user.id);
    if (!client) return NextResponse.json({ error: 'הלקוח לא נמצא' }, { status: 404 });

    const admin = createAdminClient();

    // All of the client's schedule rows (owner-scoped explicitly — admin
    // client bypasses RLS, matching the lib/campaigns/store convention).
    const { data: slotData, error: slotErr } = await admin
      .from('organic_schedule')
      .select('id, campaign_id, scheduled_at, published_at, status, message, meta_post_id, grounded_in, rationale')
      .eq('client_id', clientId)
      .eq('owner_user_id', user.id)
      .order('scheduled_at', { ascending: true });
    if (slotErr) throw new Error(slotErr.message);
    const slotRows = (slotData ?? []) as unknown as {
      id: string; campaign_id: string | null; scheduled_at: string;
      published_at: string | null; status: string; message: string | null;
      meta_post_id: string | null; grounded_in: string[] | null; rationale: string | null;
    }[];

    const campaignIds = [...new Set(slotRows.map((r) => r.campaign_id).filter(Boolean))] as string[];
    if (campaignIds.length === 0) return NextResponse.json({ plans: [] });

    // The anchoring campaigns (name/rationale/created_at — newest plan first)…
    const { data: campData, error: campErr } = await admin
      .from('campaigns')
      .select('id, name, rationale, created_at')
      .in('id', campaignIds)
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false });
    if (campErr) throw new Error(campErr.message);
    const campaigns = (campData ?? []) as unknown as
      { id: string; name: string; rationale: string | null; created_at: string }[];

    // …and their calendar_slot decisions (topic/angle/post_type per date).
    const { data: decisions, error: decErr } = await admin
      .from('campaign_decisions')
      .select('campaign_id, decision, grounded_in, rationale')
      .in('campaign_id', campaignIds)
      .eq('decision_type', 'calendar_slot')
      .eq('owner_user_id', user.id);
    if (decErr) throw new Error(decErr.message);

    const decByCampaign = new Map<string, DecisionRow[]>();
    for (const d of (decisions ?? []) as DecisionRow[]) {
      if (!d.campaign_id) continue;
      const list = decByCampaign.get(d.campaign_id) ?? [];
      list.push(d);
      decByCampaign.set(d.campaign_id, list);
    }

    const plans = campaigns.map((c) => {
      const decs = decByCampaign.get(c.id) ?? [];
      const slots = slotRows
        .filter((r) => r.campaign_id === c.id)
        .map((r) => {
          const date = slotDateISO(r.scheduled_at);
          const dec = decs.find((d) => d.decision?.date === date);
          return {
            schedule_id: r.id,
            date,
            ...decisionFields(dec?.decision),
            status: r.status,
            message: r.message,
            meta_post_id: r.meta_post_id,
            published_at: r.published_at,
            grounded_in: r.grounded_in ?? [],
            rationale: r.rationale,
          };
        });
      return {
        campaign_id: c.id,
        name: c.name,
        rationale: c.rationale,
        created_at: c.created_at,
        slots,
      };
    });

    return NextResponse.json({ plans });
  } catch (err: any) {
    console.error('[organic/plan] GET failed:', err?.message ?? err);
    return NextResponse.json({ error: 'שגיאה בטעינת לוח התוכן' }, { status: 500 });
  }
}
