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

// Owner action → target campaign status. Closed allow-list: no caller-supplied
// status is written verbatim.
const ACTION_STATUS: Record<string, string> = {
  pause: 'paused',
  resume: 'active',
  approve: 'approved',
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const action = body.action ?? '';
    const status = ACTION_STATUS[action];
    if (!status) {
      return NextResponse.json(
        { error: 'Invalid action — expected pause | resume | approve' },
        { status: 400 },
      );
    }

    // Ownership is enforced by the owner_user_id filter (and RLS). No spend,
    // no Meta call — only the status column is touched.
    const { data, error } = await supabase
      .from('campaigns')
      .update({ status })
      .eq('id', params.id)
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
