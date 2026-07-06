// app/api/organic/perf/route.ts
//
//   POST /api/organic/perf   — ingest organic performance for a client (P1-7)
//     { client_id }                       → Graph ingestion over published slots
//                                           (no Meta token → clean 200
//                                           { ingested: 0, reason: 'no_meta_connection' })
//     { client_id, manual: { reach, engaged, impressions?, reactions?,
//       comments?, shares?, campaign_item_id?, artifact_id? } }
//                                         → manual path (source 'manual'),
//                                           same verdict math — works TODAY
//                                           while publishing is dry-run.
//
//   GET /api/organic/perf?client_id=...  — recent content_performance rows for
//                                           the client's organic items (+ manual),
//                                           owner-scoped.
//
// The Graph path is fully live-ready but harmless in the dry-run era: dryrun_*
// post ids are skipped inside the ingester without ever calling Graph.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getDecryptedMetaToken } from '@/lib/meta';
import {
  ingestOrganicPerformance,
  ingestManualMetrics,
  graphMetricsFetcher,
  supabasePublishedSlotSource,
  supabasePerfStore,
  supabaseItemLookup,
  type ManualMetricsInput,
} from '@/lib/organic-perf';

export const runtime = 'nodejs';

interface PerfPostBody {
  client_id?: string;
  manual?: (ManualMetricsInput & {
    campaign_item_id?: string;
    artifact_id?: string;
  }) | null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as PerfPostBody;
    if (!body.client_id || typeof body.client_id !== 'string') {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const perfStore = supabasePerfStore(admin);
    const itemLookup = supabaseItemLookup(admin);

    // ── manual path (works today, no Meta connection needed) ──────────────────
    if (body.manual) {
      const { campaign_item_id, artifact_id, ...metrics } = body.manual;
      if (campaign_item_id !== undefined && typeof campaign_item_id !== 'string') {
        return NextResponse.json({ error: 'manual.campaign_item_id must be a string' }, { status: 400 });
      }
      if (artifact_id !== undefined && typeof artifact_id !== 'string') {
        return NextResponse.json({ error: 'manual.artifact_id must be a string' }, { status: 400 });
      }

      const result = await ingestManualMetrics({
        clientId: body.client_id,
        ownerUserId: user.id,
        campaignItemId: campaign_item_id ?? null,
        artifactId: artifact_id ?? null,
        metrics: metrics as ManualMetricsInput,
        deps: { perfStore, itemLookup },
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ingested: 1, source: 'manual', verdict: result.verdict });
    }

    // ── Graph path (live-ready; dryrun_* ids are skipped inside) ──────────────
    const token = await getDecryptedMetaToken(admin, body.client_id, user.id);
    if (!token) {
      return NextResponse.json({ ingested: 0, reason: 'no_meta_connection' });
    }

    const summary = await ingestOrganicPerformance({
      ownerUserId: user.id,
      clientId: body.client_id,
      now: new Date(),
      deps: {
        slots: supabasePublishedSlotSource(admin),
        fetcher: graphMetricsFetcher(token),
        perfStore,
        itemLookup,
      },
    });

    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('client_id');
    if (!clientId) {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const rows = await supabasePerfStore(admin).listRecent({
      ownerUserId: user.id,
      clientId,
      limit: 50,
    });

    return NextResponse.json({ rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
