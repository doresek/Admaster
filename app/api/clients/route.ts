import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { briefCompletion } from '@/lib/briefing-template';

// GET /api/clients  (auth required)
// List the authenticated user's CRM clients, each with its brief completion %.
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: clients, error } = await supabase
      .from('meta_clients')
      .select('id, name, emoji, email, phone, company, notes, status, industry, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Attach each client's brief completion (best-effort: degrades to 0 if the
    // briefs.client_id column isn't applied yet).
    let briefsByClient: Record<string, { values: unknown }> = {};
    const ids = (clients ?? []).map(c => c.id);
    if (ids.length) {
      const { data: briefs } = await supabase
        .from('briefs')
        .select('client_id, values')
        .eq('user_id', user.id)
        .in('client_id', ids);
      for (const b of briefs ?? []) {
        if (b.client_id) briefsByClient[b.client_id] = { values: b.values };
      }
    }

    const out = (clients ?? []).map(c => ({
      ...c,
      brief_completion: briefsByClient[c.id]
        ? briefCompletion(briefsByClient[c.id].values as Record<string, unknown>)
        : 0,
    }));

    return NextResponse.json({ clients: out });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/clients  (auth required)
// Create a CRM client (no Meta token required). Body: { name*, email?, phone?, company?, notes?, emoji? }.
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
      name?: string; email?: string; phone?: string;
      company?: string; notes?: string; emoji?: string;
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: 'חסר שם לקוח' }, { status: 400 });

    const { data, error } = await supabase
      .from('meta_clients')
      .insert({
        user_id: user.id,
        name,
        email:   body.email?.trim()   || null,
        phone:   body.phone?.trim()   || null,
        company: body.company?.trim() || null,
        notes:   body.notes?.trim()   || null,
        emoji:   body.emoji || '🏢',
        token:   null,
      })
      .select('id, name, emoji, email, phone, company, notes, status, industry, created_at')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ...data, brief_completion: 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
