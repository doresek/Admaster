// lib/autopilot/steps.ts
// Step adapters. Each step CONSUMES an existing capability (a route on this or
// the parallel branch, or an in-process lib fn) — none of them are edited.
// `acc` carries accumulated data across steps (variants → best → token …).

import { randomBytes } from 'crypto';
import { buildAiContext } from '@/lib/ai-context';
import { evaluate } from '@/lib/judge';
import type { StepCtx, StepResult, StepName } from './types';

type Acc = Record<string, any>;

async function callRoute(
  ctx: StepCtx,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  try {
    const res = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.cookieHeader },
      body: JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-json */ }
    return { status: res.status, json };
  } catch (e: any) {
    return { status: 0, json: { error: e?.message ?? 'network_error' } };
  }
}

// ── generate: brief → 3 variants (reuses /api/quick-campaign) ──
async function generate(ctx: StepCtx): Promise<StepResult> {
  const blocks = await buildAiContext(ctx.supabase, {
    userId: ctx.userId,
    clientId: ctx.clientId,
    briefId: ctx.briefId ?? null,
  });
  const brief = (blocks.briefText || blocks.combined || '').trim();
  if (!brief) return { ok: false, error: 'needs_brief' };

  const { status, json } = await callRoute(ctx, '/api/quick-campaign', {
    brief,
    platform: 'Facebook',
    locale: ctx.locale,
  });
  if (status !== 200 || !Array.isArray(json?.variants) || json.variants.length === 0) {
    return { ok: false, error: json?.error || `generate_failed_${status}` };
  }
  return { ok: true, data: { variants: json.variants } };
}

// ── score: score each variant, pick the best (reuses /api/ai/score) ──
async function score(ctx: StepCtx, acc: Acc): Promise<StepResult> {
  const variants: any[] = acc.variants ?? [];
  if (!variants.length) return { ok: false, error: 'no_variants' };

  const scored = await Promise.all(
    variants.map(async (v) => {
      const { status, json } = await callRoute(ctx, '/api/ai/score', {
        copy: v.post,
        channel: 'meta_feed',
        locale: ctx.locale,
        persist: false,
      });
      const s = status === 200 && typeof json?.score === 'number' ? json.score : 0;
      const band = json?.band ?? 'low';
      return { ...v, score: s, band };
    }),
  );

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return { ok: true, data: { scored, best } };
}

// ── judge: 4-dimension verdict on the best variant (in-process) ──
async function judge(ctx: StepCtx, acc: Acc): Promise<StepResult> {
  const best = acc.best;
  if (!best?.post) return { ok: false, error: 'no_best' };

  const verdict = await evaluate(ctx.supabase, {
    artifact: { kind: 'ad_copy', copy: best.post },
    userId: ctx.userId,
    clientId: ctx.clientId,
    briefId: ctx.briefId ?? null,
    practicalScore: typeof best.score === 'number' ? best.score : undefined,
    locale: ctx.locale,
  });

  // reject → stop and ask a human; approve/revise → proceed to the approval gate
  return { ok: verdict.verdict !== 'reject', data: { judge: verdict }, error: verdict.verdict === 'reject' ? 'judge_reject' : undefined };
}

// ── approval: create a pending client approval (reuses /api/approvals) ──
async function approval(ctx: StepCtx, acc: Acc): Promise<StepResult> {
  const best = acc.best;
  if (!best?.post) return { ok: false, error: 'no_best' };

  // Insert directly (the approvals table exists on this branch); mirrors
  // /api/approvals POST so the public /approve/[token] portal works unchanged.
  const token = randomBytes(16).toString('hex');
  const { data, error } = await ctx.supabase
    .from('approvals')
    .insert({
      user_id: ctx.userId,
      client_id: ctx.clientId,
      token,
      title: 'מודעה מ-Autopilot',
      content: {
        post: best.post,
        hashtags: best.hashtags ?? [],
        wa: best.wa ?? '',
        image_prompt: best.image_prompt ?? '',
        framework: best.framework ?? '',
        score: best.score ?? null,
        judge: acc.judge ?? null,
      },
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, gate: true, data: { approvalId: data.id, token } };
}

// ── targeting / launch / insights: post-approval, Meta engine ──
// These routes live on the parallel feat/meta-ads-launcher branch. Until that
// branch merges, they 404 here — we degrade gracefully (skipped, not failed)
// so the foundation is testable end-to-end up to the gate today.
async function targeting(ctx: StepCtx, acc: Acc): Promise<StepResult> {
  const { status, json } = await callRoute(ctx, '/api/meta/targeting', {
    copy: acc.best?.post ?? '',
  });
  if (status === 404 || status === 0) return { ok: true, data: { targeting: 'deferred_until_meta_merge' } };
  if (status !== 200) return { ok: false, error: json?.error || `targeting_failed_${status}` };
  return { ok: true, data: { targeting: json } };
}

async function launch(ctx: StepCtx, acc: Acc): Promise<StepResult> {
  const { status, json } = await callRoute(ctx, '/api/meta/launch', {
    approvalId: acc.approvalId,
    targeting: acc.targeting,
  });
  if (status === 404 || status === 0) return { ok: true, data: { launch: 'deferred_until_meta_merge' } };
  if (status !== 200) return { ok: false, error: json?.error || `launch_failed_${status}` };
  return { ok: true, data: { launch: json, launchedAdId: json?.launched_ad_id ?? json?.ad_id ?? null } };
}

async function insights(ctx: StepCtx, acc: Acc): Promise<StepResult> {
  if (!acc.launchedAdId) return { ok: true, data: { insights: 'no_live_ad_yet' } };
  const { status, json } = await callRoute(ctx, '/api/meta/ad-insights', {
    launched_ad_id: acc.launchedAdId,
    analyze: true,
  });
  if (status === 404 || status === 0) return { ok: true, data: { insights: 'deferred_until_meta_merge' } };
  if (status !== 200) return { ok: false, error: json?.error || `insights_failed_${status}` };
  return { ok: true, data: { insights: json } };
}

export const STEP_FNS: Record<StepName, (ctx: StepCtx, acc: Acc) => Promise<StepResult>> = {
  generate,
  score,
  judge,
  approval,
  targeting,
  launch,
  insights,
  recommend: async () => ({ ok: true }), // recommendations are surfaced in the UI, not a blocking step
};
