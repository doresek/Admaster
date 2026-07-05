import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveConnection } from '@/lib/meta-connections';
import { getDecryptedMetaToken } from '@/lib/meta';
import { META_GRAPH_BASE } from '@/lib/meta-config';
import {
  buildInsightsUrl,
  mapInsightsRowToPerformance,
  type GraphInsightsRow,
} from '@/lib/meta-insights';

// POST /api/meta/insights
//
// Pulls daily Meta ad-account insights for a client and UPSERTs them into
// ad_performance, the table the client ROI report reads. Without this sync the
// report is empty — the insights chain previously lived on an unmerged branch.
//
// Body: { clientId, since?, until? }  (dates as YYYY-MM-DD; defaults last 30d)
// Returns: { days_synced, ad_account_id }

const DEFAULT_WINDOW_DAYS = 30;

function ymd(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { clientId, since, until } = await req.json().catch(() => ({}));
    if (!clientId) {
      return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
    }

    // Resolve the client's active Meta connection + the ad account to query.
    const connection = await getActiveConnection(supabase, clientId, user.id);
    if (!connection) {
      return NextResponse.json({ error: 'No active Meta connection for this client' }, { status: 404 });
    }
    const adAccountId = connection.selected_ad_account_id;
    if (!adAccountId) {
      return NextResponse.json({ error: 'No ad account selected for this client' }, { status: 400 });
    }

    const token = await getDecryptedMetaToken(supabase, clientId, user.id);
    if (!token) {
      return NextResponse.json({ error: 'Client Meta token missing' }, { status: 404 });
    }

    // Date window — default to the trailing 30 days.
    const untilDate = until ?? ymd(new Date());
    const sinceDate = since ?? ymd(new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000));

    // Daily insights for the ad account. time_increment=1 → one row per day.
    // The token is sent via the Authorization header (NOT the URL) so it never
    // leaks into server/proxy/error logs. The URL holds only non-secret params.
    const url = buildInsightsUrl({
      graphBase: META_GRAPH_BASE,
      adAccountId,
      since: sinceDate,
      until: untilDate,
    });

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (json.error) {
      return NextResponse.json(
        { error: `Meta Graph error: ${json.error.message ?? 'unknown'}` },
        { status: 502 },
      );
    }

    const rows: GraphInsightsRow[] = Array.isArray(json.data) ? json.data : [];
    const fetchedAt = new Date().toISOString();

    const records = rows
      .map((row) =>
        mapInsightsRowToPerformance(row, {
          userId: user.id,
          clientId,
          adAccountId,
          fetchedAt,
        }),
      )
      .filter((r) => r.date); // drop any row missing a date (can't satisfy the unique key)

    if (records.length > 0) {
      const { error } = await supabase
        .from('ad_performance')
        .upsert(records, { onConflict: 'client_id,ad_account_id,date' });
      if (error) {
        return NextResponse.json({ error: `Failed to store insights: ${error.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ days_synced: records.length, ad_account_id: adAccountId });
  } catch (err) {
    // Never surface err.message to the client — it can carry sensitive context
    // (and, depending on the failure, fragments of the request). Log only a
    // redacted summary server-side: the error name, never the token or URL.
    const name = err instanceof Error ? err.name : typeof err;
    console.error(`[meta/insights] sync failed: ${name}`);
    return NextResponse.json({ error: 'Insights sync failed' }, { status: 500 });
  }
}
