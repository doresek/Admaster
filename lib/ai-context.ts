// ════════════════════════════════════════════
// Build a structured AI context block from:
//   1. Currently-active Meta client (selected in top-bar)
//   2. Most recent / specified brief for that client
//
// Used by every AI route so every generation honors the specific client the
// marketer is working for. (Brand DNA was removed from the AI path.)
// ════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AiContextInput {
  userId:    string;
  clientId?: string | null;   // explicit override; else uses active-client cookie value passed by caller
  briefId?:  string | null;   // explicit override; else uses most-recent brief for the client/user
}

export interface AiContextBlocks {
  clientText:   string;       // formatted block for the active client
  briefText:    string;       // formatted block for the brief
  combined:     string;       // client + brief joined — drop this into a system prompt
  client:       any | null;   // raw row (so callers can grab name etc.)
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

  // ─── 1. Active client (Meta client) ─────────────
  let client: any = null;
  if (clientId) {
    const { data } = await supabase
      .from('meta_clients')
      .select('id, name, industry, emoji, business_analysis, avatar, core_generated_at')
      .eq('id', clientId)
      .eq('user_id', userId)
      .maybeSingle();
    client = data ?? null;
  }

  // ─── 2. Brief — explicit or most recent for the client ─
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
    // No explicit brief — deterministic lookup by client_id. The brief is linked
    // to its client at submit time (briefs.client_id ← brief_codes.client_id), so
    // we take the most-recent brief for this exact client. No name matching.
    const { data } = await supabase
      .from('briefs')
      .select('values, avatar, ads, funnel, status')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    brief = data ?? null;
  }

  // ─── Format blocks ───────────────────────────────
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
    // Legacy avatar fallback: only when the client core has no structured avatar.
    // When meta_clients.avatar exists, the structured CLIENT AVATAR block below
    // supersedes this 1500-char text slice (no duplicate avatars in the prompt).
    if (brief.avatar && !client?.avatar) {
      block += `\n\n--- Saved customer avatar ---\n${String(brief.avatar).slice(0, 1500)}`;
    }
    return block;
  })();

  // ─── 3. Client-core BUSINESS ANALYSIS (only when present) ─────────
  const businessAnalysisText = formatBusinessAnalysis(client?.business_analysis);

  // ─── 4. Client-core CLIENT AVATAR (Avatar v2 structured, or v1 shim) ─
  const avatarText = formatClientAvatar(client?.avatar);

  const combined = [clientText, briefText, businessAnalysisText, avatarText]
    .filter(Boolean)
    .join('\n\n');

  return { clientText, briefText, combined, client };
}

// ─── Client-core formatters ──────────────────────────────────────
// Both cap arrays to the first 5 items to respect the prompt budget, and
// return '' when their source is absent so they drop out of `combined`.

// Coerce a JSONB value into a clean, capped string[] (handles string | string[]).
function asCappedList(v: unknown, cap = 5): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x)))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap);
}

// Dispatch on the stored shape:
//   • NEW StrategyAnalysis (has `strategic_summary`) → the 4-section MARKETING
//     STRATEGY block.
//   • LEGACY completeness shape (completeness_score / gaps / questions, no
//     strategic_summary) → the old BUSINESS ANALYSIS block, unchanged, so
//     pre-upgrade clients keep rendering and emit no strategy markers.
function formatBusinessAnalysis(analysis: any): string {
  if (!analysis || typeof analysis !== 'object') return '';
  if (analysis.strategic_summary && typeof analysis.strategic_summary === 'object') {
    return formatStrategyAnalysis(analysis);
  }
  return formatLegacyAnalysis(analysis);
}

const scalarLine = (label: string, v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? `${label}: ${s}` : null;
};

