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
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

    const body = await req.json() as { code?: string; token?: string; values: BriefValues };
    const { values } = body;
    // Treat empty strings as absent.
    const token = body.token?.trim() || '';
    const code  = body.code?.trim()  || '';

    // Require a non-empty token OR code up front (don't fall through to a 500).
    if (!token && !code) {
      return NextResponse.json({ error: 'Missing token or code' }, { status: 400 });
    }
    if (!values) {
      return NextResponse.json({ error: 'Missing values' }, { status: 400 });
    }

    // Split rate limits: the token autosave path is generous; the legacy code
    // path (no expiry → brute-force surface) is gated tightly. Distinct keys.
    const rl = token
      ? checkRateLimit(`brief-token:${ip}`, { max: 120, windowMs: 60 * 60_000 })
      : checkRateLimit(`brief-code:${ip}`,  { max: 15,  windowMs: 60 * 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'יותר מדי שליחות — נסה שוב מאוחר יותר', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
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

      if (briefCode.client_id) {
        // Per-client row: read current status once (never downgrade) then do a
        // single race-safe upsert keyed by client_id (autosave is concurrent).
        const { data: existingBrief } = await admin
          .from('briefs')
          .select('status')
          .eq('client_id', briefCode.client_id)
          .maybeSingle();
        const prev = existingBrief?.status as string | undefined;
        const status =
          completion >= 100       ? 'complete'
          : prev === 'complete'   ? 'complete'
          : prev === 'has_avatar' ? 'has_avatar'
          :                         'new';

        const { error } = await admin
          .from('briefs')
          .upsert(
            {
              client_id:  briefCode.client_id,
              values,
              status,
              updated_at: new Date().toISOString(),
              code:       briefCode.code,
              user_id:    briefCode.user_id,
            },
            { onConflict: 'client_id' }
          );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ ok: true, completion });
      }

      // Legacy code-only token (no client_id): fall back to find-by-code.
      const { data: existing } = await admin
        .from('briefs')
        .select('id, status')
        .eq('code', briefCode.code)
        .maybeSingle();
      const prev = existing?.status as string | undefined;
      const status =
        completion >= 100       ? 'complete'
        : prev === 'complete'   ? 'complete'
        : prev === 'has_avatar' ? 'has_avatar'
        :                         'new';

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
            code:    briefCode.code,
            user_id: briefCode.user_id,
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
