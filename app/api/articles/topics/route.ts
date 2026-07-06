// app/api/articles/topics/route.ts — P3-2 topic-engine endpoint.
//
//   POST /api/articles/topics   build the scored topic backlog for an owned
//                               client from its active atoms + VoC questions
//                               body: { client_id, save? (default true) }
//                               → { topics, created, skipped }
//   GET  /api/articles/topics   the saved idea backlog
//                               ?client_id=  → { articles }
//
// Auth + ownership pattern per app/api/voc/route.ts: cookie-authed user client
// for identity, explicit RLS-scoped clients ownership check BEFORE any work,
// admin client for background reads/writes. NO credits — the engine is fully
// deterministic (no LLM spend).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { listActiveInsights } from '@/lib/intelligence/insights';
import { getQuoteBank } from '@/lib/voc';
import { buildTopicBacklog, deriveVocQuestions, saveTopicsAsIdeas } from '@/lib/articles';
import type { VocQuestionInput } from '@/lib/articles';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { client_id?: string; save?: boolean };
    const clientId = body.client_id?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'client_id must be a UUID' }, { status: 400 });
    }
    const save = body.save !== false; // default true

    // Ownership (defense-in-depth): RLS returns the row only to its owner.
    const { data: owned } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const admin = createAdminClient();

    // The living atoms (all layers — business atoms feed offer/city/injections).
    const atoms = await listActiveInsights(admin, clientId);

    // VoC questions are enrichment, not a requirement — best-effort.
    let vocQuestions: VocQuestionInput[] = [];
    try {
      const quotes = await getQuoteBank(admin, clientId, user.id, { limit: 50 });
      vocQuestions = deriveVocQuestions(quotes);
    } catch {
      vocQuestions = [];
    }

    const topics = buildTopicBacklog({ atoms, vocQuestions });

    let created = 0;
    let skipped = 0;
    if (save && topics.length > 0) {
      ({ created, skipped } = await saveTopicsAsIdeas({
        topics,
        clientId,
        ownerUserId: user.id,
        admin,
      }));
    }

    return NextResponse.json({ topics, created, skipped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('client_id')?.trim() ?? '';
    if (!UUID_RE.test(clientId)) {
      return NextResponse.json({ error: 'client_id must be a UUID' }, { status: 400 });
    }

    // Ownership check before reading (same defense-in-depth as POST).
    const { data: owned } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // The idea backlog — RLS-scoped user client (owner-only policy on articles).
    const { data, error } = await supabase
      .from('articles')
      .select('id, client_id, slug, title, kind, keywords, topic_source, status, grounded_in, rationale, created_at, updated_at')
      .eq('client_id', clientId)
      .eq('status', 'idea')
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ articles: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
