import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TEMPLATES_BY_ID, type LandingTemplate } from '@/lib/landing-templates';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9א-ת]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    || `lp-${Date.now().toString(36)}`;
}

// GET /api/landing — list user's pages
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('landing_pages')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

// POST /api/landing — create a new landing page (from template or via AI)
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { template, title, client_id, content } = await req.json() as {
    template: LandingTemplate;
    title:    string;
    client_id?: string;
    content?:   any;
  };

  if (!template || !title) {
    return NextResponse.json({ error: 'Missing template or title' }, { status: 400 });
  }

  const def = TEMPLATES_BY_ID[template];
  if (!def) return NextResponse.json({ error: 'Invalid template' }, { status: 400 });

  // Generate a unique slug
  let baseSlug = slugify(title);
  let slug     = baseSlug;
  let suffix   = 1;
  while (true) {
    const { data: existing } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (!existing) break;
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
    if (suffix > 50) {
      slug = `${baseSlug}-${Date.now().toString(36)}`;
      break;
    }
  }

  const finalContent = content ?? def.defaultContent;

  const { data, error } = await supabase
    .from('landing_pages')
    .insert({
      user_id:   user.id,
      client_id: client_id ?? null,
      slug,
      title,
      template,
      content: finalContent,
      status: 'draft',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH /api/landing?id=... — update a landing page
export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const patch = await req.json();
  const allowed: Record<string, true> = { title: true, content: true, status: true, client_id: true };
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const k of Object.keys(patch)) if (allowed[k]) updates[k] = patch[k];

  const { data, error } = await supabase
    .from('landing_pages')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/landing?id=...
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await supabase.from('landing_pages').delete().eq('id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
