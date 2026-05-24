// app/api/brief/[token]/save/route.ts
// POST — autosave the brief. Public; token is auth.
// Called on debounce every ~800ms by the wizard client component.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const TOKEN_REGEX = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD_BYTES = 50_000; // 50 KB is plenty for a brief's worth of text

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  if (!TOKEN_REGEX.test(params.token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  let body: { values?: unknown; current_step?: unknown; progress_pct?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const values = body.values;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return NextResponse.json({ error: 'Invalid values' }, { status: 400 });
  }

  const serialized = JSON.stringify(values);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Sanitize numeric inputs
  const currentStep = clampInt(body.current_step, 1, 5, 1);
  const progressPct = clampInt(body.progress_pct, 0, 100, 0);

  const admin = createAdminClient();

  // Look up the brief to check its current status
  const { data: brief, error: getErr } = await admin
    .from('briefs')
    .select('id, status, expires_at')
    .eq('token', params.token)
    .maybeSingle();

  if (getErr) {
    return NextResponse.json({ error: getErr.message }, { status: 500 });
  }
  if (!brief) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (brief.expires_at && new Date(brief.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Expired' }, { status: 410 });
  }
  if (
    brief.status === 'submitted' ||
    brief.status === 'has_avatar' ||
    brief.status === 'complete'
  ) {
    return NextResponse.json(
      { error: 'Already submitted; cannot edit' },
      { status: 409 }
    );
  }

  // Promote sent/opened → in_progress on first write
  const nextStatus =
    brief.status === 'sent' || brief.status === 'opened'
      ? 'in_progress'
      : brief.status;

  const { error: updErr } = await admin
    .from('briefs')
    .update({
      values,
      current_step: currentStep,
      progress_pct: progressPct,
      status: nextStatus,
    })
    .eq('id', brief.id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(min, n), max);
}
