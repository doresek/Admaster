// ════════════════════════════════════════════
// POST /api/ai/master/batch — "צור לי X פוסטים" (CP-3).
//
// Runs `count` FULL best-of-N master pipelines in parallel (no quality
// shortcuts), varying type+hook per run so the batch reads like a varied week
// of content. Each successful run persists its own generated_content row the
// moment it completes (via the shared runAndPersistMaster) — that is what makes
// the create page's progressive "x/y מוכנים" polling work.
//
// Credits: count × master_post deducted UP FRONT; one unit refunded per failed
// run (a wholly-failed batch refunds everything). Never double-charges, never
// swallows a refund.
// ════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, type DeductResult } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';
import { type StageRunner } from '@/lib/master-studio/pipeline';
import { withRetry, classifyError } from '@/lib/master-studio/retry';
import { MASTER_NOTES_MAX, type MasterStudioInput } from '@/lib/master-studio';
import { runAndPersistMaster } from '@/lib/generation-queue/run-master';
import { BATCH_MIN, BATCH_MAX, isValidBatchCount, planBatchVariations, settleBatch } from '@/lib/generation-queue/batch';

// A batch runs up to 5 best-of-N pipelines in parallel; each pipeline is 5-6
// sequential Anthropic calls. Same Fluid Compute budget as the single route.
export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Separate, tighter limit than the single route: a batch is up to 5 full
  // best-of-N pipelines, so 2 batches / minute / user.
  const rl = checkRateLimit(`master-batch:${user.id}`, { max: 2, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = await req.json();
  const { count, brief, masterNotes, platform, tone, type, locale, client_id, brief_id } = body as
    Partial<MasterStudioInput> & { count?: number; client_id?: string | null; brief_id?: string | null };

  if (!isValidBatchCount(count)) {
    return NextResponse.json({ error: `מספר פוסטים חייב להיות בין ${BATCH_MIN} ל-${BATCH_MAX}` }, { status: 400 });
  }
  if (!platform) {
    return NextResponse.json({ error: 'Missing field: platform' }, { status: 400 });
  }

  // Client context — exactly like the single route: a typed short brief OR the
  // active client's existing brief/brain. Reject only when there's NEITHER.
  const activeClientId = client_id ?? readActiveClientCookie(req.headers.get('cookie') ?? '');
  const hasClientContext = Boolean(brief_id || activeClientId);
  if (!brief?.trim() && !hasClientContext) {
    return NextResponse.json({ error: 'הזן בריף קצר או בחר לקוח פעיל שיש לו בריף' }, { status: 400 });
  }
  const ctx = await buildAiContext(supabase, {
    userId:   user.id,
    clientId: activeClientId,
    briefId:  brief_id ?? null,
  });
  const ctxPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

  // ── Deduct count × master_post UP FRONT. A failed deduction midway rolls the
  //    already-taken units back before rejecting — never a partial charge.
  const deducts: Extract<DeductResult, { ok: true }>[] = [];
  for (let i = 0; i < count; i++) {
    const d = await deductCredits(supabase, user.id, 'master_post');
    if (!d.ok) {
      for (const taken of deducts) await refundCredits(supabase, user.id, 'master_post', taken.cost);
      return NextResponse.json(
        { error: d.error, credits: d.credits ?? 0, requested: count },
        { status: d.status }
      );
    }
    deducts.push(d);
  }
  const unitCost = deducts[0].cost;
  const creditsAfterDeduct = deducts[deducts.length - 1].credits;

  // Same Anthropic-backed stage runner as the single route: brand context
  // prepended to each stage's system prompt, one retry on transient errors.
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

  const effectiveBrief = brief?.trim()
    ? brief
    : 'צור פוסט שיווקי מקצועי ללקוח הפעיל, מבוסס על הבריף, ה-Brand DNA והתובנות שלו.';

  // ── Run `count` full pipelines in parallel, each with a rotated type+hook so
  //    the batch is a varied week's content, not clones. Every successful run
  //    inserts its generated_content row on its OWN completion inside
  //    runAndPersistMaster — progressive results, no extra job infra.
  const variations = planBatchVariations(count, { type });
  const env = {
    supabase,
    createAdmin:    createAdminClient,
    runStage:       run,
    userId:         user.id,
    activeClientId: activeClientId ?? null,
    ctx,
    model: MODEL,
  };
  const settled = await Promise.allSettled(variations.map((v) => {
    const input: MasterStudioInput = {
      brief: effectiveBrief,
      masterNotes: masterNotes?.slice(0, MASTER_NOTES_MAX),
      platform,
      tone,
      type: v.type,
      hook: v.hook,
      locale,
    };
    return runAndPersistMaster(input, env);
  }));

  const okFlags = settled.map(s => s.status === 'fulfilled' && s.value.ok);
  settled.forEach((s, i) => {
    if (okFlags[i]) return;
    const why = s.status === 'rejected'
      ? `rejected: ${String(s.reason).slice(0, 200)}`
      : s.value.ok ? '' : s.value.kind === 'thrown'
        ? `${classifyError(s.value.error)}: ${String(s.value.error).slice(0, 200)}`
        : `partial: ${s.value.reason}`;
    console.error(`[master batch] run ${i + 1}/${count} failed (${why})`);
  });

  // ── Refund one unit per failed run (never swallowed — refundCredits logs its
  //    own failures and the math below reports what SHOULD have been refunded).
  const { succeeded, failed, refunded, credits } = settleBatch({ okFlags, unitCost, creditsAfterDeduct });
  for (let i = 0; i < failed; i++) {
    await refundCredits(supabase, user.id, 'master_post', unitCost);
  }

  const summary = { ok: succeeded > 0, requested: count, succeeded, failed, refunded, credits };
  if (succeeded === 0) {
    return NextResponse.json({ ...summary, error: 'נכשל ביצירת החבילה — הקרדיטים הוחזרו, נסה שוב' }, { status: 502 });
  }
  return NextResponse.json(summary);
}
