// app/api/pulse/route.ts
//
//   GET /api/pulse?clientId=&period=7d|30d|90d&mode=owner|marketer
//
// The single-client PULSE dashboard payload (D-1, DASHBOARD-ARCHITECTURE §1):
// metrics layer first, narration second — loadMetricInputs → computeMetrics →
// buildClientStory + narrate(register), plus the "למה?" map (diagnoses rows +
// C-04 shock state), the pending-approvals strip and the top diagnoses.
//
// Auth + ownership pattern copied from app/api/voc/route.ts: cookie-authed
// user client for identity, explicit clients-table ownership check BEFORE any
// work. All tenant reads run on the RLS user client; ONLY the fleet shock
// read uses the admin client (fleet_daily_factors has zero tenant policies by
// design — see lib/fleet/store.ts) and is wrapped so a fleet failure degrades
// to "no shock signal", never a broken dashboard.
//
// NO WRITES here — act-from-here is a LINK to the approvals surface (§1 leap
// 6, Mode-2). Live dashboard → no-store.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { computeMetrics, loadMetricInputs, METRIC_REGISTRY } from '@/lib/metrics-layer';
import { buildClientStory, narrate } from '@/lib/narration';
import type { DiagnosisFact, PendingActionFact, StoryExtras } from '@/lib/narration';
import { getShockState } from '@/lib/fleet';
import {
  buildWhys,
  filterMetricsForMode,
  isPulseMode,
  narrowDiagnosisRows,
  narrowPendingRows,
  parsePeriodParam,
  periodEndingOn,
  shockNoteHe,
  type FleetShockFact,
  type PulseDiagnosis,
  type PulseMode,
  type PulsePayload,
  type PulsePendingItem,
} from './shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fleet metrics we ask C-04 about (mirrors lib/fleet FLEET_METRICS). */
const SHOCK_QUERY_METRICS: readonly string[] = ['cpm', 'ctr', 'cvr', 'spend'];

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // ── params ──
    const params = req.nextUrl.searchParams;
    const clientId = params.get('clientId')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }
    const days = parsePeriodParam(params.get('period'));
    if (days === null) {
      return NextResponse.json({ error: 'period must be one of 7d, 30d, 90d' }, { status: 400 });
    }
    const modeRaw = params.get('mode') ?? 'owner';
    if (!isPulseMode(modeRaw)) {
      return NextResponse.json({ error: 'mode must be owner or marketer' }, { status: 400 });
    }
    const mode: PulseMode = modeRaw;

    // ── ownership (defense-in-depth on top of RLS) ──
    const { data: owned } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .eq('owner_user_id', user.id)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // ── metrics layer: load → compute → mode-filter (server-side, §1) ──
    const period = periodEndingOn(days, new Date());
    const { inputs, warnings } = await loadMetricInputs(supabase, {
      clientId,
      ownerUserId: user.id,
      periodStart: period.start,
      periodEnd:   period.end,
    });
    const allMetrics = computeMetrics(METRIC_REGISTRY, inputs);
    const metrics = filterMetricsForMode(mode, allMetrics);

    // ── pending approvals (leap 6 — the "ממתין לך" strip) ──
    // Cheapest honest per-client source: the approvals table (status='pending',
    // RLS-owned by user_id). client_id-scoped rows plus unscoped (client_id
    // null) rows both wait for THIS user, so both count. autonomy_events
    // 'action_proposed' rows are NOT counted: an event log has no clean
    // "still pending" predicate (decided proposals stay in the log), so
    // counting it would overstate — the approvals row is the pending truth.
    let pending: PulsePendingItem[] = [];
    let pendingNote: string | null = null;
    const apprQ = await supabase
      .from('approvals')
      .select('id, title, created_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .or(`client_id.eq.${clientId},client_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(20);
    if (apprQ.error) {
      pendingNote = 'לא הצלחנו לקרוא את הפעולות הממתינות כרגע — בדוק במסך האישורים';
      warnings.push(`approvals read failed: ${apprQ.error.message}`);
    } else {
      pending = narrowPendingRows(apprQ.data);
    }

    // ── recent diagnoses (top 2 — the "למה?" content, leap 3) ──
    // Absent-table-safe: migration 030 may be unapplied; ANY read error
    // degrades to "no diagnoses yet" with a warning, never a 500.
    let diagnoses: PulseDiagnosis[] = [];
    const diagQ = await supabase
      .from('diagnoses')
      .select('id, rationale, failed_link, created_at')
      .eq('client_id', clientId)
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(2);
    if (diagQ.error) {
      warnings.push(`diagnoses read failed (treated as none): ${diagQ.error.message}`);
    } else {
      diagnoses = narrowDiagnosisRows(diagQ.data);
    }

    // ── C-04 shock state ("שוק, לא אתה") — admin client, wrapped safe ──
    let shocks: FleetShockFact[] = [];
    try {
      const admin = createAdminClient();
      const states = await Promise.all(
        SHOCK_QUERY_METRICS.map((metric) => getShockState(admin, period.end, metric)),
      );
      shocks = SHOCK_QUERY_METRICS.map((metric, i) => ({ metric, state: states[i] }))
        .filter((s) => s.state.shocked);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`shock state unavailable (treated as calm): ${message}`);
      shocks = [];
    }

    // ── narration: story block + full register text (leap 1) ──
    const pendingActions: PendingActionFact[] = pending.map((p) => ({
      id:        p.id,
      kind:      'approval',
      rationale: p.title ?? 'פריט ממתין לאישור',
    }));
    const diagnosisFacts: DiagnosisFact[] = diagnoses.map((d) => ({
      id:        d.id,
      rationale: d.rationale,
    }));
    const extras: StoryExtras = {
      // forecastRange deliberately NOT provided: no honest calibrated forecast
      // source is wired yet (leap 5 gated) — the client renders the forecast
      // line only when the story carries one, never fabricates.
      ...(pendingActions.length > 0 ? { pendingActions } : {}),
      ...(diagnosisFacts.length > 0 ? { topDiagnosis: diagnosisFacts[0] } : {}),
    };
    const story = buildClientStory(metrics, extras);
    const narration = narrate(
      { period: { start: period.start, end: period.end }, metrics, diagnoses: diagnosisFacts, atoms: [], pendingActions },
      mode,
    );

    const payload: PulsePayload = {
      mode,
      period:       { start: period.start, end: period.end, days },
      story,
      narration_he: narration.text_he,
      metrics,
      whys:         buildWhys(metrics, diagnoses, shocks),
      pending,
      pending_note: pendingNote,
      diagnoses,
      shock_note:   shockNoteHe(shocks),
      warnings:     [...warnings, ...story.warnings, ...narration.warnings],
      generated_at: new Date().toISOString(),
    };

    // Live dashboard: never cached.
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
