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
import { applyLearningSignal } from '@/lib/intelligence/lifecycle';
import { synthesizeStrategy } from '@/lib/intelligence/synthesize';
import { INSIGHT_COLUMNS, type ClientInsight, type LearningSignal } from '@/lib/intelligence/types';

// Explicit user signals are strong but not decisive on their own: 0.8 corroborates
// hard on "worked", and on "wrong" crosses the DECISIVE_WEIGHT (0.70) threshold so
// a single confident "this is wrong" refutes the belief.
const USER_SIGNAL_WEIGHT = 0.8;

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

  // ── 3. Insert the learning_signals row ─────────────────────────────────────
  const polarity: 'positive' | 'negative' = kind === 'worked' ? 'positive' : 'negative';
  const signalType = kind === 'worked' ? 'user_worked' : 'user_wrong';

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

  // ── 4. Apply the signal to each resolved insight (writes insight_events) ────
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

  // ── 5. Mark the signal processed, then re-synthesize the snapshot ──────────
  await admin.from('learning_signals').update({ processed: true }).eq('id', signalId);

  if (clientId) {
    try {
      await synthesizeStrategy(admin, clientId);
    } catch (e: any) {
      console.error('[signal route] re-synthesis failed:', e?.message ?? e);
    }
  }

  return NextResponse.json({ ok: true, signalId, applied: updated.length, insights: updated });
}
