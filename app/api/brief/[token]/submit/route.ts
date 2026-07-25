// app/api/brief/[token]/submit/route.ts
// POST — finalize a brief. Public; token is auth.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const TOKEN_REGEX = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD_BYTES = 50_000;

const REQUIRED_FIELDS = [
  'biz_name',
  'biz_description',
  'biz_product',
  'ad_language',
  'voice_choice',
  'price',
  'whats_included',
  'usp',
  'pain_main',
  'pain_emotion',
  'dream_outcome',
  'common_objection',
];

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  if (!TOKEN_REGEX.test(params.token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  let body: { values?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const values = body.values;
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return NextResponse.json({ error: 'Invalid values' }, { status: 400 });
  }

  if (JSON.stringify(values).length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Validate required
  const vs = values as Record<string, unknown>;
  const missing = REQUIRED_FIELDS.filter((f) => {
    const v = vs[f];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'Missing required fields', missing },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

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
      { error: 'Already submitted' },
      { status: 409 }
    );
  }

  const { error: updErr } = await admin
    .from('briefs')
    .update({
      values,
      status: 'submitted',
      progress_pct: 100,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', brief.id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
