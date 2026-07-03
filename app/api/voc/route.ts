// app/api/voc/route.ts
//
//   POST /api/voc   ingest one VoC document for an owned client
//                   body: { clientId, source, rawText, sourceMeta? }
//   GET  /api/voc   quote bank read (copy ammunition)
//                   ?clientId=&extractable=&funnelFit=&limit=
//
// Auth + ownership pattern copied from app/api/campaigns + client-core/run:
// cookie-authed user client for identity, explicit clients-table ownership
// check (RLS-scoped — returns the row only to its owner) BEFORE any work,
// admin client for the pipeline's background writes.
//
// Abuse guards (this endpoint spends an LLM call on user input):
//   • rawText hard-capped at 50k chars (~one review-page paste) — reject, not
//     truncate, so no silent evidence loss.
//   • one document per call; content-hash dedupe inside ingestDocument makes
//     replay/retry free.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { VocExtractable, VocSource } from '@/lib/capability-contracts';
import { createAnthropicLlm, getQuoteBank, ingestDocument, type VocFunnelFit } from '@/lib/voc';

// LLM extraction can take a while on a large paste.
export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_SOURCES: readonly VocSource[] = [
  'own_reviews', 'competitor_reviews', 'ad_comments', 'community', 'sales_thread', 'manual',
];
const VALID_EXTRACTABLES: readonly VocExtractable[] = [
  'pain', 'desire', 'objection', 'alternative', 'trigger', 'proof', 'identity',
];
const VALID_FUNNEL_FITS: readonly VocFunnelFit[] = ['TOFU', 'MOFU', 'BOFU'];

const MAX_RAW_TEXT_CHARS = 50_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as {
      clientId?: string; source?: string; rawText?: string; sourceMeta?: Record<string, unknown>;
    };

    const clientId = body.clientId?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }
    const source = body.source?.trim() ?? '';
    if (!VALID_SOURCES.includes(source as VocSource)) {
      return NextResponse.json(
        { error: `source must be one of ${VALID_SOURCES.join(', ')}` },
        { status: 400 },
      );
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

    // Ownership (defense-in-depth): the RLS-scoped user client returns the
    // client row only if the caller owns it; refuse otherwise.
    const { data: owned } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ownedClient: { id: string; name: string | null } = owned;

    const result = await ingestDocument(createAdminClient(), createAnthropicLlm(), {
      clientId,
      ownerUserId: user.id,
      source:      source as VocSource,
      sourceMeta:  body.sourceMeta,
      rawText,
      // The client's own name is the one name we reliably know to strip
      // (voc-mining §4 PII rule); reviewers naming the business is fine, but
      // the same string often doubles as the owner's personal name in SMBs.
      piiNames: ownedClient.name ? [ownedClient.name] : [],
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = req.nextUrl.searchParams;
    const clientId = params.get('clientId')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'clientId must be a UUID' }, { status: 400 });
    }

    const extractableRaw = params.get('extractable') ?? undefined;
    if (extractableRaw !== undefined && !VALID_EXTRACTABLES.includes(extractableRaw as VocExtractable)) {
      return NextResponse.json(
        { error: `extractable must be one of ${VALID_EXTRACTABLES.join(', ')}` },
        { status: 400 },
      );
    }
    const funnelFitRaw = params.get('funnelFit') ?? undefined;
    if (funnelFitRaw !== undefined && !VALID_FUNNEL_FITS.includes(funnelFitRaw as VocFunnelFit)) {
      return NextResponse.json(
        { error: `funnelFit must be one of ${VALID_FUNNEL_FITS.join(', ')}` },
        { status: 400 },
      );
    }
    const limitRaw = params.get('limit');
    const limit = limitRaw !== null ? Number.parseInt(limitRaw, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
    }

    // Ownership check before reading (same defense-in-depth as POST).
    const { data: owned } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const quotes = await getQuoteBank(createAdminClient(), clientId, user.id, {
      ...(extractableRaw !== undefined ? { extractable: extractableRaw as VocExtractable } : {}),
      ...(funnelFitRaw !== undefined ? { funnelFit: funnelFitRaw as VocFunnelFit } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return NextResponse.json({ quotes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
