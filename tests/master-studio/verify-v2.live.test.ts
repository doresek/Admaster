// ════════════════════════════════════════════════════════════════
// LIVE verification: Master Studio v2 (best-of-N) vs v1 (single-shot).
//
// Per the project directive "every improvement validated with an LLM
// judge", this stands up an INDEPENDENT judge (a different rubric than
// the in-pipeline judge) and compares v2's winning post against a v1
// single-shot post on the SAME brief, BLIND to which is which.
//
// Ship gate: v2 must win the majority (>= 3 of 5 briefs).
//
// This makes REAL Anthropic API calls and costs money, so it is gated
// behind RUN_MS_VERIFY=1 and never runs in the normal `npm test` suite.
//
// Run:
//   RUN_MS_VERIFY=1 ANTHROPIC_API_KEY=sk-... \
//     npx vitest run tests/master-studio/verify-v2.live.test.ts
//   (or `set -a; source ../../.env.local; set +a` to load the key)
// ════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { MARKETERS, marketerToPromptBlock } from '@/lib/marketers';
import { runMasterPipeline, type StageRunner } from '@/lib/master-studio/pipeline';
import { type MasterStudioInput, localeWord } from '@/lib/master-studio';

const RUN = process.env.RUN_MS_VERIFY === '1';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

async function call(system: string, user: string, maxTokens: number): Promise<string> {
  const msg = await anthropic.messages.create({
    model: MODEL, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }],
  });
  const b = msg.content.find(x => x.type === 'text');
  return b && b.type === 'text' ? b.text : '';
}

const runner: StageRunner = (system, user, maxTokens) => call(system, user, maxTokens);

// v1 = the original single-shot Master Studio: one call picks ONE marketer
// and writes the post. Compact reconstruction of the pre-refactor prompt.
async function v1Post(input: MasterStudioInput): Promise<string> {
  const corpus = MARKETERS.map(marketerToPromptBlock).join('\n\n');
  const system = `אתה Master Studio — היוצר השיווקי הטוב בעולם, מאחד 12 ענקי קופי. בחר משווק אחד מתאים, גלם אותו, וכתוב פוסט ${localeWord(input.locale)}.

═══ 12 MARKETERS ═══
${corpus}

פלטפורמה: ${input.platform}. החזר רק את הפוסט בתוך [POST]...[/POST].`;
  const raw = await call(system, `בריף: ${input.brief}`, 1500);
  const m = raw.match(/\[POST\]([\s\S]*?)\[\/POST\]/);
  return (m ? m[1] : raw).trim();
}

// Independent judge — DIFFERENT rubric than lib/master-studio/judge.ts.
async function judge(brief: string, a: string, b: string): Promise<'A' | 'B' | 'TIE'> {
  const system = `אתה מנהל שיווק ותיק. הוצגו לך שני פוסטים שיווקיים לאותו בריף. בחר איזה חזק יותר מבחינת: עוצמת פתיח, רלוונטיות לקהל, בהירות ההצעה, וקריאה לפעולה. החזר אך ורק "A" או "B" (או "TIE" אם זהים לחלוטין) בשורה הראשונה.`;
  const user = `בריף: ${brief}\n\n=== פוסט A ===\n${a}\n\n=== פוסט B ===\n${b}`;
  const raw = (await call(system, user, 10)).trim().toUpperCase();
  if (raw.startsWith('A')) return 'A';
  if (raw.startsWith('B')) return 'B';
  return 'TIE';
}

const BRIEFS: MasterStudioInput[] = [
  { brief: 'השקת קורס דיגיטלי חדש לצילום מוצרים בסמארטפון לבעלי חנויות אונליין', platform: 'Instagram', locale: 'he' },
  { brief: 'מבצע סוף עונה 40% הנחה על נעלי ריצה במועדון לקוחות', platform: 'Facebook', locale: 'he' },
  { brief: 'בניית אמון למרפאת שיניים חדשה בשכונה — בלי מחירים, רק ערך', platform: 'Facebook', locale: 'he', masterNotes: 'אסור להזכיר מחירים' },
  { brief: 'שאלה לקהל: מה הכי מתסכל אתכם בניהול יומן הפגישות בעסק?', platform: 'Instagram', locale: 'he' },
  { brief: 'טיפ מקצועי קצר ממאמן כושר על התאוששות שרירים אחרי אימון', platform: 'Instagram', locale: 'he' },
];

describe.skipIf(!RUN)('Master Studio v2 vs v1 (LIVE, blind LLM judge)', () => {
  it('v2 wins the majority of briefs (ship gate >= 3/5)', async () => {
    let v2Wins = 0, v1Wins = 0, ties = 0;
    const log: string[] = [];

    for (let i = 0; i < BRIEFS.length; i++) {
      const input = BRIEFS[i];
      const [v2res, v1] = await Promise.all([runMasterPipeline(input, runner), v1Post(input)]);
      if (!v2res.ok) { log.push(`brief ${i}: v2 pipeline failed (${v2res.reason})`); v1Wins++; continue; }
      const v2 = v2res.output.winner.draft.post;

      // Randomize A/B by index parity (deterministic, no Math.random) to cancel position bias.
      const v2isA = i % 2 === 0;
      const verdict = await judge(input.brief, v2isA ? v2 : v1, v2isA ? v1 : v2);
      const winner = verdict === 'TIE' ? 'TIE' : (verdict === 'A') === v2isA ? 'v2' : 'v1';
      if (winner === 'v2') v2Wins++; else if (winner === 'v1') v1Wins++; else ties++;
      log.push(`brief ${i}: winner=${winner} (v2 marketer=${v2res.output.winner.marketer.name}, score=${v2res.output.winner.score}, boosted=${v2res.output.boosted})`);
    }

    console.log('\n=== Master Studio v2 vs v1 ===\n' + log.join('\n') +
      `\n\nTALLY → v2: ${v2Wins}/${BRIEFS.length}, v1: ${v1Wins}, ties: ${ties}\n`);

    expect(v2Wins).toBeGreaterThanOrEqual(3);
  }, 600_000); // up to 10 min — best-of-N is several calls per brief
});
