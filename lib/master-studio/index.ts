// ════════════════════════════════════════════
// Master Studio — shared types & parse helpers
// ════════════════════════════════════════════
import type { MarketerId } from '@/lib/marketers';
import type { FrameworkId } from '@/lib/frameworks';

export const MASTER_NOTES_MAX = 2000;

export interface MasterStudioInput {
  brief:        string;
  masterNotes?: string;
  platform:     string;
  tone?:        string;
  type?:        string;
  framework?:   FrameworkId;
  hook?:        string;
  locale?:      'he' | 'en' | 'ar';
  /**
   * Optional pre-derived Hebrew "lessons from past judged posts" block (G1 of
   * the learning loop — see lib/generation-queue/lessons.ts). When present,
   * Creator + Editor prompts include it as a framed section; when absent or
   * empty, every prompt is byte-identical to the no-history behavior.
   */
  learningContext?: string;
}

export interface AvatarProfile {
  persona: string; fears: string; desires: string; awareness_level: string; objections: string;
}
export interface MarketerPick { id: MarketerId | string; name: string; emoji: string; why?: string; }
export interface PrincipleApplied { principle: string; application: string; }

export interface VariantDraft {
  post: string; hashtags: string[]; image: string; tips: string; whatsapp: string;
  principles: PrincipleApplied[];
}

export const SCORE_DIMS = [
  // scroll_stop leads on purpose: the first half-second thumb-stop is often THE
  // biggest driver of ad performance — it is scored AND up-weighted in selection.
  'scroll_stop',
  'hook_strength', 'clarity', 'emotional_resonance', 'cta_strength',
  'brand_fit', 'awareness_match', 'framework_adherence',
] as const;
export type ScoreDim = typeof SCORE_DIMS[number];

/**
 * Fraction of the winner-selection score carried by `scroll_stop` (the rest by
 * the judge's overall `score`). Scroll-stopping power gets a heavy, explicit
 * vote so the best-of-N pick is not won by a well-argued but scroll-past ad.
 */
export const SCROLL_STOP_WEIGHT = 0.4;

/** Winner-selection score: blend the judge's overall score with scroll_stop. */
export function weightedSelectionScore(score: number, scrollStop: number): number {
  return Math.round((1 - SCROLL_STOP_WEIGHT) * score + SCROLL_STOP_WEIGHT * scrollStop);
}

export interface VariantScore {
  index: number; score: number; dims: Record<ScoreDim, number>; note: string;
  /** Scroll-stop-weighted selection score used to pick the best-of-N winner. */
  weighted: number;
}
export interface JudgeResult { scores: VariantScore[]; winnerIndex: number; rationale: string; }

export interface StrategistResult { avatar: AvatarProfile | null; ranked: MarketerPick[]; }

export interface MasterV2Output {
  avatar:        AvatarProfile | null;
  marketers:     MarketerPick[];                                   // those that competed (survivors)
  winner:        { marketer: MarketerPick; draft: VariantDraft; score: number };
  scores:        VariantScore[];
  judgeRationale: string;
  boosted:       boolean;
}

export function localeWord(locale?: MasterStudioInput['locale']): string {
  return locale === 'en' ? 'in English' : locale === 'ar' ? 'بالعربية' : 'בעברית';
}

/**
 * Map a post `type` (the Hebrew chip labels used by /create, or a matching token)
 * to a marketing funnel stage so the recorded artifact carries a `funnel_stage`
 * tag for the learning loop. Conversion-intent posts are bottom-of-funnel, trust /
 * product-consideration posts are mid-funnel; everything else (awareness, tips,
 * engagement) defaults to top-of-funnel ('TOFU').
 */
export function deriveFunnelStage(type?: string): 'TOFU' | 'MOFU' | 'BOFU' {
  const t = (type ?? '').toLowerCase();
  // Bottom — direct conversion / offer push.
  if (t.includes('מבצע') || t.includes('מכיר') || t.includes('הנחה') ||
      t.includes('promo') || t.includes('sale') || t.includes('offer') || t.includes('bofu')) {
    return 'BOFU';
  }
  // Middle — consideration / trust / product depth.
  if (t.includes('אמון') || t.includes('הצגת מוצר') || t.includes('המלצ') ||
      t.includes('trust') || t.includes('product') || t.includes('case') || t.includes('mofu')) {
    return 'MOFU';
  }
  // Top — awareness, tips, engagement, questions, and the default.
  return 'TOFU';
}

/** Extract content inside `[TAG]…[/TAG]`. Empty string if missing. */
export function xt(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  return m ? m[1].trim() : '';
}

export function parseKeyValueBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

export function parseList(s: string): string[] {
  return s.split('\n').map(l => l.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
}

export function parsePrinciples(block: string): PrincipleApplied[] {
  return parseList(block).map(line => {
    const m = line.match(/^עקרון:\s*"?([^"→]+)"?\s*→\s*איך התבטא:\s*(.+)$/);
    if (m) return { principle: m[1].trim(), application: m[2].trim() };
    const arrow = line.match(/^(.+?)\s*→\s*(.+)$/);
    if (arrow) return { principle: arrow[1].trim(), application: arrow[2].trim() };
    return { principle: line, application: '' };
  });
}

export function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/** Parse the shared post-tag block used by Creator and Editor. Null if no [POST]. */
export function parsePostTags(raw: string): VariantDraft | null {
  const post = xt(raw, 'POST');
  if (!post) return null;
  return {
    post,
    hashtags:   xt(raw, 'HASHTAGS').split(/\s+/).filter(h => h.startsWith('#')),
    image:      xt(raw, 'IMAGE_PROMPT'),
    tips:       xt(raw, 'TIPS'),
    whatsapp:   xt(raw, 'WHATSAPP'),
    principles: parsePrinciples(xt(raw, 'PRINCIPLES_APPLIED')),
  };
}
