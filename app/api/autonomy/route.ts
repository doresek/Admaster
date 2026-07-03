// app/api/autonomy/route.ts
//
//   GET  /api/autonomy?clientId=   the client's autonomy state: mode, caps,
//                                  approval stats, today's action count, and
//                                  the mode-switch suggestion (earned + visible).
//   POST /api/autonomy             { clientId, mode, reason? } — the owner
//                                  picks the mode (D1: the OWNER chooses; the
//                                  system only ever suggests).
//
// Authed + owner-scoped (see require-owned-client.ts). First touch creates the
// row in 'propose_approve', the default mode.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  assessModeSuggestion,
  countTodayActions,
  getOrCreateAutonomy,
  setMode,
  type AutonomyMode,
} from '@/lib/autonomy';
import { requireOwnedClient } from './require-owned-client';

export const runtime = 'nodejs';

const MODES: readonly AutonomyMode[] = ['draft_only', 'propose_approve', 'act_within_caps'];
const isMode = (v: unknown): v is AutonomyMode => MODES.some((m) => m === v);

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
    const check = await requireOwnedClient(clientId);
    if (!check.ok) return check.response;

    const admin = createAdminClient();
    const row = await getOrCreateAutonomy(admin, check.ctx.clientId, check.ctx.userId);
    const todayActionCount = await countTodayActions(admin, check.ctx.clientId, check.ctx.userId);

    return NextResponse.json({
      mode:       row.mode,
      caps:       row.caps,
      mode_since: row.mode_since,
      stats: {
        approvals_total:    row.approvals_total,
        approvals_approved: row.approvals_approved,
        approval_rate:      row.approvals_total > 0
          ? row.approvals_approved / row.approvals_total
          : null,
        today_action_count: todayActionCount,
      },
      suggestion: assessModeSuggestion(row, new Date()),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: Record<string, unknown> = await req.json();
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const check = await requireOwnedClient(clientId);
    if (!check.ok) return check.response;

    if (!isMode(body.mode)) {
      return NextResponse.json(
        { error: `mode must be one of ${MODES.join(', ')}` },
        { status: 400 },
      );
    }
    const reason =
      typeof body.reason === 'string' && body.reason.trim() !== ''
        ? body.reason.trim()
        : 'owner set mode';

    const row = await setMode(createAdminClient(), {
      clientId:    check.ctx.clientId,
      ownerUserId: check.ctx.userId,
      mode:        body.mode,
      reason,
    });
    return NextResponse.json({ mode: row.mode, mode_since: row.mode_since });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
