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
    .select('id, user_id, status, title, slug')
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

  // ─── Forward to user — in-app notification + WhatsApp click-link helper ───
  try {
    // Build a human-readable summary of the lead fields
    const FIELD_LABELS_HE: Record<string, string> = {
      name: 'שם', phone: 'טלפון', email: 'אימייל', revenue: 'הכנסה', goal: 'מטרה',
    };
    const summaryLines = Object.entries(fields)
      .map(([k, v]) => `${FIELD_LABELS_HE[k] ?? k}: ${v}`)
      .filter(Boolean);
    const body = summaryLines.join('\n');

    // Build a wa.me link IF the page owner has a WhatsApp number configured
    const { data: settings } = await supabase
      .from('agency_settings')
      .select('whatsapp_number, support_email')
      .eq('user_id', page.user_id)
      .maybeSingle();

    let waLink = '';
    if (settings?.whatsapp_number) {
      const num = String(settings.whatsapp_number).replace(/\D/g, '');
      // Israeli numbers: convert leading 0 → 972
      const intl = num.startsWith('0') ? '972' + num.slice(1) : num;
      const msg  = `ליד חדש מ-${page.title}\n\n${body}`;
      waLink = `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
    }

    // Insert in-app notification via SECURITY DEFINER RPC (anon can call it)
    await supabase.rpc('notify_landing_lead', {
      p_user_id: page.user_id,
      p_title:   `🔥 ליד חדש: ${page.title}`,
      p_body:    body,
      p_href:    `/landing-pages/edit/${page.id}`,
      p_meta:    {
        landing_page_id: page.id,
        slug:            page.slug,
        wa_link:         waLink || null,
        email:           settings?.support_email || null,
        fields,
      },
    });
  } catch (notifErr) {
    // Notification is best-effort — don't fail the lead submission
    console.error('[landing/lead] notification failed:', notifErr);
  }

  return NextResponse.json({ ok: true });
}
