// PATCH /api/command-center/campaigns/[id]  (AUTHENTICATED owner)
//
// The ONLY write in the Command Center: an owner-driven status change —
// pause / resume / approve. It updates `campaigns.status` and NOTHING else.
//
// DRY-RUN SAFE BY DESIGN: this handler never calls Meta/Graph and never starts
// or changes live spend. It only flips a status column; whether a campaign
// actually spends is governed elsewhere by `dry_run`. Approving a dry-run
// campaign keeps it a dry-run campaign.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMissingRelation } from '../../shared';
import { canTransition } from '@/lib/campaigns/state';
import type { CampaignStatus } from '@/lib/campaigns/types';

// Owner action → target campaign status. Closed allow-list, and every target is
// a REAL lifecycle status from the campaigns.status CHECK (see migration 030 /
// lib/campaigns/state.ts) — the previous 'active'/'approved' values are NOT in
// that constraint and made resume/approve fail with a DB error. We also validate
// the transition against the state machine, so an illegal move (e.g. approve a
// live campaign) returns a clear 409 instead of a constraint violation.
//   • pause   live      → paused
//   • resume  paused    → live
//   • approve assembled → scheduled  (owner greenlights the dry-run campaign;
//                                     publishing stays a separate, gated action)
const ACTION_STATUS: Record<string, CampaignStatus> = {
  pause: 'paused',
  resume: 'live',
  approve: 'scheduled',
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params; // Next 15: route params are async
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = body.action ?? '';
    const target = ACTION_STATUS[action];
    if (!target) {
      return NextResponse.json(
        { error: 'Invalid action — expected pause | resume | approve' },
        { status: 400 },
      );
    }

    // Load the current status first so we can validate the transition against the
    // state machine (the single source of truth) BEFORE writing — an illegal move
    // is a clean 409, never a DB constraint violation.
    const { data: current, error: readErr } = await supabase
      .from('campaigns')
      .select('id, status')
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .single();

    if (readErr) {
      if (isMissingRelation(readErr) || (readErr as { code?: string }).code === 'PGRST116') {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      }
      throw readErr;
    }
    if (!current) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    const from = current.status as CampaignStatus;
    if (!canTransition(from, target)) {
      return NextResponse.json(
        { error: `לא ניתן ל${action === 'pause' ? 'השהות' : action === 'resume' ? 'הפעיל' : 'אשר'} קמפיין במצב "${from}"`, from, to: target },
        { status: 409 },
      );
    }

    // Ownership is enforced by the owner_user_id filter (and RLS). No spend,
    // no Meta call, dry_run untouched — only the status column is touched.
    const { data, error } = await supabase
      .from('campaigns')
      .update({ status: target })
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .select('id, status, dry_run')
      .single();

    if (error) {
      if (isMissingRelation(error)) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      }
      // PostgREST returns PGRST116 when .single() matches no row.
      if ((error as { code?: string }).code === 'PGRST116') {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      }
      throw error;
    }
    if (!data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

    return NextResponse.json({ id: data.id, status: data.status, dry_run: data.dry_run ?? true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
