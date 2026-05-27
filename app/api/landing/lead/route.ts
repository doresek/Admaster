import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Public lead submission for a landing page
export async function POST(req: NextRequest) {
  const { slug, fields } = await req.json();
  if (!slug || !fields) return NextResponse.json({ error: 'Missing slug or fields' }, { status: 400 });

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const { data: page } = await supabase
    .from('landing_pages')
    .select('id, user_id, status')
    .eq('slug', slug)
    .maybeSingle();

  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'Page not found or not published' }, { status: 404 });
  }

  const { error } = await supabase.from('landing_page_leads').insert({
    landing_page_id: page.id,
    user_id:         page.user_id,
    fields,
    user_agent:      req.headers.get('user-agent') ?? null,
    referrer:        req.headers.get('referer') ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Increment conversion counter (best effort)
  await supabase.rpc('increment_lp_conversion', { p_page_id: page.id }).then(() => {}, () => {});

  return NextResponse.json({ ok: true });
}
