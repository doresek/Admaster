// app/api/retention/enroll/route.ts
//
// POST { series_id, client_id } — series ACTIVATION (owner-authed).
//
// Activation is the Mode-2 approval granularity (RETENTION-ENGINE-DESIGN.md §5):
// the owner's explicit tap on "הפעל סדרה" is the approval. This route:
//   1. verifies the series belongs to the caller AND to the given client;
//   2. selects the ELIGIBLE contacts — consented (structural), NOT opted out
//      (tombstone), matching the series' audience_tags ('{}' = all);
//   3. INSERTs series_enrollments rows (ON CONFLICT DO NOTHING — re-activation
//      never duplicates and never resurrects an opted_out/stopped enrollment);
//   4. stamps message_series.status='active' + activated_at.
//
// NOTHING SENDS HERE. Sending is exclusively the daily retention tick's job
// (lib/retention/sender behind the compliance gate) — this route never touches
// a provider and never imports the sender.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isEligibleForEnrollment, type AudienceContact } from './eligibility';

export const dynamic = 'force-dynamic';

interface EligibleRow extends AudienceContact {
  id: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const seriesId = typeof body.series_id === 'string' ? body.series_id.trim() : '';
  const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
  if (!seriesId || !clientId) {
    return NextResponse.json({ error: 'series_id and client_id are required' }, { status: 400 });
  }

  // 1) The series must be the caller's AND scoped to this client (RLS backs this up).
  const { data: series, error: seriesErr } = await supabase
    .from('message_series')
    .select('id, user_id, client_id, status, audience_tags, activated_at, name')
    .eq('id', seriesId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (seriesErr) return NextResponse.json({ error: seriesErr.message }, { status: 500 });
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });
  if (series.client_id !== clientId) {
    return NextResponse.json({ error: 'Series does not belong to this client' }, { status: 400 });
  }

  const audienceTags: string[] = Array.isArray(series.audience_tags) ? series.audience_tags : [];

  // 2) Eligible contacts: active (no tombstone) + consented + audience match.
  //    The DB query already excludes tombstones; the helper re-checks everything
  //    so eligibility has exactly ONE definition (shared with the UI preview).
  let contactsQuery = supabase
    .from('client_contacts')
    .select('id, tags, consented_at, opted_out_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id)
    .is('opted_out_at', null);
  if (audienceTags.length > 0) contactsQuery = contactsQuery.overlaps('tags', audienceTags);

  const { data: contactRows, error: contactsErr } = await contactsQuery;
  if (contactsErr) return NextResponse.json({ error: contactsErr.message }, { status: 500 });

  const eligible = ((contactRows ?? []) as EligibleRow[])
    .filter((c) => isEligibleForEnrollment(c, audienceTags));

  // 3) Enroll — ON CONFLICT (series_id, contact_id) DO NOTHING: an existing
  //    enrollment (active / completed / stopped / opted_out) is NEVER touched,
  //    so re-activation cannot resurrect an opt-out.
  let enrolled = 0;
  if (eligible.length > 0) {
    const payload = eligible.map((c) => ({
      series_id: seriesId,
      contact_id: c.id,
      client_id: clientId,
      owner_user_id: user.id,
    }));
    const { data: inserted, error: enrollErr } = await supabase
      .from('series_enrollments')
      .upsert(payload, { onConflict: 'series_id,contact_id', ignoreDuplicates: true })
      .select('id');
    if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 500 });
    enrolled = (inserted ?? []).length;
  }

  // 4) Activate. activated_at is first-write-wins (re-activation keeps the
  //    original approval timestamp).
  const activatedAt = (series.activated_at as string | null) ?? new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('message_series')
    .update({ status: 'active', activated_at: activatedAt })
    .eq('id', seriesId)
    .eq('user_id', user.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({
    activated: true,
    series_id: seriesId,
    activated_at: activatedAt,
    eligible: eligible.length,
    enrolled,                                   // newly enrolled this call
    already_enrolled: eligible.length - enrolled,
    // Honesty (doc §5): activation ENROLLS only — actual sending runs via the
    // daily retention tick behind the compliance gate; nothing was sent now.
    note: 'enrollment only — sending happens via the daily retention tick, never on activation',
  });
}
