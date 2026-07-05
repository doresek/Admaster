// app/api/economics/route.ts
//
//   GET  /api/economics?clientId=            economics row + derived numbers
//                       [&cac=&monthlyContribution=]  → adds the services gates
//   POST /api/economics                      seed the 3 owner onboarding answers
//                       body: { clientId, contributionMarginPct, avgDealValue,
//                               closeRatePct, paybackTargetMonths?, currency? }
//
// Auth + ownership pattern copied from app/api/voc/route.ts: cookie-authed
// user client for identity, explicit clients-table ownership check
// (RLS-scoped — returns the row only to its owner) BEFORE any work. All
// reads/writes here run on the SAME RLS user client — this endpoint only
// touches the caller's own rows, so no admin client is needed.
//
// Derived numbers are computed, never stored (break-even ROAS = 1/CM per
// migration 060's doctrine). The gates need CAC + monthly contribution, which
// live in campaign data, not in client_economics — callers (allocator,
// digest) pass them as query params; without them `gates` is null.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ClientEconomicsRow } from '@/lib/capability-contracts';
import {
  breakEvenRoas,
  getEconomics,
  paybackMonths,
  serviceGates,
  upsertEconomics,
  valuePerLead,
  type ServiceGatesResult,
} from '@/lib/economics';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DerivedEconomics {
  break_even_roas: number | null;
  value_per_lead:  number | null;
  gates:           ServiceGatesResult | null;
}

interface GateParams {
  cac:                 number;
  monthlyContribution: number;
}

/**
 * Compute the derived layer from a stored row. DB CHECK constraints keep the
 * stored inputs inside the core guards' ranges, so a failed core result here
 * only means "inputs incomplete" → the field is null (never a 500).
 *
 * LTV for the gate uses avg_deal_value × margin — the single-deal
 * contribution, a conservative LTV floor for services (repeat business only
 * raises it, so a PASS is trustworthy).
 */
function deriveEconomics(row: ClientEconomicsRow | null, gateParams: GateParams | null): DerivedEconomics {
  const derived: DerivedEconomics = { break_even_roas: null, value_per_lead: null, gates: null };
  if (!row) return derived;

  if (row.contribution_margin_pct !== null) {
    const be = breakEvenRoas(row.contribution_margin_pct);
    if (be.ok) derived.break_even_roas = be.value;
  }

  if (row.contribution_margin_pct !== null && row.avg_deal_value !== null && row.close_rate_pct !== null) {
    const vpl = valuePerLead({
      closeRatePct: row.close_rate_pct,
      avgDealValue: row.avg_deal_value,
      marginPct:    row.contribution_margin_pct,
    });
    if (vpl.ok) derived.value_per_lead = vpl.value;
  }

  if (gateParams && row.contribution_margin_pct !== null && row.avg_deal_value !== null) {
    const ltv = row.avg_deal_value * (row.contribution_margin_pct / 100);
    const payback = paybackMonths(gateParams);
    if (payback.ok) {
      const gates = serviceGates({
        ltv,
        cac:            gateParams.cac,
        paybackM:       payback.value,
        targetPaybackM: row.payback_target_months,
      });
      if (gates.ok) derived.gates = gates.value;
    }
  }

  return derived;
}

/** Parse an optional positive-number query param; NaN/≤0 → error string. */
function parsePositiveParam(raw: string | null, name: string): { value: number | null; error: string | null } {
  if (raw === null) return { value: null, error: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, error: `${name} must be a positive number` };
  }
  return { value: n, error: null };
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = req.nextUrl.searchParams;
    const clientId = params.get('clientId')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }

    const cac = parsePositiveParam(params.get('cac'), 'cac');
    if (cac.error) return NextResponse.json({ error: cac.error }, { status: 400 });
    const monthly = parsePositiveParam(params.get('monthlyContribution'), 'monthlyContribution');
    if (monthly.error) return NextResponse.json({ error: monthly.error }, { status: 400 });

    // Ownership (defense-in-depth): the RLS-scoped user client returns the
    // client row only if the caller owns it; refuse otherwise.
    const { data: owned, error: ownedError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (ownedError) throw new Error(`ownership check: ${ownedError.message}`);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const economics = await getEconomics(supabase, clientId, user.id);
    const gateParams: GateParams | null =
      cac.value !== null && monthly.value !== null
        ? { cac: cac.value, monthlyContribution: monthly.value }
        : null;

    return NextResponse.json({ economics, derived: deriveEconomics(economics, gateParams) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as {
      clientId?:              unknown;
      contributionMarginPct?: unknown;
      avgDealValue?:          unknown;
      closeRatePct?:          unknown;
      paybackTargetMonths?:   unknown;
      currency?:              unknown;
    };

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }

    // The 3 onboarding answers must be NUMBERS — reject strings/missing here
    // so validateOwnerEconomics only ever judges real numeric ranges.
    const numeric: Record<string, number> = {};
    for (const field of ['contributionMarginPct', 'avgDealValue', 'closeRatePct'] as const) {
      const v = body[field];
      if (typeof v !== 'number') {
        return NextResponse.json(
          { errors: [{ field, message: 'חובה למלא מספר' }] },
          { status: 400 },
        );
      }
      numeric[field] = v;
    }
    if (body.paybackTargetMonths !== undefined && typeof body.paybackTargetMonths !== 'number') {
      return NextResponse.json(
        { errors: [{ field: 'paybackTargetMonths', message: 'חובה למלא מספר' }] },
        { status: 400 },
      );
    }
    if (body.currency !== undefined && typeof body.currency !== 'string') {
      return NextResponse.json(
        { errors: [{ field: 'currency', message: 'מטבע חייב להיות קוד בן 3 אותיות (למשל ILS)' }] },
        { status: 400 },
      );
    }

    // Ownership check before writing (same defense-in-depth as GET).
    const { data: owned, error: ownedError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (ownedError) throw new Error(`ownership check: ${ownedError.message}`);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const result = await upsertEconomics(supabase, {
      clientId,
      ownerUserId:           user.id,
      contributionMarginPct: numeric.contributionMarginPct,
      avgDealValue:          numeric.avgDealValue,
      closeRatePct:          numeric.closeRatePct,
      ...(typeof body.paybackTargetMonths === 'number' ? { paybackTargetMonths: body.paybackTargetMonths } : {}),
      ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
    });

    if (!result.ok) {
      return NextResponse.json({ errors: result.errors }, { status: 400 });
    }

    return NextResponse.json({
      economics: result.row,
      derived:   deriveEconomics(result.row, null),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