function formatStrategyAnalysis(a: any): string {
  const lines: string[] = ['═══ MARKETING STRATEGY ═══'];

  const ss = a.strategic_summary ?? {};
  lines.push('[STRATEGIC SUMMARY]');
  for (const l of [
    scalarLine('goal', ss.goal),
    scalarLine('core_offer', ss.core_offer),
    scalarLine('usp', ss.usp),
  ]) if (l) lines.push(l);
  const constraints = asCappedList(ss.constraints);
  if (constraints.length) lines.push(`constraints: ${constraints.join(' | ')}`);

  const sa = a.sub_audience ?? {};
  lines.push('[SUB-AUDIENCE]');
  for (const l of [
    scalarLine('name', sa.name),
    scalarLine('awareness', sa.awareness_level),
    scalarLine('persona', sa.persona),
    scalarLine('explanation', sa.explanation),
  ]) if (l) lines.push(l);

  const pf = a.platform_funnel ?? {};
  lines.push('[PLATFORM & FUNNEL]');
  for (const l of [
    scalarLine('platform', pf.platform),
    scalarLine('ad_format', pf.ad_format),
    scalarLine('funnel_type', pf.funnel_type),
    scalarLine('platform_reason', pf.platform_reason),
    scalarLine('format_reason', pf.format_reason),
    scalarLine('funnel_reason', pf.funnel_reason),
  ]) if (l) lines.push(l);

  const os = a.offer_stack ?? {};
  lines.push('[OFFER STACK]');
  const components = asCappedList(os.components);
  const strengths  = asCappedList(os.strengths);
  if (components.length) lines.push(`components: ${components.join(' | ')}`);
  if (strengths.length)  lines.push(`strengths: ${strengths.join(' | ')}`);
  const assessment = scalarLine('assessment', os.assessment);
  if (assessment) lines.push(assessment);

  return lines.join('\n');
}

function formatLegacyAnalysis(analysis: any): string {
  const lines: string[] = ['═══ BUSINESS ANALYSIS ═══'];
  if (analysis.completeness_score != null && analysis.completeness_score !== '') {
    lines.push(`completeness_score: ${analysis.completeness_score}`);
  }
  const strengths   = asCappedList(analysis.strengths);
  const gaps        = asCappedList(analysis.gaps);
  const refinements = asCappedList(analysis.refinements);
  if (strengths.length)   lines.push(`strengths: ${strengths.join(' | ')}`);
  if (gaps.length)        lines.push(`gaps: ${gaps.join(' | ')}`);
  if (refinements.length) lines.push(`refinements: ${refinements.join(' | ')}`);
  // Nothing but the header → no useful content, drop the block.
  if (lines.length === 1) return '';
  return lines.join('\n');
}

function formatClientAvatar(avatar: any): string {
  if (!avatar || typeof avatar !== 'object') return '';

  // Transitional shim: { v1_text: "..." } — emit the raw text instead of fields.
  if (typeof avatar.v1_text === 'string' && avatar.v1_text.trim()) {
    return `═══ CLIENT AVATAR ═══\n${avatar.v1_text.trim().slice(0, 1500)}`;
  }

  const lines: string[] = ['═══ CLIENT AVATAR ═══'];
  const scalar = (label: string, v: unknown) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s) lines.push(`${label}: ${s}`);
  };
  const list = (label: string, v: unknown) => {
    const items = asCappedList(v);
    if (items.length) lines.push(`${label}: ${items.join(' | ')}`);
  };

  scalar('name', avatar.name);
  scalar('age', avatar.age);
  scalar('occupation', avatar.occupation);
  list('pains', avatar.pains);
  list('desires', avatar.desires);
  list('fears', avatar.fears);
  list('objections', avatar.objections);
  scalar('awareness_level', avatar.awareness_level);
  scalar('recommended_angle', avatar.recommended_angle);
  list('voice_quotes', avatar.voice_quotes);
  list('buying_triggers', avatar.buying_triggers);
  list('recommended_creative_angles', avatar.recommended_creative_angles);

  if (lines.length === 1) return '';
  return lines.join('\n');
}
