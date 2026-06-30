import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { advanceJourneyOnBrief } from '@/lib/journey';
import { orchestrateClientCore } from '@/lib/client-core/orchestrator';
import { allRequiredSatisfied } from '@/lib/brief-v2';
import type { BriefValues } from '@/types';

// The client-core orchestrator runs AFTER the response via waitUntil and chains
// 3-layer analysis -> reconcile -> synthesize (several sequential Anthropic
// calls). The default function budget is too short; allow up to 300s.
export const maxDuration = 300;

// POST /api/briefs/submit
// Called by client (no auth) when submitting brief form
export async function POST(req: NextRequest) {
  try {
    // Public endpoint → rate-limit by IP: 10 submissions / hour.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const rl = checkRateLimit(`brief-submit:${ip}`, { max: 10, windowMs: 60 * 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'יותר מדי שליחות — נסה שוב מאוחר יותר', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }

    const { code, token, values } = await req.json() as { code?: string; token?: string; values: BriefValues };

    if ((!code && !token) || !values) {
      return NextResponse.json({ error: 'Missing code/token or values' }, { status: 400 });
    }

    // Brief v2 gate: the 5 required owner-language (Group A) questions must each
    // be answered (trimmed length ≥ 10) OR carry the deliberate "unsure" escape.
    // Mirrors the client-side submit gate so an under-filled brief never lands.
    if (!allRequiredSatisfied(values as Record<string, unknown>)) {
      return NextResponse.json(
        { error: 'יש לענות על כל שאלות החובה (או לסמן "לא בטוח")' },
        { status: 400 },
      );
    }

    // Reject malformed tokens before any DB hit (matches generateBriefToken()).
    if (token && !/^[a-f0-9]{64}$/.test(token)) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Resolve the brief code by token (magic-link flow) or by code (legacy
    // manual-entry flow). Either way we read the canonical `code` so the briefs
    // row satisfies its NOT NULL FK, plus the marketer's user_id and the client
    // the code was issued for — the brief deterministically inherits client_id.
    const lookup = admin.from('brief_codes').select('code, user_id, client_id');
    const { data: briefCode, error: codeErr } = token
      ? await lookup.eq('token', token).single()
      : await lookup.eq('code', String(code).toUpperCase()).single();

    if (codeErr || !briefCode) {
      return NextResponse.json({ error: 'קוד בריף לא קיים' }, { status: 404 });
    }

    // Persist the brief submission — code + client_id inherited from the brief
    // code. One brief per client is the intended design (unique(client_id)), so a
    // RE-SUBMIT must UPDATE the existing row, not collide on the constraint:
    //   • client_id present → UPSERT on conflict(client_id): refreshes
    //     values/status/updated_at when a brief already exists, inserts otherwise.
    //   • client_id null (edge) → plain insert (no conflict target).
    // Brief "history" is preserved via the brain's client_insights/insight_events
    // accumulation, not duplicate brief rows.
    const now = new Date().toISOString();
    const { data, error } = briefCode.client_id
      ? await admin
          .from('briefs')
          .upsert(
            {
              client_id:  briefCode.client_id,
              code:       briefCode.code,
              user_id:    briefCode.user_id,
              values,
              status:     'new',
              updated_at: now,
            },
            { onConflict: 'client_id' },
          )
          .select('id, client_id, user_id')
          .single()
      : await admin
          .from('briefs')
          .insert({
            code:      briefCode.code,
            user_id:   briefCode.user_id,
            client_id: null,
            values,
            status:    'new',
          })
          .select('id, client_id, user_id')
          .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Advance the client's journey to brief_in (audit-logged). Skips gracefully
    // when the brief has no client_id; never throws back to the submitter.
    await advanceJourneyOnBrief(admin, briefCode.user_id, data.client_id ?? null, data.id);

    // Build the durable client core (3-layer analysis -> reconcile -> synthesize)
    // from this brief WITHOUT blocking the submit response — the endpoint returns
    // as fast as before. We use the agency user_id / client_id / brief_id already
    // resolved above.
    //
    // RELIABILITY: on serverless (Vercel) a bare fire-and-forget promise is NOT
    // guaranteed to finish — the function is frozen/torn down right after the
    // response, so the orchestrator would persist only its first writes and never
    // reach synthesize. `waitUntil` registers the promise with the platform so the
    // function stays alive until it settles (within maxDuration), after the
    // response is already sent. The authenticated POST /api/client-core/run route
    // remains as an idempotent dashboard-driven safety net, so a waitUntil run plus
    // a /run call never double-builds.
    //
    // force: true — a re-submit reuses the SAME brief row (upsert above), so its
    // core_generated_at can already be newer than the brief; the orchestrator's
    // idempotency guard would then SKIP. force re-runs the 3-layer analysis from
    // the freshly-submitted answers on every submit.
    if (data.client_id) {
      waitUntil(
        orchestrateClientCore(createAdminClient(), {
          userId:   briefCode.user_id,
          clientId: data.client_id,
          briefId:  data.id,
          force:    true,
        }).catch((e: any) =>
          console.error('[briefs/submit] client-core orchestrator failed:', e?.message)
        )
      );
    }

    return NextResponse.json({ success: true, id: data.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
