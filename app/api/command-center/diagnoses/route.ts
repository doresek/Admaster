// GET /api/command-center/diagnoses  (AUTHENTICATED owner)
//
// Returns the owner's diagnoses (which funnel link failed + the rationale) with
// each `target_insight_ids` resolved to insight content+confidence. READ-ONLY.
//
// Empty-safe: a missing `diagnoses` (or `client_insights`) relation is treated
// as "no diagnoses yet" → { diagnoses: [] }, never a 500.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isMissingRelation, resolveInsights, attachGrounded, type Diagnosis } from '../shared';

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Client-context propagation: optionally scoped to the active client
    // (?clientId=), same contract as the campaigns route.
    const clientId = new URL(req.url).searchParams.get('clientId');

    let q = supabase
      .from('diagnoses')
      .select('id, failed_link, rationale, target_insight_ids, created_at')
      .eq('owner_user_id', user.id);
    if (clientId) q = q.eq('client_id', clientId);
    const res = await q.order('created_at', { ascending: false });

    if (res.error) {
      if (isMissingRelation(res.error)) return NextResponse.json({ diagnoses: [] });
      throw res.error;
    }

    const rows = (res.data ?? []) as Array<Record<string, any>>;
    if (rows.length === 0) return NextResponse.json({ diagnoses: [] });

    const allIds: string[] = [];
    for (const r of rows) allIds.push(...(r.target_insight_ids ?? []));
    const insightMap = await resolveInsights(supabase, allIds);

    const diagnoses: Diagnosis[] = rows.map((r) => ({
      id: r.id,
      failed_link: r.failed_link ?? null,
      rationale: r.rationale ?? null,
      target_insight_ids: r.target_insight_ids ?? [],
      targets: attachGrounded(r.target_insight_ids, insightMap),
    }));

    return NextResponse.json({ diagnoses });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 });
  }
}
