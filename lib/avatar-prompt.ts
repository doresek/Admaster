// lib/avatar-prompt.ts
//
// The live dashboard avatar prompt (Hormozi × Schwartz full customer profile),
// extracted verbatim from buildAvatar() in app/(dashboard)/briefs/page.tsx so it
// lives in exactly one place. Pure strings + a formatter — NO server-only imports,
// so it is safe to import from the client component that renders the briefs page.
import type { BriefValues } from '@/types';

/** System prompt: the avatar spec with its [TAG]…[/TAG] block. */
export const AVATAR_SYSTEM_PROMPT = `מומחה אווטאר — Alex Hormozi + Eugene Schwartz. בנה פרופיל לקוח מלא.
[AN]שם האווטאר[/AN][AE]אמוג'י[/AE]
[DEMO]דמוגרפיה מפורטת[/DEMO]
[PSYCH]פסיכוגרפיה — ערכים, אמונות, פחדים[/PSYCH]
[MONO]מונולוג פנימי — ציטוטים[/MONO]
[PAIN]כאב חיצוני | כאב פנימי | כאב פילוסופי[/PAIN]
[DREAM]תוצאת החלום המפורטת[/DREAM]
[BA]לפני הפתרון / אחרי הפתרון[/BA]
[OBJ]3 התנגדויות + תשובה לכל אחת[/OBJ]
[AWR]שלב מודעות Schwartz + הסבר[/AWR]
[TRIG]3 טריגרים לרכישה[/TRIG]
[ANGLE]3 זוויות מסר[/ANGLE]
[VEQ]משוואת ערך Hormozi: תוצאה/סבירות/זמן/מאמץ[/VEQ]`;

/** max_tokens budget for the avatar generation call. */
export const AVATAR_MAX_TOKENS = 2000;

/** Build the user prompt from a brief's values (verbatim from buildAvatar()). */
export function buildAvatarUserPrompt(v: BriefValues): string {
  return `עסק:${v.biz_name}|${v.biz_what}|תוצאה:${v.biz_result}
לקוח:${v.cust_who}|כאב:${v.pain_main}|פנימי:${v.pain_internal}
חלום:${v.desire_dream}|התנגדות:${v.obj_main}|פחד:${v.obj_fear}
מודעות:${v.mkt_awareness}`;
}
