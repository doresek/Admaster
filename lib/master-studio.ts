// ════════════════════════════════════════════
// Master Studio — prompt composition & parsing
// ════════════════════════════════════════════

import { MARKETERS, MARKETERS_BY_ID, marketerToPromptBlock, type MarketerId } from './marketers';
import { FRAMEWORKS_BY_ID, type FrameworkId } from './frameworks';
import type { BrandDNA } from '@/types';

export interface MasterStudioInput {
  brief:        string;
  brand?:       BrandDNA;
  masterNotes?: string;
  platform:     string;       // label, e.g. "Facebook"
  tone?:        string;
  type?:        string;
  /** If user locked a framework via Override chips. */
  framework?:   FrameworkId;
  /** If user locked a hook style via Override chips. */
  hook?:        string;
  locale?:      'he' | 'en' | 'ar';
}

export interface AvatarProfile {
  persona:         string;
  fears:           string;
  desires:         string;
  awareness_level: string;
  objections:      string;
}

export interface MarketerPick {
  id:    MarketerId | string;   // string fallback if unknown id returned
  name:  string;
  emoji: string;
}

export interface PrincipleApplied {
  principle:   string;
  application: string;
}

export interface MasterStudioOutput {
  avatar:     AvatarProfile | null;
  marketer:   MarketerPick  | null;
  why:        string;
  principles: PrincipleApplied[];
  post:       string;
  hashtags:   string[];
  image:      string;
  tips:       string;
  whatsapp:   string;
}

export const MASTER_NOTES_MAX = 2000;

/**
 * Build the layered system prompt for Master Studio.
 * Input total budget ~3500 tokens.
 */
