// app/api/whatsapp/send/route.ts
//
// POST — send one insight-grounded WhatsApp message via InforU (mock by default).
// Authed (owner-scoped). Body:
//   { clientId, toPhone, body, templateName?, campaignId?, artifactId?, grounded_in? }
// The message is recorded in `whatsapp_messages` stamped with the caller as owner
// and the `grounded_in` insight atoms that justified the send.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendWhatsApp } from '@/lib/whatsapp';

interface SendBody {
  clientId?: string;
  toPhone?: string;
  body?: string;
  templateName?: string | null;
  campaignId?: string | null;
  artifactId?: string | null;
  grounded_in?: string[];
}

export async function POST(req: NextRequest) {
  // ── auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── input validation ─────────────────────────────────────────────────────────
  let payload: SendBody;
  try {
    payload = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const clientId = payload.clientId?.trim();
  const toPhone = payload.toPhone?.trim();
  const body = payload.body?.trim();

  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  if (!toPhone)  return NextResponse.json({ error: 'toPhone is required' }, { status: 400 });
  if (!body)     return NextResponse.json({ error: 'body is required' }, { status: 400 });

  const groundedIn = Array.isArray(payload.grounded_in)
    ? payload.grounded_in.filter((x): x is string => typeof x === 'string')
    : [];

  // ── send + record (mock provider by default) ──────────────────────────────────
  const result = await sendWhatsApp({
    clientId,
    ownerUserId: user.id,
    toPhone,
    body,
    templateName: payload.templateName ?? null,
    campaignId: payload.campaignId ?? null,
    artifactId: payload.artifactId ?? null,
    groundedIn,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
