// lib/client-core/avatar.ts
//
// Server-side Avatar v1 generator for the durable client core. It mirrors the
// EXACT (system, user) prompt that the dashboard's buildAvatar()
// (app/(dashboard)/briefs/page.tsx) sends to /api/ai with action 'avatar', so
// the post-brief-submit orchestrator builds the same avatar the marketer would
// have built by hand — single source of truth for the avatar-v1 logic.
//
// `run` is injectable for tests (no API key needed), mirroring analyzeBrief.
import Anthropic from '@anthropic-ai/sdk';

/** Calls Claude with a (system, user) prompt and returns the raw text. */
export type AvatarRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

/**
 * Build the exact (system, user) prompt buildAvatar() has always used —
 * "Alex Hormozi + Eugene Schwartz" full customer-avatar profile.
 */
export function composeAvatarPrompt(
  briefValues: Record<string, string>,
): { system: string; user: string } {
  const v = briefValues;
  const system = `מומחה אווטאר — Alex Hormozi + Eugene Schwartz. בנה פרופיל לקוח מלא.
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

  const user = `עסק:${v.biz_name}|${v.biz_what}|תוצאה:${v.biz_result}
לקוח:${v.cust_who}|כאב:${v.pain_main}|פנימי:${v.pain_internal}
חלום:${v.desire_dream}|התנגדות:${v.obj_main}|פחד:${v.obj_fear}
מודעות:${v.mkt_awareness}`;

  return { system, user };
}

// Default runner: a real Anthropic call using the same model env var + token
// budget the dashboard avatar path uses. Lazily constructed so importing this
// module never requires the API key (tests inject their own `run`).
let _anthropic: Anthropic | null = null;
const defaultRun: AvatarRunner = async (system, user, maxTokens) => {
  _anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const msg = await _anthropic.messages.create({
    model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }],
  });
  const block = msg.content.find(b => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
};

/**
 * Generate the Avatar v1 text from a brief's values: compose → run.
 * `run` defaults to a real Anthropic call (same model + max_tokens 2000 as the
 * dashboard avatar path) and is injectable for tests.
 */
export async function generateAvatarV1(opts: {
  briefValues: Record<string, string>;
  run?:        AvatarRunner;
}): Promise<string> {
  const { briefValues, run = defaultRun } = opts;
  const { system, user } = composeAvatarPrompt(briefValues);
  return run(system, user, 2000);
}
