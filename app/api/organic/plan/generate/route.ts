// app/api/organic/plan/generate/route.ts
//
//   POST /api/organic/plan/generate   { schedule_id } → generate the post for
//                                     one calendar slot (P1-5 → P1-3 bridge)
//
// Flow: load the organic_schedule row (owner-scoped) → reconstruct its PlanSlot
// from the campaign's calendar_slot decision (matched by date; degrades to the
// row's own message/rationale when no decision is found) → deduct credits
// (master_post: best-of-N pipeline, same cost as the master route) → run
// generateOrganicPost with the Anthropic-backed StageRunner (construction
// copied from app/api/ai/master/route.ts: withRetry + anthropic.messages.create
// with the buildAiContext prefix) → refund on failure.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { type StageRunner } from '@/lib/master-studio/pipeline';
import { withRetry, classifyError } from '@/lib/master-studio/retry';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { generateOrganicPost, supabaseSlotWriter } from '@/lib/organic-posts';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import { reconstructPlanSlot, slotDateISO } from '../helpers';

// Best-of-N runs 5-6 sequential Anthropic calls — same budget as the master route.
export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Same per-user throttle as the master route — this IS a master pipeline run.
  const rl = checkRateLimit(`master:${user.id}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { schedule_id?: string };
  if (!body.schedule_id || typeof body.schedule_id !== 'string') {
    return NextResponse.json({ error: 'schedule_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // The slot row, owner-scoped (admin bypasses RLS — filter explicitly).
  const { data: row, error: rowErr } = await admin
    .from('organic_schedule')
    .select('id, client_id, owner_user_id, campaign_id, scheduled_at, status, message, grounded_in, rationale')
    .eq('id', body.schedule_id)
    .eq('owner_user_id', user.id)
    .maybeSingle();
  if (rowErr) {
    console.error('[organic/plan/generate] slot read failed:', rowErr.message);
    return NextResponse.json({ error: 'שגיאה בטעינת התא' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'התא לא נמצא' }, { status: 404 });
  if (!row.campaign_id) {
    // generateOrganicPost anchors the campaign_items row on the calendar's
    // campaign — a slot with no campaign can't join the decision trace.
    return NextResponse.json({ error: 'לתא אין קמפיין לוח משויך' }, { status: 400 });
  }

  // Reconstruct the PlanSlot from the campaign's calendar_slot decisions,
  // matched by the slot's date (recordCalendarPlan writes one decision per slot
  // with decision jsonb {date, post_type, topic, angle}).
  const { data: decisions, error: decErr } = await admin
    .from('campaign_decisions')
    .select('decision, grounded_in, rationale')
    .eq('campaign_id', row.campaign_id)
    .eq('decision_type', 'calendar_slot')
    .eq('owner_user_id', user.id);
  if (decErr) console.error('[organic/plan/generate] decisions read failed:', decErr.message);

  const { slot, degraded } = reconstructPlanSlot(
    {
      scheduled_at: row.scheduled_at as string,
      message: (row.message as string | null) ?? null,
      grounded_in: (row.grounded_in as string[] | null) ?? [],
      rationale: (row.rationale as string | null) ?? null,
    },
    (decisions ?? []) as { decision: Record<string, unknown>; grounded_in: string[] | null; rationale: string | null }[],
  );

  // Brand context prefix — same construction as the master route.
  const ctx = await buildAiContext(supabase, {
    userId: user.id,
    clientId: row.client_id as string,
    briefId: null,
  });
  const ctxPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

  // Generation costs credits: 6⚡ (master_post), refunded on failure below.
  const deduct = await deductCredits(supabase, user.id, 'master_post');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  // Anthropic-backed stage runner (copied from app/api/ai/master/route.ts):
  // each stage retries ONCE on a transient provider error via withRetry.
  const run: StageRunner = withRetry(async (system, userPrompt, maxTokens) => {
    const msg = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: maxTokens,
      system:     ctxPrefix + system,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    const block = msg.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  });

  // brand_voice atoms for the C-07 lint (advisory). Best-effort.
  let brandAtoms: Awaited<ReturnType<typeof listActiveInsights>> = [];
  try {
    brandAtoms = await listActiveInsights(admin, row.client_id as string);
  } catch (e: any) {
    console.error('[organic/plan/generate] listActiveInsights failed:', e?.message ?? e);
  }

  try {
    const result = await generateOrganicPost({
      slot,
      slotId: row.id as string,
      clientId: row.client_id as string,
      ownerUserId: user.id,
      campaignId: row.campaign_id as string,
      run,
      store: supabaseCampaignStore(admin),
      slotWriter: supabaseSlotWriter(admin),
      admin,
      brandAtoms,
    });

    if (!result.ok) {
      await refundCredits(supabase, user.id, 'master_post', deduct.cost);
      return NextResponse.json({ error: 'נכשל ביצירה — נסה שוב', reason: result.reason }, { status: 502 });
    }

    return NextResponse.json({
      schedule_id: row.id,
      date: slotDateISO(row.scheduled_at as string),
      degraded_slot: degraded,
      post: result.post,
      hashtags: result.hashtags,
      image_prompt: result.imagePrompt,
      lint: { score: result.lint.score, passed: result.lint.passed, violations: result.lint.violations.length },
      item_id: result.itemId,
      artifact_id: result.artifactId,
      attached: result.attached,
      credits: deduct.credits,
    });
  } catch (err: any) {
    // Refund first — never swallow it, regardless of error classification.
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    const kind = classifyError(err);
    console.error(`[organic/plan/generate] pipeline threw (${kind}):`, err);
    return NextResponse.json(
      { error: 'נכשל ביצירה — נסה שוב', kind, detail: `${kind}: ${String(err).slice(0, 200)}` },
      { status: 502 },
    );
  }
}
