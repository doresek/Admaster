// Data layer for the per-client card (/clients/[id]).
// Verifies ownership, then pulls everything we can scope to a single client now
// that briefs/posts/images/landing pages all carry client_id. Kept free of React
// so it's testable with a mocked Supabase client.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClientCardClient {
  id:       string;
  name:     string;
  emoji:    string | null;
  industry: string | null;
  status:   string;
}

export interface ClientCardBrief {
  id:           string;
  values:       Record<string, string>;
  status:       string;
  submitted_at: string;
}

export interface ClientCardPost {
  id:         string;
  type:       string;
  platform:   string | null;
  output:     any;
  created_at: string;
}

export interface ClientCardImage {
  id:         string;
  image_url:  string;
  prompt:     string | null;
  created_at: string;
}

export interface ClientCardLanding {
  id:          string;
  title:       string;
  slug:        string;
  status:      string;
  views:       number | null;
  conversions: number | null;
}

export interface ClientCardData {
  client:       ClientCardClient;
  brief:        ClientCardBrief | null;
  posts:        ClientCardPost[];
  images:       ClientCardImage[];
  landingPages: ClientCardLanding[];
  leadCount:    number;
}

/**
 * Load the client card. Returns null when the client doesn't exist OR isn't owned
 * by `userId` — callers should treat null as a 404 (we verify ownership in code,
 * not on RLS alone). Content queries run in parallel; the lead count is a
 * dependent follow-up (it needs the client's landing-page ids).
 */
export async function fetchClientCardData(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<ClientCardData | null> {
  // Ownership gate — explicit, not just RLS.
  const { data: client } = await supabase
    .from('meta_clients')
    .select('id, name, emoji, industry, status')
    .eq('id', clientId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!client) return null;

  const [briefRes, postsRes, imagesRes, landingRes] = await Promise.all([
    supabase
      .from('briefs')
      .select('id, values, status, submitted_at')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('generated_content')
      .select('id, type, platform, output, created_at')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('generated_images')
      .select('id, image_url, prompt, created_at')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(24),
    supabase
      .from('landing_pages')
      .select('id, title, slug, status, views, conversions')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false }),
  ]);

  const landingPages = (landingRes.data ?? []) as ClientCardLanding[];

  // Lead count via landing_page_leads.landing_page_id ∈ this client's pages.
  let leadCount = 0;
  const pageIds = landingPages.map(p => p.id);
  if (pageIds.length > 0) {
    const { count } = await supabase
      .from('landing_page_leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('landing_page_id', pageIds);
    leadCount = count ?? 0;
  }

  return {
    client:       client as ClientCardClient,
    brief:        (briefRes.data ?? null) as ClientCardBrief | null,
    posts:        (postsRes.data ?? []) as ClientCardPost[],
    images:       (imagesRes.data ?? []) as ClientCardImage[],
    landingPages,
    leadCount,
  };
}

// The 21 brief fields (mirrors briefs/page.tsx + the SQL completion fn) — used to
// show a completion %. Exported so the card and any test share one source.
export const BRIEF_FIELDS = [
  'biz_name', 'biz_what', 'biz_result', 'biz_time', 'biz_price', 'biz_usp',
  'cust_who', 'cust_income', 'pain_main', 'pain_internal', 'desire_dream',
  'obj_main', 'obj_tried', 'obj_fear', 'mkt_awareness',
  'offer_anchor', 'offer_price', 'offer_bonuses', 'offer_guarantee', 'offer_urgency', 'offer_cta',
] as const;

export function briefCompletionPct(values: Record<string, string> | null | undefined): number {
  if (!values) return 0;
  const filled = BRIEF_FIELDS.filter(f => String(values[f] ?? '').trim() !== '').length;
  return Math.round((filled * 100) / BRIEF_FIELDS.length);
}
