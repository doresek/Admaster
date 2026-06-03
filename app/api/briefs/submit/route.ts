import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { briefCompletion } from '@/lib/briefing-template';
import type { BriefValues } from '@/types';

// POST /api/briefs/submit
// Public (no auth). Accepts EITHER:
//   { code, values }   — legacy single-submit path (insert a new brief)
//   { token, values }  — autosave-friendly per-client token path (upsert)
export async function POST(req: NextRequest) {
  try {
    // Public endpoint → rate-limit by IP.
    // Autosave hits this often, so allow a generous burst.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const rl = checkRateLimit(`brief-submit:${ip}`, { max: 120, windowMs: 60 * 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'יותר מדי שליחות — נסה שוב מאוחר יותר', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }

    const body = await req.json() as { code?: string; token?: string; values: BriefValues };
    const { code, token, values } = body;

    if (!values || (!code && !token)) {
      return NextResponse.json({ error: 'Missing token/code or values' }, { status: 400 });
    }

    const admin = createAdminClient();

    // ── Token path (per-client, autosave/upsert) ──────────────────
    if (token) {
      const { data: briefCode, error: codeErr } = await admin
        .from('brief_codes')
        .select('code, user_id, client_id, expires_at')
        .eq('token', token)
        .maybeSingle();

      if (codeErr || !briefCode) {
        return NextResponse.json({ error: 'קוד בריף לא קיים' }, { status: 404 });
      }

      if (briefCode.expires_at && new Date(briefCode.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: 'הקישור פג תוקף' }, { status: 410 });
      }

      const completion = briefCompletion(values as Record<string, unknown>);
      const status     = completion >= 100 ? 'complete' : 'new';

      // Find an existing brief for this client (or by code) to update in place.
      let existing: { id: string } | null = null;
      if (briefCode.client_id) {
        const { data } = await admin
          .from('briefs')
          .select('id')
          .eq('client_id', briefCode.client_id)
          .maybeSingle();
        existing = data ?? null;
      }
      if (!existing) {
        const { data } = await admin
          .from('briefs')
          .select('id')
          .eq('code', briefCode.code)
          .maybeSingle();
        existing = data ?? null;
      }

      if (existing) {
        const { error } = await admin
          .from('briefs')
          .update({ values, status, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await admin
          .from('briefs')
          .insert({
            code:      briefCode.code,
            user_id:   briefCode.user_id,
            client_id: briefCode.client_id,
            values,
            status,
          });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, completion });
    }

    // ── Legacy code path (unchanged behavior: single insert) ──────
    const { data: briefCode, error: codeErr } = await admin
      .from('brief_codes')
      .select('user_id')
      .eq('code', code!.toUpperCase())
      .single();

    if (codeErr || !briefCode) {
      return NextResponse.json({ error: 'קוד בריף לא קיים' }, { status: 404 });
    }

    const { data, error } = await admin
      .from('briefs')
      .insert({
        code:    code!.toUpperCase(),
        user_id: briefCode.user_id,
        values,
        status:  'new',
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, id: data.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
