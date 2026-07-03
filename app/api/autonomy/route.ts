// app/api/autonomy/route.ts
//
//   GET  /api/autonomy?clientId=   the client's autonomy state: level, caps,
//                                  approval stats, today's action count, and
//                                  the graduation assessment (earned + visible).
//   POST /api/autonomy             { clientId, level, reason? } — the owner
//                                  sets their own trust level (L0..L3).
//
// Authed + owner-scoped (see require-owned-client.ts). First touch creates the
// row at L1, the vision's default.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  assessGraduation,
  countTodayActions,
  getOrCreateAutonomy,
  setLevel,
  type AutonomyLevel,
} from '@/lib/autonomy';
import { requireOwnedClient } from './require-owned-client';

export const runtime = 'nodejs';

const LEVELS: readonly AutonomyLevel[] = ['L0', 'L1', 'L2', 'L3'];
const isLevel = (v: unknown): v is AutonomyLevel => LEVELS.some((l) => l === v);

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
    const check = await requireOwnedClient(clientId);
    if (!check.ok) return check.response;

    const admin = createAdminClient();
    const row = await getOrCreateAutonomy(admin, check.ctx.clientId, check.ctx.userId);
    const todayActionCount = await countTodayActions(admin, check.ctx.clientId, check.ctx.userId);

    return NextResponse.json({
      level:       row.level,
      caps:        row.caps,
      level_since: row.level_since,
      stats: {
        approvals_total:    row.approvals_total,
        approvals_approved: row.approvals_approved,
        approval_rate:      row.approvals_total > 0
          ? row.approvals_approved / row.approvals_total
          : null,
        today_action_count: todayActionCount,
      },
      graduation: assessGraduation(row, new Date()),
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

    if (!isLevel(body.level)) {
      return NextResponse.json(
        { error: `level must be one of ${LEVELS.join(', ')}` },
        { status: 400 },
      );
    }
    const reason =
      typeof body.reason === 'string' && body.reason.trim() !== ''
        ? body.reason.trim()
        : 'owner set level';

    const row = await setLevel(createAdminClient(), {
      clientId:    check.ctx.clientId,
      ownerUserId: check.ctx.userId,
      level:       body.level,
      reason,
    });
    return NextResponse.json({ level: row.level, level_since: row.level_since });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
