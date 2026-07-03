// app/api/intelligence/signal/route.ts
//
// The USER-SIGNAL loop: a marketer tells us a generated artifact (or a specific
// insight) "worked" (✓) or "was wrong" (✗). We:
//   1. insert a learning_signals row (user_worked/user_wrong, pos/neg, weight 0.8)
//   2. resolve the target insight(s) — an artifact's insight_ids, or one insightId
//   3. apply the signal to each via lifecycle.applyLearningSignal (corroborate on
//      worked / weaken-or-refute on wrong) — each writes an insight_events row
//   4. mark the signal processed
//   5. re-synthesize the client_strategy snapshot from the (now updated) atoms
// and return the updated insight summaries.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { applyLearningSignal, claimSignal } from '@/lib/intelligence/lifecycle';
import { synthesizeStrategy } from '@/lib/intelligence/synthesize';
import { INSIGHT_COLUMNS, type ClientInsight, type LearningSignal } from '@/lib/intelligence/types';

// Explicit user signals are strong but not decisive on their own: 0.8 corroborates
// hard on "worked", and on "wrong" crosses the DECISIVE_WEIGHT (0.70) threshold so
// a single confident "this is wrong" refutes the belief.
const USER_SIGNAL_WEIGHT = 0.8;

// Two DISTINCT rapid clicks (a double-submit) on the same target+kind within this
// window are treated as ONE human opinion: we skip creating the second signal so
// the atom isn't bumped twice. (Replays of the SAME signal row are guarded
// separately by the processed-CAS claim below.)
const DEDUP_WINDOW_MS = 5000;

interface SignalBody {
  artifactId?: string;
  insightId?:  string;
  kind:        'worked' | 'wrong';
  detail?:     string;
}

interface InsightSummary {
  id:         string;
  layer:      string;
  kind:       string;
  content:    string;
  confidence: number;
  status:     string;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as SignalBody;
  const { artifactId, insightId, kind, detail } = body;

  if (kind !== 'worked' && kind !== 'wrong') {
    return NextResponse.json({ error: 'kind must be "worked" or "wrong"' }, { status: 400 });
  }
  if (!artifactId && !insightId) {
    return NextResponse.json({ error: 'Provide artifactId or insightId' }, { status: 400 });
  }

  const admin = createAdminClient();

  // ── 1. Resolve the target insight ids + the client they belong to ──────────
  let clientId: string | null = null;
  let targetInsightIds: string[] = [];

  if (artifactId) {
    const { data: artifact } = await admin
      .from('content_artifacts')
      .select('id, client_id, owner_user_id, insight_ids')
      .eq('id', artifactId)
      .eq('owner_user_id', user.id)   // owner scope (admin bypasses RLS)
      .maybeSingle();
    if (!artifact) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
    clientId = (artifact as any).client_id ?? null;
    targetInsightIds = Array.isArray((artifact as any).insight_ids) ? (artifact as any).insight_ids : [];
  } else if (insightId) {
    targetInsightIds = [insightId];
  }

  // ── 2. Load the target ClientInsight rows (owner-scoped) ───────────────────
  let insights: ClientInsight[] = [];
  if (targetInsightIds.length) {
    const { data } = await admin
      .from('client_insights')
      .select(INSIGHT_COLUMNS)
      .in('id', targetInsightIds)
      .eq('owner_user_id', user.id);
    insights = (data as unknown as ClientInsight[]) ?? [];
  }
  // Derive the client from an insight when we didn't get it from an artifact.
  if (!clientId && insights[0]) clientId = insights[0].client_id;

  const summarize = (list: ClientInsight[]): InsightSummary[] =>
    list.map((i) => ({
      id: i.id, layer: i.layer, kind: i.kind, content: i.content,
      confidence: i.confidence, status: i.status,
    }));

  // ── 3. Insert the learning_signals row ─────────────────────────────────────
  const polarity: 'positive' | 'negative' = kind === 'worked' ? 'positive' : 'negative';
  const signalType = kind === 'worked' ? 'user_worked' : 'user_wrong';

  // 3a. De-dupe two DISTINCT rapid clicks (double-submit) for the same
  //     target+kind: if a signal for this (target, signal_type, owner) was
  //     created within DEDUP_WINDOW_MS, skip — one human opinion, one bump.
  const dedupCol = artifactId ? 'artifact_id' : 'insight_id';
  const dedupVal = artifactId ?? insightId ?? insights[0]?.id ?? null;
  if (dedupVal) {
    const { data: recent } = await admin
      .from('learning_signals')
      .select('id, created_at')
      .eq('owner_user_id', user.id)
      .eq('signal_type', signalType)
      .eq(dedupCol, dedupVal);
    const now = Date.now();
    const dup = (recent ?? []).find((r: any) => {
      const t = r.created_at ? Date.parse(r.created_at) : NaN;
      return Number.isFinite(t) && now - t < DEDUP_WINDOW_MS;
    });
    if (dup) {
      return NextResponse.json({
        ok: true, deduped: true, signalId: (dup as any).id,
        applied: 0, insights: summarize(insights),
      });
    }
  }

  const { data: sigRow, error: sigErr } = await admin
    .from('learning_signals')
    .insert({
      client_id:     clientId,
      owner_user_id: user.id,
      artifact_id:   artifactId ?? null,
      insight_id:    insightId ?? (insights[0]?.id ?? null),
      signal_type:   signalType,
      polarity,
      weight:        USER_SIGNAL_WEIGHT,
      detail:        detail ?? null,
      processed:     false,
    })
    .select('id')
    .single();
  if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 });
  const signalId = (sigRow as { id: string }).id;

  // ── 4. CAS-claim the signal, then apply it once. The claim atomically flips
  //      processed false→true; if we lose the race (a concurrent request already
  //      claimed & applied this row) we skip applying so no double-count occurs.
  const claimed = await claimSignal(admin, signalId);
  if (!claimed) {
    return NextResponse.json({
      ok: true, alreadyProcessed: true, signalId,
      applied: 0, insights: summarize(insights),
    });
  }

  const signal: LearningSignal = {
    polarity,
    weight:   USER_SIGNAL_WEIGHT,
    signalId,
    reason:   detail || `user_${kind}`,
  };

  const updated: InsightSummary[] = [];
  for (const insight of insights) {
    const out = await applyLearningSignal(admin, insight, signal);
    updated.push({
      id:         insight.id,
      layer:      insight.layer,
      kind:       insight.kind,
      content:    insight.content,
      confidence: out ? out.confidence : insight.confidence,
      status:     out ? out.status : 'refuted',
    });
  }

  // ── 5. Re-synthesize the snapshot (the claim already marked processed=true) ─
  if (clientId) {
    try {
      await synthesizeStrategy(admin, clientId);
    } catch (e: any) {
      console.error('[signal route] re-synthesis failed:', e?.message ?? e);
    }
  }

  return NextResponse.json({ ok: true, signalId, applied: updated.length, insights: updated });
}
