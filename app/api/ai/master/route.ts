import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';
import { type StageRunner } from '@/lib/master-studio/pipeline';
import { withRetry, classifyError } from '@/lib/master-studio/retry';
import { type MasterStudioInput } from '@/lib/master-studio';
import { runAndPersistMaster } from '@/lib/generation-queue/run-master';

// Best-of-N runs 5-6 sequential Anthropic calls; the default 10s/60s function
// budget is not enough. Vercel Fluid Compute allows up to 300s on Node.
export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: best-of-N is expensive — 10 master calls / minute / user.
  const rl = checkRateLimit(`master:${user.id}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = await req.json();
  const { brief, masterNotes, platform, tone, type, framework, hook, locale, client_id, brief_id } = body as
    MasterStudioInput & { client_id?: string | null; brief_id?: string | null };

  if (!platform) {
    return NextResponse.json({ error: 'Missing field: platform' }, { status: 400 });
  }

  // Brand DNA + active client + brief context (prepended to every stage system prompt).
  const activeClientId = client_id ?? readActiveClientCookie(req.headers.get('cookie') ?? '');

  // Generate from EITHER a typed short brief OR the active client's existing brief/brain.
  // Only reject when there's NEITHER — with a clear message, never a silent failure.
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

  // Deduct 6 credits once, up front.
  const deduct = await deductCredits(supabase, user.id, 'master_post');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  // Anthropic-backed stage runner. Brand context is prepended to each stage's system prompt.
  // Wrapped in withRetry: each stage retries ONCE on a transient provider error
  // (429 / 5xx / network) with a short backoff before giving up.
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

  // With no typed brief, the active client's brief/brain (in ctx) is the grounding —
  // give master-studio an explicit directive to work from it.
  const effectiveBrief = brief?.trim()
    ? brief
    : 'צור פוסט שיווקי מקצועי ללקוח הפעיל, מבוסס על הבריף, ה-Brand DNA והתובנות שלו.';
  const input: MasterStudioInput = { brief: effectiveBrief, masterNotes, platform, tone, type, framework, hook, locale };

  // Run + persist (artifact tagging and the generated_content history row) via
  // the shared runner also used by the batch route. Persistence details —
  // framework/hook/funnel tagging, insight ids, artifact_id riding in the jsonb
  // output — live in lib/generation-queue/run-master.ts.
  const outcome = await runAndPersistMaster(input, {
    supabase,
    createAdmin:    createAdminClient,
    runStage:       run,
    userId:         user.id,
    activeClientId: activeClientId ?? null,
    ctx,
    model: MODEL,
  });

  if (!outcome.ok && outcome.kind === 'thrown') {
    // Refund first — never swallow it, regardless of how we classify the error.
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    const kind = classifyError(outcome.error);
    console.error(`[master route] pipeline failed (${kind}):`, outcome.error);
    return NextResponse.json(
      { error: 'נכשל ביצירה — נסה שוב', kind, detail: `${kind}: ${String(outcome.error).slice(0, 200)}` },
      { status: 502 }
    );
  }

  if (!outcome.ok) {
    await refundCredits(supabase, user.id, 'master_post', deduct.cost);
    return NextResponse.json({ error: 'תוצאה חלקית — נסה שוב', reason: outcome.reason }, { status: 502 });
  }

  return NextResponse.json({ ...outcome.output, credits: deduct.credits, artifact_id: outcome.artifactId });
}

// ── Read-back: the last 10 master posts for the caller (optionally per client). ──
// The create page uses this to show "יצירות אחרונות" and to restore a generation
// after navigation (the client only held the result in useState).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  let q = supabase
    .from('generated_content')
    .select('id, client_id, platform, input, output, created_at')
    .eq('user_id', user.id)
    .eq('type', 'master_post')
    .order('created_at', { ascending: false })
    .limit(10);
  if (clientId) q = q.eq('client_id', clientId);

  const { data, error } = await q;
  if (error) {
    console.error('[master route] read-back failed:', error.message);
    return NextResponse.json({ error: 'שגיאה בטעינת ההיסטוריה' }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}
