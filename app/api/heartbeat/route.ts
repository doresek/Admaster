// app/api/heartbeat/route.ts
//
//   POST /api/heartbeat  { tick: 'daily'|'weekly'|'monthly' }   (or ?tick=)
//        The trigger. Guarded by CRON_SECRET (no cookie session — crons have
//        none): the request must carry `Authorization: Bearer ${CRON_SECRET}`.
//        401 on absence or mismatch — and also when the env var itself is
//        unset (an unconfigured secret must fail CLOSED; an open heartbeat
//        trigger would let anyone spin the fleet).
//
//   GET  /api/heartbeat?tick=…       VERCEL CRON COMPATIBILITY: Vercel Cron
//        invokes cron paths with GET and, when the CRON_SECRET env var is set
//        on the project, attaches `Authorization: Bearer ${CRON_SECRET}`
//        automatically. A cron-authorized GET carrying ?tick= therefore
//        triggers the heartbeat exactly like POST — so vercel.json entries
//        can point at /api/heartbeat?tick=daily etc. with no extra plumbing.
//
//   GET  /api/heartbeat?clientId=…   Recent runs for one owned client (the
//        status surface). Cookie-authed; reads through the user-scoped client
//        so RLS enforces ownership, with the explicit owner filter on top per
//        the lib/intelligence doctrine.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { HeartbeatTick } from '@/lib/capability-contracts';
import { HEARTBEAT_RUN_COLUMNS, runHeartbeat } from '@/lib/heartbeat';

export const runtime = 'nodejs';
// Heartbeats do real work (fleet factors, per-client ticks) — take the room
// Vercel allows rather than the 10s default.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TICKS: readonly HeartbeatTick[] = ['daily', 'weekly', 'monthly'];
const isTick = (v: unknown): v is HeartbeatTick => TICKS.some((t) => t === v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Constant-shape check: env secret present AND the bearer header matches. */
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — see header
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Validate the tick and run the fleet — shared by POST and the cron GET. */
async function trigger(tick: unknown): Promise<NextResponse> {
  if (!isTick(tick)) {
    return NextResponse.json(
      { error: `tick must be one of ${TICKS.join(', ')}` },
      { status: 400 },
    );
  }
  const summary = await runHeartbeat(createAdminClient(), { tick, now: new Date() });
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Tick from the JSON body, falling back to ?tick=.
    let tick: unknown = req.nextUrl.searchParams.get('tick');
    try {
      const body: unknown = await req.json();
      if (isRecord(body) && body.tick !== undefined) tick = body.tick;
    } catch {
      // No/invalid JSON body is fine when ?tick= is present.
    }
    return await trigger(tick);
  } catch (err: unknown) {
    console.error('[heartbeat] POST failed:', errMessage(err));
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // Vercel Cron path: cron-authorized GET with ?tick= triggers the run.
    const tickParam = req.nextUrl.searchParams.get('tick');
    if (tickParam !== null) {
      if (!cronAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return await trigger(tickParam);
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
    if (!clientId || !UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId (uuid) is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('heartbeat_runs')
      .select(HEARTBEAT_RUN_COLUMNS)
      .eq('client_id', clientId)
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ runs: data ?? [] });
  } catch (err: unknown) {
    console.error('[heartbeat] GET failed:', errMessage(err));
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
