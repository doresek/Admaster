// app/api/meta/health/route.ts
//
//   GET /api/meta/health   → the Meta readiness report for the caller's
//                            connections: app config, redirect URIs, required
//                            scopes, per-connection token/scope health, and a
//                            plain-language blocker list.
//
// Authed + owner-scoped. By default DRY-RUN (network-free deps → scopes "unknown",
// never hits Graph). The LIVE Graph scope-check (Graph `debug_token`) is flipped
// on at H4 via `META_LIVE_SCOPE_CHECK=true`, or per-request with `?live=1` for
// explicit testing. Absent-`meta_connections` safe — the loader degrades to an
// empty connection list. Read-only: this NEVER creates/activates anything or spends.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildReadinessReport, metaGraphCheckScopes } from '@/lib/meta-health';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // T8 flip: live scope-check when the env flag is on, or ?live=1 is passed.
    const liveScopes =
      process.env.META_LIVE_SCOPE_CHECK === 'true' ||
      req.nextUrl.searchParams.get('live') === '1';

    const report = await buildReadinessReport(
      { ownerUserId: user.id },
      liveScopes ? { checkScopes: metaGraphCheckScopes() } : {},
    );
    return NextResponse.json({ ...report, scopeCheck: liveScopes ? 'live' : 'dry-run' });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
