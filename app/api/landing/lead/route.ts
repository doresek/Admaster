import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  EMPTY_IDENTITY,
  FIRST_TOUCH_COOKIE,
  mergeIdentity,
  parseClickIds,
  parseFirstTouchCookie,
  sanitizeReferrer,
} from '@/lib/measurement/capture';
import { createLeadFromLanding } from '@/lib/measurement/leads';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the response meta reports about the (best-effort) funnel registration. */
interface FunnelMeta {
  status:  'created' | 'reattached' | 'skipped' | 'failed';
  reason?: string;
}

// Public lead submission for a landing page
export async function POST(req: NextRequest) {
  const raw: unknown = await req.json().catch(() => null);
  const body   = isRecord(raw) ? raw : {};
  const slug   = typeof body.slug === 'string' ? body.slug : '';
  const fields = isRecord(body.fields) ? body.fields : null;
  if (!slug || !fields) return NextResponse.json({ error: 'Missing slug or fields' }, { status: 400 });

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const { data: page } = await supabase
    .from('landing_pages')
    .select('id, user_id, status, title, slug, client_id')
    .eq('slug', slug)
    .maybeSingle();

  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'Page not found or not published' }, { status: 404 });
  }

  // Owning client for this lead = the page's client_id (the page is the only
  // place attribution lives; the anonymous submitter has no active-client cookie).
  // SCHEMA GAP: landing_page_leads has NO client_id column (004_phase_b.sql:40-48),
  // so we cannot persist it on the row without a separate human-applied migration.
  // Until then attribution is reachable two-hop (lead → landing_page → client_id),
  // and we surface the resolved client_id in the lead notification meta below.
  const clientId: string | null = page.client_id ?? null;

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

  // ─── MEASUREMENT SPINE (migration 060) — funnel_leads + lead_touchpoints ───
  // LEAD CAPTURE IS SACRED: the landing_page_leads row above is already durable
  // and the visitor gets success no matter what happens here. Every failure in
  // this block is caught, RECORDED (log + response meta reason) and swallowed —
  // a measurement failure never loses a lead. Back-compat: nothing above this
  // line changed.
  const funnelMeta: FunnelMeta = await (async (): Promise<FunnelMeta> => {
    try {
      if (!clientId) {
        // funnel_leads.client_id is NOT NULL — a page with no client cannot
        // register in the client-scoped funnel (legacy/unlinked pages).
        return { status: 'skipped', reason: 'page_has_no_client' };
      }

      // Identity: the POSTed touchpoint (current visit, hidden-payload
      // equivalent) merged over the first-touch 'am_tp' cookie the LP page
      // set — both re-validated here through parseClickIds (public input,
      // zero trust; see lib/measurement/capture.ts for the strategy).
      const payloadIdentity = parseClickIds(isRecord(body.touchpoint) ? body.touchpoint : {});
      const cookieIdentity =
        parseFirstTouchCookie(req.cookies.get(FIRST_TOUCH_COOKIE)?.value ?? null) ?? EMPTY_IDENTITY;
      const merged = mergeIdentity(payloadIdentity, cookieIdentity);
      const identity = merged.referrer !== null
        ? merged
        : { ...merged, referrer: sanitizeReferrer(req.headers.get('referer')) };

      // חוק הספאם: consent is an explicit affirmative — anything but a literal
      // `true` from the (unchecked-by-default) checkbox records false.
      const consentMarketing = body.consentMarketing === true;

      // Funnel tables are owner-only RLS and this caller is anonymous, so the
      // writes need the service-role client. Imported lazily INSIDE the sacred
      // boundary: if the admin client is unavailable (missing service key,
      // partial test stubs), that failure is recorded here instead of taking
      // down the whole route at module load.
      const { createAdminClient } = await import('@/lib/supabase/server');

      const result = await createLeadFromLanding(createAdminClient(), {
        clientId,
        ownerUserId: page.user_id,
        fields,
        touchpoint:  identity,
        consentMarketing,
        source:      'landing',
        // landing_page_lead_id is intentionally absent: the (test-locked)
        // insert above returns no row, and changing its chain to .select()
        // would alter the sacred legacy path. Two-hop provenance via the page.
        sourceRef:   { landing_page_id: page.id, slug: page.slug },
        userAgent:   req.headers.get('user-agent'),
      });

      if (!result.ok) {
        console.error('[landing/lead] funnel lead creation failed:', result.message);
        return { status: 'failed', reason: result.reason };
      }
      if (result.notes.length > 0) {
        console.error('[landing/lead] funnel lead degraded:', result.notes.join('; '));
      }
      return { status: result.deduped ? 'reattached' : 'created' };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[landing/lead] measurement spine failed (lead still captured):', message);
      return { status: 'failed', reason: 'measurement_error' };
    }
  })();

  // ─── Forward to user — in-app notification + WhatsApp click-link helper ───
  try {
    // Build a human-readable summary of the lead fields
    const FIELD_LABELS_HE: Record<string, string> = {
      name: 'שם', phone: 'טלפון', email: 'אימייל', revenue: 'הכנסה', goal: 'מטרה',
    };
    const summaryLines = Object.entries(fields)
      .map(([k, v]) => `${FIELD_LABELS_HE[k] ?? k}: ${v}`)
      .filter(Boolean);
    // (named summaryText, not `body`, to avoid shadowing the parsed request body)
    const summaryText = summaryLines.join('\n');

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
      const msg  = `ליד חדש מ-${page.title}\n\n${summaryText}`;
      waLink = `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
    }

    // Insert in-app notification via SECURITY DEFINER RPC (anon can call it)
    await supabase.rpc('notify_landing_lead', {
      p_user_id: page.user_id,
      p_title:   `🔥 ליד חדש: ${page.title}`,
      p_body:    summaryText,
      p_href:    `/landing-pages/edit/${page.id}`,
      p_meta:    {
        landing_page_id: page.id,
        client_id:       clientId,
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

  return NextResponse.json({ ok: true, meta: { funnelLead: funnelMeta } });
}
