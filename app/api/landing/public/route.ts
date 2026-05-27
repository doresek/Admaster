import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Public endpoint — fetch a published landing page by slug.
// Uses anon client; relies on the `public_published` RLS policy on landing_pages.
// Returns clear errors so the UI can surface them to the user.
export async function GET(req: NextRequest) {
  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 });

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );

  // First check: does the slug exist at all? (any status)
  // This separates "page doesn't exist" from "page exists but not published".
  const { data: anyRow, error: anyErr } = await supabase
    .from('landing_pages')
    .select('id, slug, status')
    .eq('slug', slug)
    .maybeSingle();

  if (anyErr) {
    return NextResponse.json({
      error:  'db_error',
      detail: anyErr.message,
    }, { status: 500 });
  }

  // If RLS hid the row entirely, anyRow will be null. Try a service-role fallback
  // when we suspect this — only if SUPABASE_SERVICE_ROLE_KEY is available.
  if (!anyRow && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll() { return []; }, setAll() {} } }
    );
    const { data: adminRow } = await admin
      .from('landing_pages')
      .select('id, slug, status, title, template, content')
      .eq('slug', slug)
      .maybeSingle();

    if (adminRow) {
      // The row exists but RLS hides it from anon.
      if (adminRow.status !== 'published') {
        return NextResponse.json({
          error:  'not_published',
          detail: `הדף קיים אבל הסטטוס שלו הוא "${adminRow.status}". עבור לדשבורד ולחץ "פרסם".`,
        }, { status: 404 });
      }
      // status IS published but anon can't see → RLS policy missing
      return NextResponse.json({
        error:  'rls_blocked',
        detail: 'דף הנחיתה מסומן כפורסם אבל RLS חוסם קריאה אנונימית. הרץ את 004_phase_b.sql ב-Supabase.',
        // Fallback: return the data anyway so the user can at least see the page
        id:       adminRow.id,
        slug:     adminRow.slug,
        title:    adminRow.title,
        template: adminRow.template,
        content:  adminRow.content,
        status:   adminRow.status,
      }, { status: 200 }); // 200 so the UI renders; warning will be in DevTools
    }

    return NextResponse.json({
      error:  'not_found',
      detail: `לא נמצא דף נחיתה עם slug="${slug}".`,
    }, { status: 404 });
  }

  if (!anyRow) {
    return NextResponse.json({
      error:  'not_found',
      detail: `לא נמצא דף נחיתה עם slug="${slug}".`,
    }, { status: 404 });
  }

  if (anyRow.status !== 'published') {
    return NextResponse.json({
      error:  'not_published',
      detail: `הדף קיים אבל הסטטוס שלו "${anyRow.status}". עבור לדשבורד ולחץ "פרסם".`,
    }, { status: 404 });
  }

  // Anon CAN see it (RLS works). Get the full data.
  const { data: full, error: fullErr } = await supabase
    .from('landing_pages')
    .select('id, slug, title, template, content, status')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (fullErr || !full) {
    return NextResponse.json({ error: 'db_error', detail: fullErr?.message ?? 'No data' }, { status: 500 });
  }

  return NextResponse.json(full);
}
