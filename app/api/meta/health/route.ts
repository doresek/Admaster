// app/api/meta/health/route.ts
//
//   GET /api/meta/health   → the Meta readiness report for the caller's
//                            connections: app config, redirect URIs, required
//                            scopes, per-connection token/scope health, and a
//                            plain-language blocker list.
//
// Authed + owner-scoped. DRY-RUN: uses the default (network-free) deps, so the
// scope check reports "unknown" and NEVER hits Graph. Absent-`meta_connections`
// safe — the default loader degrades to an empty connection list.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildReadinessReport } from '@/lib/meta-health';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const report = await buildReadinessReport({ ownerUserId: user.id });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
