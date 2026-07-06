// app/api/retention/contacts/route.ts
//
// Owner-authed CRUD for `client_contacts` (migration 052; RLS owner-only).
//
//   GET    ?client_id=…            — client-scoped contact list
//   POST   { client_id, contact }  — one contact; consent fields REQUIRED
//   POST   { client_id, rows, defaults? } — bulk import (JSON rows array)
//   POST   multipart/form-data     — CSV import (file field "file" +
//                                    client_id; optional consent_source /
//                                    consented_at / consent_evidence fields
//                                    as a bulk attestation merged under rows)
//   DELETE { contact_id | id }     — OPT-OUT, never a hard delete: sets the
//                                    opted_out_at tombstone + stops active
//                                    enrollments. Idempotent.
//
// Import dedup: phone/email per client. A key that hits an OPTED-OUT contact
// is skipped-not-resurrected (the tombstone rule) — per-row results returned.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  normalizeContactInput,
  parseCsv,
  planImport,
  type ExistingContactKey,
  type RawContactInput,
} from '@/lib/retention/contacts';

export const dynamic = 'force-dynamic';

type Authed = { supabase: Awaited<ReturnType<typeof createClient>>; userId: string };

async function requireUser(): Promise<Authed | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { supabase, userId: user.id };
}

/** The client must exist AND belong to the caller (RLS backs this up). */
async function assertOwnClient(auth: Authed, clientId: string): Promise<boolean> {
  const { data } = await auth.supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('owner_user_id', auth.userId)
    .maybeSingle();
  return Boolean(data);
}

// ── GET — client-scoped list ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const clientId = req.nextUrl.searchParams.get('client_id')?.trim();
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  if (!(await assertOwnClient(auth, clientId))) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const includeOptedOut = req.nextUrl.searchParams.get('include_opted_out') === 'true';
  let query = auth.supabase
    .from('client_contacts')
    .select('id, client_id, full_name, phone, email, tags, consent_source, consented_at, consent_evidence, opted_out_at, opt_out_channel, opt_out_reason, channel_prefs, last_purchase_at, last_contact_at, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (!includeOptedOut) query = query.is('opted_out_at', null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: data ?? [] });
}

