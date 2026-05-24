// app/api/briefs/create-tokenized/route.ts
// POST — authenticated agency creates a tokenized brief and gets a URL to send to their client.
// This is the entry point for the NEW brief flow (alongside the legacy /api/briefs/code).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

const TOKEN_BYTES = 32; // → 64 hex chars
const DEFAULT_EXPIRY_DAYS = 30;

export async function POST(req: NextRequest) {
  // ---- auth: must be a logged-in agency user ----
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---- parse body (all fields optional) ----
  const body = (await req.json().catch(() => ({}))) as {
    client_name?: string;
    client_email?: string;
    client_phone?: string;
    expires_in_days?: number;
  };

  const clientName = trimOrNull(body.client_name);
  const clientEmail = trimOrNull(body.client_email);
  const clientPhone = trimOrNull(body.client_phone);

  const expiresInDays =
    typeof body.expires_in_days === 'number' &&
    body.expires_in_days > 0 &&
    body.expires_in_days <= 365
      ? body.expires_in_days
      : DEFAULT_EXPIRY_DAYS;

  // ---- generate token ----
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  ).toISOString();

  // ---- insert brief row (admin client because we set user_id explicitly) ----
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('briefs')
    .insert({
      user_id: user.id,
      token,
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clientPhone,
      status: 'sent',
      current_step: 1,
      progress_pct: 0,
      template_key: 'universal',
      expires_at: expiresAt,
      values: {},
    })
    .select('id, token, expires_at, client_name')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ---- build the shareable URL ----
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    req.nextUrl.origin;
  const url = `${base}/brief/${data.token}`;

  // ---- optional: prebuilt WhatsApp link if we have a phone ----
  let whatsapp_url: string | null = null;
  if (clientPhone) {
    const normalizedPhone = clientPhone.replace(/[^\d]/g, '').replace(/^0/, '972');
    const msg = encodeURIComponent(
      `שלום${clientName ? ' ' + clientName : ''}! בשביל שאוכל לייצר עבורך מודעות שעובדות, אשמח שתמלא את הבריף הקצר הזה (כ-10 דקות):\n\n${url}`
    );
    whatsapp_url = `https://wa.me/${normalizedPhone}?text=${msg}`;
  }

  return NextResponse.json({
    id: data.id,
    token: data.token,
    url,
    whatsapp_url,
    expires_at: data.expires_at,
    client_name: data.client_name,
  });
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
