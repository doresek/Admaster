// ════════════════════════════════════════════
// Build a structured AI context block from:
//   1. User's Brand DNA (saved in users.brand)
//   2. Currently-active Meta client (selected in top-bar)
//   3. Most recent / specified brief for that client
//
// Used by every AI route so every generation honors the marketer's brand
// and the specific client they're working for.
// ════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AiContextInput {
  userId:    string;
  clientId?: string | null;   // explicit override; else uses active-client cookie value passed by caller
  briefId?:  string | null;   // explicit override; else uses most-recent brief for the client/user
}

export interface AiContextBlocks {
  brandText:    string;       // formatted block for Brand DNA (empty if none)
  clientText:   string;       // formatted block for the active client
  briefText:    string;       // formatted block for the brief
  combined:     string;       // all three joined — drop this into a system prompt
  client:       any | null;   // raw row (so callers can grab name etc.)
  brand:        Record<string, string> | null;
}

const FIELD_LABELS_HE: Record<string, string> = {
  biz_name:        'שם העסק',
  biz_what:        'מה העסק עושה',
  biz_result:      'התוצאה שהלקוח מקבל',
  biz_time:        'תוך כמה זמן רואים תוצאה',
  biz_price:       'מחיר',
  biz_usp:         'מה מייחד',
  cust_who:        'מי הלקוח האידיאלי',
  cust_income:     'הכנסה משוערת',
  pain_main:       'הכאב הגדול',
  pain_internal:   'כאב פנימי',
  desire_dream:    'חלום הלקוח',
  obj_main:        'התנגדות עיקרית',
  obj_tried:       'מה ניסה ולא עבד',
  obj_fear:        'הפחד הכי גדול',
  mkt_awareness:   'רמת מודעות',
  offer_anchor:    'מחיר עיגון',
  offer_price:     'המחיר המוצע',
  offer_bonuses:   'בונוסים',
  offer_guarantee: 'אחריות',
  offer_urgency:   'דחיפות',
  offer_cta:       'CTA',
};

export async function buildAiContext(
  supabase: SupabaseClient,
  input: AiContextInput
): Promise<AiContextBlocks> {
  const { userId, clientId, briefId } = input;

  // ─── 1. Brand DNA from users.brand ──────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('brand')
    .eq('id', userId)
    .maybeSingle();
  const brand = (userRow?.brand ?? null) as Record<string, string> | null;

  // ─── 2. Active client (Meta client) ─────────────
  let client: any = null;
  if (clientId) {
    const { data } = await supabase
      .from('meta_clients')
      .select('id, name, industry, emoji')
      .eq('id', clientId)
      .eq('user_id', userId)
      .maybeSingle();
    client = data ?? null;
  }

  // ─── 3. Brief — explicit or most recent for the client ─
  let brief: any = null;
  if (briefId) {
    const { data } = await supabase
      .from('briefs')
      .select('values, avatar, ads, funnel, status')
      .eq('id', briefId)
      .eq('user_id', userId)
      .maybeSingle();
    brief = data ?? null;
  } else if (client) {
    // No explicit brief — find the most-recent brief whose biz_name matches client.name
    const { data: briefs } = await supabase
      .from('briefs')
      .select('values, avatar, ads, funnel, status, submitted_at')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false })
      .limit(10);
    if (briefs && briefs.length > 0 && client.name) {
      brief = briefs.find(b => (b.values as any)?.biz_name?.includes(client.name) || client.name?.includes((b.values as any)?.biz_name)) ?? null;
    }
  }

  // ─── Format blocks ───────────────────────────────
  const brandText = (() => {
    if (!brand) return '';
    const lines = [
      brand.name     && `Brand name: ${brand.name}`,
      brand.tagline  && `Tagline: ${brand.tagline}`,
      brand.tone     && `Brand voice/tone: ${brand.tone}`,
      brand.audience && `Primary audience: ${brand.audience}`,
      brand.usp      && `Unique selling proposition: ${brand.usp}`,
      brand.pains    && `Customer pains we address: ${brand.pains}`,
      brand.products && `Products/services: ${brand.products}`,
      brand.location && `Location: ${brand.location}`,
      brand.phone    && `Phone: ${brand.phone}`,
      brand.website  && `Website: ${brand.website}`,
    ].filter(Boolean);
    if (lines.length === 0) return '';
    return `═══ MARKETER'S BRAND DNA ═══
${lines.join('\n')}
(These describe the marketing agency itself — apply their voice/values when relevant.)`;
  })();

  const clientText = !client ? '' : `═══ ACTIVE CLIENT ═══
Client: ${client.emoji ?? ''} ${client.name}${client.industry ? ` (industry: ${client.industry})` : ''}
(All generated content is FOR this client's audience and business.)`;

  const briefText = (() => {
    if (!brief?.values) return '';
    const values = brief.values as Record<string, string>;
    const lines = Object.entries(values)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([k, v]) => `${FIELD_LABELS_HE[k] ?? k}: ${v}`);
    if (lines.length === 0) return '';

    let block = `═══ CLIENT BRIEF (full Hormozi×Schwartz form) ═══
${lines.join('\n')}`;
    if (brief.avatar) {
      block += `\n\n--- Saved customer avatar ---\n${String(brief.avatar).slice(0, 1500)}`;
    }
    return block;
  })();

  const combined = [brandText, clientText, briefText].filter(Boolean).join('\n\n');

  return { brandText, clientText, briefText, combined, client, brand };
}
