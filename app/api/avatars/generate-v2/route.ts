/**
 * POST /api/avatars/generate-v2
 *
 * Body: {
 *   briefId:    string,
 *   frameworks?: FrameworkKey[],
 *   userNotes?:  string,
 *   industry?:   string,
 *   productCategory?: string,
 *   brandTone?:  string,
 *   language?:   'he'|'en'
 * }
 *
 * Auth required (gated by middleware — not in publicRoutes whitelist).
 * Deducts CREDIT_COSTS.avatar_v2 (= 20) atomically via deduct_credits RPC.
 * Saves result into briefs.{avatar_v2, avatar_v2_meta, avatar_generated_at}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateAvatarV2 } from '@/lib/avatar/generator';
import type { FrameworkKey } from '@/lib/avatar/frameworks';
import type { BrandDNA, BriefValues } from '@/types';
import { CREDIT_COSTS } from '@/types';

export const runtime     = 'nodejs';
export const maxDuration = 120; // research + 3 LLM passes ≈ 60-90s

interface Body {
  briefId:          string;
  frameworks?:      FrameworkKey[];
  userNotes?:       string;
  industry?:        string;
  productCategory?: string;
  brandTone?:       string;
  language?:        'he' | 'en';
}

export async function POST(req: NextRequest) {
  const supabase = createClient();

  // 1. Auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Body
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.briefId) {
    return NextResponse.json({ error: 'briefId required' }, { status: 400 });
  }

  // 3. Load brief + ownership check (RLS will enforce too, but be explicit)
  const { data: brief, error: briefErr } = await supabase
    .from('briefs')
    .select('id, user_id, values')
    .eq('id', body.briefId)
    .single();

  if (briefErr || !brief) {
    return NextResponse.json({ error: 'brief not found' }, { status: 404 });
  }
  if (brief.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 4. Load brand tone fallback from user profile (best-effort)
  let brandTone = body.brandTone ?? null;
  if (!brandTone) {
    const { data: profile } = await supabase
      .from('users')
      .select('brand')
      .eq('id', user.id)
      .single();
    brandTone = (profile?.brand as BrandDNA | null)?.tone ?? null;
  }

  // 5. Deduct credits BEFORE the expensive LLM run
  const cost = CREDIT_COSTS.avatar_v2;
  const { data: deductResult, error: rpcErr } = await supabase.rpc('deduct_credits', {
    p_user_id: user.id,
    p_action:  'avatar_v2',
    p_cost:    cost,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }
  if (!deductResult?.success) {
    return NextResponse.json(
      { error: 'insufficient_credits', credits: deductResult?.credits ?? 0 },
      { status: 402 },
    );
  }

  // 6. Map brief.values (JSONB, Hebrew keys) → AvatarInput
  const values = (brief.values ?? {}) as BriefValues;
  const userNotes = buildUserNotes(values, body.userNotes);

  // 7. Run the multi-pass generator
  try {
    const result = await generateAvatarV2({
      businessName:    values.biz_name ?? null,
      product:         values.biz_what ?? null,
      industry:        body.industry        ?? null,
      productCategory: body.productCategory ?? body.industry ?? values.biz_what ?? null,
      brandTone,
      region:          'IL',
      language:        body.language ?? 'he',
      userNotes,
      frameworks:      body.frameworks,
    });

    // 8. Persist (use RLS-respecting client — user owns this row)
    await supabase
      .from('briefs')
      .update({
        avatar_v2:           result.avatar,
        avatar_v2_meta:      result.meta,
        avatar_generated_at: new Date().toISOString(),
      })
      .eq('id', body.briefId);

    // 9. Log to generated_content for credit/usage history
    await supabase.from('generated_content').insert({
      user_id:  user.id,
      type:     'avatar_v2',
      platform: null,
      input:    {
        briefId:    body.briefId,
        frameworks: result.meta.frameworks,
        language:   result.meta.language,
      },
      output: {
        avatar_name:       result.avatar.name,
        scores:            result.meta.scores,
        refined:           result.meta.refined,
        research_snippets: result.meta.research_snippet_count,
      },
    });

    return NextResponse.json({
      avatar:  result.avatar,
      meta:    result.meta,
      credits: deductResult.credits,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[avatar-v2]', message);
    // Note: credits already deducted. Surface error; caller decides on refund logic.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Concatenate the brief's free-text values into `userNotes` so the LLM gets
// the rich Hebrew context the client typed in the wizard (pains, dreams,
// objections, awareness level, …) without us having to enumerate fields
// in the prompt builder.
function buildUserNotes(values: BriefValues, extra?: string): string {
  const lines: string[] = [];
  const push = (label: string, val?: string) => {
    if (val && val.trim()) lines.push(`${label}: ${val.trim()}`);
  };

  push('תוצאה שמובטחת',  values.biz_result);
  push('USP',            values.biz_usp);
  push('לקוח טיפוסי',    values.cust_who);
  push('הכנסה',          values.cust_income);
  push('כאב מרכזי',      values.pain_main);
  push('כאב פנימי',      values.pain_internal);
  push('חלום',           values.desire_dream);
  push('התנגדות עיקרית', values.obj_main);
  push('פתרונות שניסה',  values.obj_tried);
  push('פחד',            values.obj_fear);
  push('רמת מודעות',     values.mkt_awareness);

  if (extra && extra.trim()) lines.push(`הערות נוספות: ${extra.trim()}`);

  return lines.join('\n');
}
