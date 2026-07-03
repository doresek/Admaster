// app/api/competitor-watch/route.ts
//
//   GET  /api/competitor-watch?clientId=
//        Entities + the latest coverage map/flags — RECOMPUTED ON READ from
//        the stored rows (analysis is pure and re-derivable; atoms are the
//        durable knowledge — spec C-09 / skill §3). No LLM call on read: own
//        angles come only from atoms already stamped structured.taxonomy_angle.
//
//   POST /api/competitor-watch
//        { action: 'add_entity', clientId, name, ring?, pageRef? }
//          → track a competitor (cap-enforced: 409 names who to deactivate)
//        { action: 'set_entity_active', clientId, entityId, active }
//          → activate/deactivate (activation cap-checked)
//        { action: 'paste', clientId, entityId, rawText }
//          → ManualPasteFetcher for that entity + the FULL pipeline
//            (upsert → decode → analyze → atom actions), rawText ≤ 30k
//
// Auth + ownership pattern per app/api/campaigns + app/api/voc: cookie-authed
// user client for identity, explicit clients-table ownership check (RLS-scoped)
// BEFORE any work, admin client for the pipeline's background writes.

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { CompetitorEntityRow, CompetitorRing } from '@/lib/capability-contracts';
import { listActiveInsights } from '@/lib/intelligence/insights';
import {
  ManualPasteFetcher,
  buildCoverageMap,
  createAnthropicLlm,
  isCompetitorAngle,
  listAds,
  listEntities,
  runWatch,
  setEntityActive,
  strategicFlags,
  upsertEntity,
  type AdSourceFetcher,
  type FetchResult,
  type OwnAngle,
} from '@/lib/competitor-watch';

// The paste path runs batched Anthropic decode calls.
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_RAW_TEXT_CHARS = 30_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RINGS: readonly CompetitorRing[] = ['direct', 'category', 'non_consumption'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const parseRing = (v: unknown): CompetitorRing | null =>
  typeof v === 'string' ? (RINGS.find((r) => r === v) ?? null) : null;

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** RLS-scoped ownership check — the user client returns the row only to its owner. */
async function ownsClient(userClient: SupabaseClient, clientId: string): Promise<boolean> {
  const { data } = await userClient.from('clients').select('id').eq('id', clientId).maybeSingle();
  return data !== null;
}

/** Own angles for pure read-side recompute: only atoms a previous watch
 *  already stamped with a taxonomy angle (no LLM on GET). */
async function readOwnAngles(admin: SupabaseClient, clientId: string): Promise<OwnAngle[]> {
  const bridge = await listActiveInsights(admin, clientId, 'bridge');
  const own: OwnAngle[] = [];
  for (const atom of bridge) {
    if (atom.kind !== 'angle') continue;
    const cached = atom.structured?.taxonomy_angle;
    if (isCompetitorAngle(cached)) {
      own.push({ angle: cached, atomConfidence: atom.confidence, insightId: atom.id });
    }
  }
  return own;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }
    if (!(await ownsClient(supabase, clientId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = createAdminClient();
    const now = new Date();

    const entities = await listEntities(admin, clientId, user.id);
    const activeEntities = entities.filter((e) => e.active);
    const ads = await listAds(admin, clientId, user.id);
    const ownAngles = await readOwnAngles(admin, clientId);

    const map = buildCoverageMap(activeEntities, ads, ownAngles, now);
    const flags = strategicFlags(map, activeEntities);

    return NextResponse.json({ entities, map, flags });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: unknown = await req.json();
    if (!isRecord(body)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

    const action = typeof body.action === 'string' ? body.action : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }
    if (!(await ownsClient(supabase, clientId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const admin = createAdminClient();

    if (action === 'add_entity') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 200) {
        return NextResponse.json({ error: 'name is required (≤ 200 chars)' }, { status: 400 });
      }
      const ring = body.ring === undefined ? 'direct' : parseRing(body.ring);
      if (ring === null) {
        return NextResponse.json({ error: `ring must be one of ${RINGS.join(', ')}` }, { status: 400 });
      }
      const pageRef = typeof body.pageRef === 'string' ? body.pageRef.trim().slice(0, 500) : null;

      const result = await upsertEntity(admin, {
        clientId, ownerUserId: user.id, name, ring, pageRef,
      });
      // Cap rejection is the skill's noise rule, not a server fault → 409
      // with the active set so the owner can deactivate deliberately.
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    if (action === 'set_entity_active') {
      const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';
      if (!UUID_RE.test(entityId)) {
        return NextResponse.json({ error: 'entityId must be a UUID' }, { status: 400 });
      }
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 });
      }
      const result = await setEntityActive(admin, clientId, user.id, entityId, body.active);
      const status = result.ok ? 200 : result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(result, { status });
    }

    if (action === 'paste') {
      const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';
      if (!UUID_RE.test(entityId)) {
        return NextResponse.json({ error: 'entityId must be a UUID' }, { status: 400 });
      }
      const rawText = typeof body.rawText === 'string' ? body.rawText : '';
      if (!rawText.trim()) {
        return NextResponse.json({ error: 'rawText is required' }, { status: 400 });
      }
      if (rawText.length > MAX_RAW_TEXT_CHARS) {
        return NextResponse.json(
          { error: `rawText exceeds ${MAX_RAW_TEXT_CHARS} chars — split the paste` },
          { status: 400 },
        );
      }

      // The pasted entity must be an ACTIVE tracked entity of this client.
      const entities = await listEntities(admin, clientId, user.id, { activeOnly: true });
      const target = entities.find((e) => e.id === entityId);
      if (!target) {
        return NextResponse.json(
          { error: 'entityId is not an active tracked competitor of this client' },
          { status: 404 },
        );
      }

      // Scope the paste to its entity; other entities contribute no new
      // observations this run (their stored ads still feed the analysis).
      const paste = new ManualPasteFetcher(rawText);
      const scoped: AdSourceFetcher = {
        fetch(entity: CompetitorEntityRow): Promise<FetchResult> {
          return entity.id === target.id
            ? paste.fetch(entity)
            : Promise.resolve({ ads: [], source: 'manual_paste' });
        },
      };

      const result = await runWatch(admin, createAnthropicLlm(), scoped, {
        clientId,
        ownerUserId: user.id,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "action must be one of 'add_entity', 'set_entity_active', 'paste'" },
      { status: 400 },
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
