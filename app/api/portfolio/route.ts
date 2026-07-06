// GET /api/portfolio  (AUTHENTICATED owner) — D-2 AGENCY PORTFOLIO (§2).
//
// The portfolio analyst over ONE owner's clients:
//   1. auth → listClients (explicitly owner-scoped, on top of RLS);
//   2. loadStatesForOwner → rankClients — the C-06 attention ranking IS the
//      triage order (§2), never re-sorted;
//   3. per-client metrics via the metrics layer, then lane derivation +
//      aggregates + narration in shared.ts (pure, tested).
//
// DATA BOUNDARY (strict): every query path is owner_user_id-scoped inside the
// consumed libs, AND ranked ids are intersected with the owner's client list —
// a client this owner doesn't own can never appear in the payload.
//
// N+1 COST (documented): loadMetricInputs is 5 queries per client. We loop
// clients deliberately — capped at METRIC_CLIENT_CAP (20) in attention-rank
// order, in chunks of METRIC_CONCURRENCY (5) — worst case 100 metric queries
// + 5 batched attention queries + 1 client list. A batched multi-client
// loader is a later optimization; clients beyond the cap still render (laned
// from attention alone, marked 'נתונים חלקיים').
//
// FAILURE DISCIPLINE: a single client's metric failure is COLLECTED (warning +
// partial flag) and the page keeps rendering — never a 500 for one bad client.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listClients } from '@/lib/clients';
import { loadStatesForOwner, rankClients } from '@/lib/attention';
import { computeMetrics, loadMetricInputs, METRIC_REGISTRY, type MetricValue } from '@/lib/metrics-layer';
import {
  buildPortfolioPayload,
  currentWeekPeriod,
  METRIC_CLIENT_CAP,
  METRIC_CONCURRENCY,
} from './shared';

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const warnings: string[] = [];
    const period = currentWeekPeriod(new Date());

    // 1) The owner's clients — the ONLY id universe this payload may mention.
    const clients = await listClients(supabase, user.id);
    const names = new Map<string, string>(clients.map((c) => [c.id, c.name]));

    // 2) Attention states + ranking (5 batched queries for the whole fleet).
    //    States are then intersected with `names` (buildSummaries drops any id
    //    outside it) — the explicit boundary on top of the lib's own scoping.
    const states = clients.length > 0 ? await loadStatesForOwner(supabase, user.id) : [];
    const ranked = rankClients(states);

    // 3) Metrics for the top-ranked owned clients (the documented capped N+1).
    const metricClientIds = ranked
      .filter((r) => names.has(r.clientId))
      .slice(0, METRIC_CLIENT_CAP)
      .map((r) => r.clientId);
    const metricsCapped = ranked.filter((r) => names.has(r.clientId)).length > METRIC_CLIENT_CAP;

    const metricsByClient = new Map<string, readonly MetricValue[]>();
    for (let i = 0; i < metricClientIds.length; i += METRIC_CONCURRENCY) {
      const chunk = metricClientIds.slice(i, i + METRIC_CONCURRENCY);
      await Promise.all(chunk.map(async (clientId) => {
        try {
          const { inputs, warnings: loadWarnings } = await loadMetricInputs(supabase, {
            clientId,
            ownerUserId: user.id,
            periodStart: period.start,
            periodEnd:   period.end,
          });
          warnings.push(...loadWarnings.map((w) => `${clientId}: ${w}`));
          metricsByClient.set(clientId, computeMetrics(METRIC_REGISTRY, inputs));
        } catch (err) {
          // Collect + continue: the client renders as partial, the page lives.
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`${clientId}: metrics failed — ${message}`);
        }
      }));
    }

    return NextResponse.json(
      buildPortfolioPayload({ ranked, names, metricsByClient, period, metricsCapped, warnings }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