// ── POST — single contact OR bulk import (JSON rows / CSV multipart) ─────────

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const contentType = req.headers.get('content-type') ?? '';

  let clientId: string | undefined;
  let rows: RawContactInput[] | null = null;
  let single: RawContactInput | null = null;
  let defaults: RawContactInput = {};

  if (contentType.includes('multipart/form-data')) {
    // CSV import
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
    }
    clientId = String(form.get('client_id') ?? '').trim() || undefined;
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'CSV file field "file" is required' }, { status: 400 });
    }
    rows = parseCsv(await file.text());
    // Bulk consent attestation (merged UNDER each row; rows still must end up
    // with consent_source + consented_at or they are rejected per-row).
    for (const key of ['consent_source', 'consented_at', 'consent_evidence'] as const) {
      const v = form.get(key);
      if (typeof v === 'string' && v.trim()) defaults[key] = v.trim();
    }
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    clientId = typeof body.client_id === 'string' ? body.client_id.trim() : undefined;
    if (Array.isArray(body.rows)) {
      rows = body.rows.filter((r): r is RawContactInput => typeof r === 'object' && r !== null);
      if (typeof body.defaults === 'object' && body.defaults !== null) {
        defaults = body.defaults as RawContactInput;
      }
    } else if (typeof body.contact === 'object' && body.contact !== null) {
      single = body.contact as RawContactInput;
    } else {
      // Bare object = the contact itself (convenience)
      const { client_id: _omit, ...rest } = body;
      single = rest as RawContactInput;
    }
  }

  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  if (!(await assertOwnClient(auth, clientId))) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // Existing keys for dedup + the tombstone rule (opted-out included ON PURPOSE)
  const { data: existingData, error: existingErr } = await auth.supabase
    .from('client_contacts')
    .select('id, phone, email, opted_out_at')
    .eq('client_id', clientId);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  const existing = (existingData ?? []) as ExistingContactKey[];

  // ── single contact ───────────────────────────────────────────────────────────
  if (single) {
    const norm = normalizeContactInput(single);
    if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });
    const c = norm.contact;
    const hit = existing.find(
      (e) => (c.phone && e.phone === c.phone) || (c.email && e.email?.toLowerCase() === c.email),
    );
    if (hit?.opted_out_at) {
      return NextResponse.json(
        { error: 'Contact previously opted out — not resurrected', existing_id: hit.id },
        { status: 409 },
      );
    }
    if (hit) {
      return NextResponse.json(
        { error: 'Duplicate contact (phone/email already exists for this client)', existing_id: hit.id },
        { status: 409 },
      );
    }
    const { data, error } = await auth.supabase
      .from('client_contacts')
      .insert({ ...c, client_id: clientId, owner_user_id: auth.userId })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
  }

  // ── bulk import ──────────────────────────────────────────────────────────────
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
  }
  if (rows.length > 2000) {
    return NextResponse.json({ error: 'Import limited to 2000 rows per request' }, { status: 400 });
  }

  const plan = planImport(rows, existing, defaults);
  const results = [...plan.map((r) => ({ ...r }))];

  const inserts = plan.filter((r) => r.action === 'insert' && r.contact);
  if (inserts.length > 0) {
    const payload = inserts.map((r) => ({
      ...r.contact!,
      client_id: clientId,
      owner_user_id: auth.userId,
    }));
    const { data, error } = await auth.supabase
      .from('client_contacts')
      .insert(payload)
      .select('id');
    if (error) {
      // Batch insert failed — report every planned insert as errored, nothing partial hidden.
      for (const r of results) {
        if (r.action === 'insert') { r.action = 'rejected'; r.error = error.message; delete r.contact; }
      }
    } else {
      const ids = (data ?? []) as Array<{ id: string }>;
      let i = 0;
      for (const r of results) {
        if (r.action === 'insert') { r.existingId = ids[i]?.id; delete r.contact; i++; }
      }
    }
  }

  const summary = {
    total: results.length,
    inserted: results.filter((r) => r.action === 'insert').length,
    skipped_duplicate: results.filter((r) => r.action === 'skipped_duplicate').length,
    skipped_opted_out: results.filter((r) => r.action === 'skipped_opted_out').length,
    rejected: results.filter((r) => r.action === 'rejected').length,
  };
  return NextResponse.json({ summary, results }, { status: 200 });
}

// ── DELETE — opt-out (tombstone), never a hard delete ────────────────────────

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  let contactId: string | undefined;
  let reason: string | undefined;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    contactId = typeof body.contact_id === 'string' ? body.contact_id
      : typeof body.id === 'string' ? body.id : undefined;
    reason = typeof body.reason === 'string' ? body.reason : undefined;
  } catch {
    contactId = req.nextUrl.searchParams.get('contact_id')
      ?? req.nextUrl.searchParams.get('id') ?? undefined;
  }
  if (!contactId) return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });

  const nowISO = new Date().toISOString();
  // RLS scopes to the owner. opted_out_at is FIRST-WRITE-WINS (idempotent):
  // an existing tombstone is never overwritten.
  const { data: existing, error: readErr } = await auth.supabase
    .from('client_contacts')
    .select('id, opted_out_at')
    .eq('id', contactId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  if (!(existing as { opted_out_at: string | null }).opted_out_at) {
    const { error } = await auth.supabase
      .from('client_contacts')
      .update({
        opted_out_at: nowISO,
        opt_out_channel: 'manual',
        opt_out_reason: reason ?? 'owner-initiated opt-out (DELETE /api/retention/contacts)',
        updated_at: nowISO,
      })
      .eq('id', contactId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Stop any live enrollments — an opted-out contact rides no series.
  const { error: enrollErr } = await auth.supabase
    .from('series_enrollments')
    .update({ status: 'opted_out', updated_at: nowISO })
    .eq('contact_id', contactId)
    .eq('status', 'active');
  if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 500 });

  return NextResponse.json({ opted_out: true, contact_id: contactId });
}
