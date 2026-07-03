// app/api/autonomy/approve/route.ts
//
//   POST /api/autonomy/approve   { clientId, eventId?, approved } — record the
//   owner's one-tap decision on a proposed action. Bumps the trust counters
//   (approvals_total / approvals_approved) and appends the 'action_approved' /
//   'action_rejected' audit event; this tap IS the trust metric the
//   mode-switch suggestion is computed from (VISION-DEEP §1.4, D1).

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { recordApprovalOutcome } from '@/lib/autonomy';
import { requireOwnedClient } from '../require-owned-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body: Record<string, unknown> = await req.json();
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const check = await requireOwnedClient(clientId);
    if (!check.ok) return check.response;

    if (typeof body.approved !== 'boolean') {
      return NextResponse.json({ error: 'approved must be a boolean' }, { status: 400 });
    }
    if (body.eventId !== undefined && typeof body.eventId !== 'string') {
      return NextResponse.json({ error: 'eventId must be a string when provided' }, { status: 400 });
    }

    const row = await recordApprovalOutcome(createAdminClient(), {
      clientId:    check.ctx.clientId,
      ownerUserId: check.ctx.userId,
      approved:    body.approved,
      ref:         body.eventId,
    });
    return NextResponse.json({
      approvals_total:    row.approvals_total,
      approvals_approved: row.approvals_approved,
      approval_rate:      row.approvals_total > 0
        ? row.approvals_approved / row.approvals_total
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
