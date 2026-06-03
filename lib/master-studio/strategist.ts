// lib/master-studio/strategist.ts
import { MARKETERS, MARKETERS_BY_ID, marketerToPromptBlock, type MarketerId } from '@/lib/marketers';
import {
  type MasterStudioInput, type StrategistResult, type MarketerPick,
  MASTER_NOTES_MAX, localeWord, xt, parseKeyValueBlock, parseList,
} from './index';

export function composeStrategistPrompt(input: MasterStudioInput): { system: string; user: string } {
  const notes = (input.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const corpus = MARKETERS.map(marketerToPromptBlock).join('\n\n');
  const system = `אתה אסטרטג שיווק בכיר. נתח את הבריף ובחר את שלושת המשווקים המתאימים ביותר מתוך 12.

כתוב ${localeWord(input.locale)}.

═══ מקור האמת (חובה) ═══
גזור את האווטאר אך ורק מה-CLIENT BRIEF וה-BRAND DNA שלמעלה (אם הופיעו) ומהבריף שלמטה. אל תמציא קהל, כאבים, מוצר או פרטים שלא נמסרו — אם משהו חסר, הסק בזהירות מתוך הנתון בלבד.

═══ MASTER NOTES (🔒 עדיפות עליונה) ═══
${notes || '— אין —'}

═══ 12 MARKETERS CORPUS ═══
${corpus}

═══ פלטפורמה: ${input.platform} | טון: ${input.tone ?? '—'} | סוג: ${input.type ?? '—'} ═══

═══ OUTPUT CONTRACT (החזר רק את התגיות, בסדר הזה) ═══
[AVATAR_PROFILE]
persona: ...
fears: ...
desires: ...
awareness_level: 1-5 + תווית
objections: ...
[/AVATAR_PROFILE]
[RANKED_MARKETERS]
1. id|name|emoji|נימוק קצר
2. id|name|emoji|נימוק קצר
3. id|name|emoji|נימוק קצר
[/RANKED_MARKETERS]
השתמש אך ורק ב-id חוקיים מהקורפוס. שלושה משווקים שונים.`;

  const user = `בריף: ${input.brief}`;
  return { system, user };
}

export function parseStrategist(raw: string): StrategistResult {
  const av = parseKeyValueBlock(xt(raw, 'AVATAR_PROFILE'));
  const avatar = Object.keys(av).length
    ? {
        persona: av['persona'] ?? '', fears: av['fears'] ?? '', desires: av['desires'] ?? '',
        awareness_level: av['awareness_level'] ?? '', objections: av['objections'] ?? '',
      }
    : null;

  const ranked: MarketerPick[] = [];
  const seen = new Set<string>();
  for (const line of parseList(xt(raw, 'RANKED_MARKETERS'))) {
    const [idRaw, , , why] = line.split('|').map(s => (s ?? '').trim());
    const id = (idRaw ?? '').toLowerCase();
    const known = (MARKETERS_BY_ID as Record<string, { name: string; emoji: string }>)[id];
    if (known && !seen.has(id)) {
      seen.add(id);
      ranked.push({ id: id as MarketerId, name: known.name, emoji: known.emoji, why: why || '' });
    }
    if (ranked.length === 3) break;
  }
  // Pad to exactly 3 from the corpus head so best-of-3 is guaranteed.
  for (const m of MARKETERS) {
    if (ranked.length === 3) break;
    if (!seen.has(m.id)) { seen.add(m.id); ranked.push({ id: m.id, name: m.name, emoji: m.emoji, why: '' }); }
  }
  return { avatar, ranked };
}