export function composeMasterPrompt(opts: MasterStudioInput): string {
  const lang = opts.locale === 'en' ? 'in English'
             : opts.locale === 'ar' ? 'بالعربية'
             : 'בעברית';

  const masterNotes = (opts.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const corpus = MARKETERS.map(marketerToPromptBlock).join('\n\n');

  const forcedFw = opts.framework
    ? `Forced framework: ${opts.framework} (${FRAMEWORKS_BY_ID[opts.framework]?.name_en ?? opts.framework}) — MUST use this`
    : 'Forced framework: none — choose the framework that best matches the picked marketer';

  const forcedHook = opts.hook
    ? `Forced hook style: ${opts.hook} — MUST use this opening style`
    : 'Forced hook style: none — pick the most effective hook for this avatar';

  return `אתה Master Studio — היוצר השיווקי הטוב בעולם. אתה מאחד את החוכמה של 12 ענקי הקופי.

תהליך חובה (4 שלבים):
1) ניתוח אווטאר עמוק מהבריף + BrandDNA לפי Schwartz 5 awareness levels.
2) בחירת המשווק האידיאלי מ-12 לפי awareness, סוג מוצר, פלטפורמה, וה-Master Notes.
3) גילום מלא של אותו משווק — קולו, framework המועדף, signature moves שלו.
4) יישום עקרונות שלו על הפוסט עם הסבר קצר על כל עיקרון.

כתוב ${lang}.

═══ MASTER NOTES (🔒 PRIORITY — overrides everything below) ═══
${masterNotes || '— אין הערות מיוחדות —'}

═══ 12 MARKETERS CORPUS ═══
${corpus}

═══ OVERRIDES ═══
- ${forcedFw}
- ${forcedHook}
- Platform: ${opts.platform}
- Tone hint: ${opts.tone ?? '—'}
- Post type hint: ${opts.type ?? '—'}

═══ OUTPUT CONTRACT (return ONLY these tags, in this order, nothing else) ═══
[AVATAR_PROFILE]
persona: ...
fears: ...
desires: ...
awareness_level: 1-5 + תווית
objections: ...
[/AVATAR_PROFILE]
[MARKETER_PICK]id|name|emoji[/MARKETER_PICK]
[WHY_THIS_MARKETER]2-3 משפטים למה דווקא הוא[/WHY_THIS_MARKETER]
[PRINCIPLES_APPLIED]
- עקרון: "<שם העיקרון>" → איך התבטא: <משפט קצר>
- עקרון: "<שם העיקרון>" → איך התבטא: <משפט קצר>
- עקרון: "<שם העיקרון>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המלא, עם אמוג'ים וקריאה לפעולה[/POST]
[HASHTAGS]12-15 האשטגים בעברית ואנגלית[/HASHTAGS]
[IMAGE_PROMPT]Detailed English prompt for Ideogram/Midjourney[/IMAGE_PROMPT]
[TIPS]3 טיפים לפרסום: מתי, לאיזה קהל, תקציב[/TIPS]
[WHATSAPP]גרסה קצרה לWhatsApp ללא אמוג'ים מוגזמים[/WHATSAPP]`;
}

/** Extract content inside `[TAG]…[/TAG]`. Empty string if missing. */
function xt(raw: string, tag: string): string {
  const m = raw.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`));
  return m ? m[1].trim() : '';
}

/** Parse `key: value` pairs inside a block. */
function parseKeyValueBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Parse bulleted list (lines starting with -, •, *, digit-dot). */
function parseList(s: string): string[] {
  return s.split('\n')
    .map(l => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

/** Parse the "principle: X → application: Y" structured bullets. */
function parsePrinciples(block: string): PrincipleApplied[] {
  const items = parseList(block);
  return items.map(line => {
    const m = line.match(/^עקרון:\s*"?([^"→]+)"?\s*→\s*איך התבטא:\s*(.+)$/);
    if (m) return { principle: m[1].trim(), application: m[2].trim() };
    const arrow = line.match(/^(.+?)\s*→\s*(.+)$/);
    if (arrow) return { principle: arrow[1].trim(), application: arrow[2].trim() };
    return { principle: line, application: '' };
  });
}

function parseAvatar(block: string): AvatarProfile | null {
  if (!block) return null;
  const kv = parseKeyValueBlock(block);
  return {
    persona:         kv['persona']         ?? '',
    fears:           kv['fears']           ?? '',
    desires:         kv['desires']         ?? '',
    awareness_level: kv['awareness_level'] ?? '',
    objections:      kv['objections']      ?? '',
  };
}

function parseMarketer(block: string): MarketerPick | null {
  if (!block) return null;
  const parts = block.split('|').map(s => s.trim());
  const [idRaw, nameRaw, emojiRaw] = parts;
  const id = (idRaw ?? '').toLowerCase();
  const known = (MARKETERS_BY_ID as Record<string, { name: string; emoji: string }>)[id];
  if (known) {
    return { id: id as MarketerId, name: known.name, emoji: known.emoji };
  }
  // Fallback: trust returned name/emoji if id is unknown
  if (id) {
    console.warn('[master-studio] unknown marketer id:', id, '— falling back to schwartz');
    const fb = MARKETERS_BY_ID.schwartz;
    return { id: 'schwartz', name: nameRaw || fb.name, emoji: emojiRaw || fb.emoji };
  }
  return null;
}

export function parseMasterResponse(raw: string): MasterStudioOutput {
  const avatar     = parseAvatar(xt(raw, 'AVATAR_PROFILE'));
  const marketer   = parseMarketer(xt(raw, 'MARKETER_PICK'));
  const why        = xt(raw, 'WHY_THIS_MARKETER');
  const principles = parsePrinciples(xt(raw, 'PRINCIPLES_APPLIED'));
  const post       = xt(raw, 'POST');
  const hashtags   = xt(raw, 'HASHTAGS').split(/\s+/).filter(h => h.startsWith('#'));
  const image      = xt(raw, 'IMAGE_PROMPT');
  const tips       = xt(raw, 'TIPS');
  const whatsapp   = xt(raw, 'WHATSAPP');
  return { avatar, marketer, why, principles, post, hashtags, image, tips, whatsapp };
}

/** Critical-tag check used to decide whether to refund. */
export function isCriticalFailure(out: MasterStudioOutput): boolean {
  return !out.post || !out.marketer;
}
