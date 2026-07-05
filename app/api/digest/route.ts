// app/api/digest/route.ts
//
//   GET  /api/digest?clientId=[&kind=][&limit=]   list a client's digests (newest first)
//   GET  /api/digest?id=                          one digest (detail)
//   POST /api/digest  { action: 'compose', clientId, kind, periodStart }
//        compose (or RE-compose the draft) for the period. The server computes
//        periodEnd: weekly → periodStart+6 days; monthly → end of that month.
//        409 if the period's digest is already approved/sent (immutable).
//   POST /api/digest  { action: 'approve', digestId, clientId }
//        draft → approved (the only transition exposed; sending is C2-gated).
//
// Auth + ownership per app/api/campaigns / app/api/voc: cookie-authed user
// client for identity, explicit clients-table ownership check (RLS-scoped)
// before composing, admin client for the data-layer work.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { DigestKind } from '@/lib/capability-contracts';
import { approveDigest, composeAndSave, getDigest, listDigests } from '@/lib/digest';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const KINDS: readonly DigestKind[] = ['weekly', 'monthly'];
const isKind = (v: unknown): v is DigestKind => KINDS.some((k) => k === v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A real calendar date in YYYY-MM-DD (round-trips through Date.UTC). */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** weekly → start+6d; monthly → last day of the start's month (UTC math). */
function computePeriodEnd(kind: DigestKind, periodStart: string): string {
  const [y, m, d] = periodStart.split('-').map((x) => Number.parseInt(x, 10));
  if (kind === 'weekly') {
    const t = Date.UTC(y, m - 1, d) + 6 * 24 * 60 * 60 * 1000;
    return new Date(t).toISOString().slice(0, 10);
  }
  // Day 0 of the NEXT month = last day of this month.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = req.nextUrl.searchParams;
    const id = params.get('id')?.trim();
    if (id !== undefined && id !== '') {
      if (!UUID_RE.test(id)) return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 });
      const digest = await getDigest(createAdminClient(), id, user.id);
      if (digest === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ digest });
    }

    const clientId = params.get('clientId')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }
    const rawKind = params.get('kind') ?? undefined;
    if (rawKind !== undefined && !isKind(rawKind)) {
      return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
    }
    const rawLimit = params.get('limit');
    const limit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > 100)) {
      return NextResponse.json({ error: 'limit must be 1..100' }, { status: 400 });
    }

    const digests = await listDigests(createAdminClient(), {
      clientId,
      ownerUserId: user.id,
      ...(rawKind !== undefined ? { kind: rawKind } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    return NextResponse.json({ digests });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: unknown = await req.json();
    if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const action = body['action'] ?? 'compose';
    if (action !== 'compose' && action !== 'approve') {
      return NextResponse.json({ error: "action must be 'compose' or 'approve'" }, { status: 400 });
    }

    const clientId = typeof body['clientId'] === 'string' ? body['clientId'].trim() : '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }

    // Ownership (defense-in-depth, per app/api/voc): the RLS-scoped user
    // client returns the client row only to its owner.
    const { data: owned, error: ownedError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (ownedError) return NextResponse.json({ error: ownedError.message }, { status: 500 });
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'approve') {
      const digestId = typeof body['digestId'] === 'string' ? body['digestId'].trim() : '';
      if (!UUID_RE.test(digestId)) {
        return NextResponse.json({ error: 'digestId must be a UUID' }, { status: 400 });
      }
      const result = await approveDigest(createAdminClient(), digestId, clientId, user.id);
      if (!result.ok) {
        return result.reason === 'not_found'
          ? NextResponse.json({ error: 'Not found' }, { status: 404 })
          : NextResponse.json(
              { error: `digest is '${result.status}' — only a draft can be approved`, status: result.status },
              { status: 409 },
            );
      }
      return NextResponse.json({ digest: result.digest });
    }

    // action === 'compose'
    const kind = body['kind'] ?? 'weekly';
    if (!isKind(kind)) {
      return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
    }
    const periodStart = body['periodStart'];
    if (!isIsoDate(periodStart)) {
      return NextResponse.json({ error: 'periodStart must be a valid YYYY-MM-DD date' }, { status: 400 });
    }
    const periodEnd = computePeriodEnd(kind, periodStart);

    const result = await composeAndSave(createAdminClient(), {
      clientId,
      ownerUserId: user.id,
      kind,
      periodStart,
      periodEnd,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: `digest for this period is '${result.status}' — immutable; it will not be recomposed`, status: result.status },
        { status: 409 },
      );
    }
    return NextResponse.json({ digest: result.digest, warnings: result.warnings });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
