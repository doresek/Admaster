# Master Studio v2 (Best-of-N + LLM Judge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Master Studio's single AI call with a server-orchestrated best-of-N pipeline — a Strategist ranks 3 marketers, 3 Creators write competing posts in parallel, an LLM Judge scores and picks a winner, and an Editor rewrites the winner if it scores below 80.

**Architecture:** Refactor `lib/master-studio.ts` into a `lib/master-studio/` module of four pure stage units (prompt-builder + parser each) plus a `pipeline.ts` orchestrator that takes an injected `StageRunner` (so it's unit-testable without hitting Anthropic). A new server route `app/api/ai/master/route.ts` provides the Anthropic-backed runner, deducts credits once, and refunds on failure. The `/create` page calls this route directly.

**Tech Stack:** Next.js 14 App Router, TypeScript, Anthropic SDK (`claude-sonnet-4-6`), Supabase, Vitest. Existing helpers reused: `lib/credits` (`deductCredits`/`refundCredits`), `lib/rate-limit`, `lib/ai-context` (`buildAiContext`), `lib/marketers`, `lib/frameworks`, `lib/scoring` (style reference for JSON parsing).

---

## File Structure

**Create:**
- `lib/master-studio/index.ts` — shared types + tag helpers (`xt`, `parseKeyValueBlock`, `parseList`, `parsePrinciples`, `stripFence`), `MASTER_NOTES_MAX`, public re-exports.
- `lib/master-studio/strategist.ts` — `composeStrategistPrompt`, `parseStrategist`.
- `lib/master-studio/creator.ts` — `composeCreatorPrompt`, `parseCreator`.
- `lib/master-studio/judge.ts` — `composeJudgePrompt`, `parseJudge`.
- `lib/master-studio/editor.ts` — `composeEditorPrompt`, `parseEditor`.
- `lib/master-studio/pipeline.ts` — `runMasterPipeline(input, run)`, `StageRunner` type.
- `app/api/ai/master/route.ts` — orchestrator route.
- `tests/master-studio/strategist.test.ts`, `creator.test.ts`, `judge.test.ts`, `editor.test.ts`, `pipeline.test.ts`.
- `scripts/verify-master-v2.mjs` — v1-vs-v2 LLM-judge comparison harness.

**Delete:**
- `lib/master-studio.ts` (contents migrate into `lib/master-studio/index.ts` + stage files).

**Modify:**
- `types/index.ts` — `CREDIT_COSTS.master_post` 4 → 6.
- `app/(dashboard)/create/page.tsx` — call `/api/ai/master`, staged progress, enriched reveal panel.

> NOTE (coordination): the parallel DB session owns git. Do NOT commit/push without user relay. Commits below are local checkpoints; hold the push.

---

### Task 1: Convert `lib/master-studio.ts` → `lib/master-studio/index.ts` (shared core)

**Files:**
- Create: `lib/master-studio/index.ts`
- Delete: `lib/master-studio.ts`
- Test: `tests/master-studio/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/index.test.ts
import { describe, it, expect } from 'vitest';
import { xt, parseList, parsePrinciples, stripFence, MASTER_NOTES_MAX } from '@/lib/master-studio';

describe('xt', () => {
  it('extracts tag content and trims', () => {
    expect(xt('a[POST]  hi  [/POST]b', 'POST')).toBe('hi');
  });
  it('returns empty string when tag missing', () => {
    expect(xt('nothing', 'POST')).toBe('');
  });
});

describe('parseList', () => {
  it('strips bullets/digits and drops empties', () => {
    expect(parseList('- one\n2. two\n\n• three')).toEqual(['one', 'two', 'three']);
  });
});

describe('parsePrinciples', () => {
  it('parses the "עקרון: X → איך התבטא: Y" shape', () => {
    const out = parsePrinciples('- עקרון: "ندرة" → איך התבטא: הוספתי טיימר');
    expect(out[0].principle).toBe('ندرة');
    expect(out[0].application).toBe('הוספתי טיימר');
  });
  it('falls back to arrow split', () => {
    const out = parsePrinciples('- proof → added testimonials');
    expect(out[0]).toEqual({ principle: 'proof', application: 'added testimonials' });
  });
});

describe('stripFence', () => {
  it('removes ```json fences', () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('MASTER_NOTES_MAX', () => {
  it('is 2000', () => { expect(MASTER_NOTES_MAX).toBe(2000); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/index.test.ts`
Expected: FAIL — cannot resolve `@/lib/master-studio` (folder/index not created yet).

- [ ] **Step 3: Create the module index**

Move shared pieces out of the old `lib/master-studio.ts`. Create `lib/master-studio/index.ts`:

```ts
// ════════════════════════════════════════════
// Master Studio — shared types & parse helpers
// ════════════════════════════════════════════
import type { MarketerId } from '@/lib/marketers';
import type { FrameworkId } from '@/lib/frameworks';
import type { BrandDNA } from '@/types';

export const MASTER_NOTES_MAX = 2000;

export interface MasterStudioInput {
  brief:        string;
  brand?:       BrandDNA;
  masterNotes?: string;
  platform:     string;
  tone?:        string;
  type?:        string;
  framework?:   FrameworkId;
  hook?:        string;
  locale?:      'he' | 'en' | 'ar';
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
  'hook_strength', 'clarity', 'emotional_resonance', 'cta_strength',
  'brand_fit', 'awareness_match', 'framework_adherence',
] as const;
export type ScoreDim = typeof SCORE_DIMS[number];

export interface VariantScore {
  index: number; score: number; dims: Record<ScoreDim, number>; note: string;
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
```

Then delete the old file:

```bash
git rm lib/master-studio.ts
```

> If `lib/master-studio.ts` has other importers (the `/create` page imports `composeMasterPrompt`, `parseMasterResponse`, `MASTER_NOTES_MAX`), they will break until Task 9 rewires the page. That is expected; the build is fixed by Task 9. Type-check is run at Task 12. To keep intermediate commits green, leave the page untouched until Task 9 and accept that `npm run build` is not run until then.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/index.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit (local checkpoint — do not push)**

```bash
git add lib/master-studio/index.ts tests/master-studio/index.test.ts
git rm lib/master-studio.ts
git commit -m "refactor(master-studio): extract shared core into module index"
```

---

### Task 2: Strategist stage

**Files:**
- Create: `lib/master-studio/strategist.ts`
- Test: `tests/master-studio/strategist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/strategist.test.ts
import { describe, it, expect } from 'vitest';
import { composeStrategistPrompt, parseStrategist } from '@/lib/master-studio/strategist';

describe('composeStrategistPrompt', () => {
  it('embeds brief, master notes and asks for top-3', () => {
    const { system, user } = composeStrategistPrompt({
      brief: 'קורס יוגה לנשים אחרי לידה', platform: 'Instagram',
      masterNotes: 'אל תזכיר מחיר',
    });
    expect(user).toContain('קורס יוגה');
    expect(system).toContain('אל תזכיר מחיר');           // master notes injected
    expect(system).toContain('RANKED_MARKETERS');         // contract present
    expect(system).toContain('AVATAR_PROFILE');
  });
});

describe('parseStrategist', () => {
  const raw = `[AVATAR_PROFILE]
persona: אמא טרייה בת 30
fears: לא לחזור לעצמה
desires: ביטחון בגוף
awareness_level: 2 - בעיה מודעת
objections: אין זמן
[/AVATAR_PROFILE]
[RANKED_MARKETERS]
1. halbert|Gary Halbert|🔥|סטוריטלינג רגשי
2. cialdini|Robert Cialdini|🧲|הוכחה חברתית
3. hormozi|Alex Hormozi|💰|הצעה שלא מסרבים
[/RANKED_MARKETERS]`;

  it('parses avatar and exactly 3 valid marketers', () => {
    const out = parseStrategist(raw);
    expect(out.avatar?.persona).toBe('אמא טרייה בת 30');
    expect(out.ranked.map(m => m.id)).toEqual(['halbert', 'cialdini', 'hormozi']);
    expect(out.ranked[0].why).toContain('סטוריטלינג');
  });

  it('pads to 3 from the corpus when fewer valid ids returned', () => {
    const out = parseStrategist(`[RANKED_MARKETERS]\n1. halbert|Gary|🔥|x\n[/RANKED_MARKETERS]`);
    expect(out.ranked).toHaveLength(3);
    expect(out.ranked[0].id).toBe('halbert');
    expect(new Set(out.ranked.map(m => m.id)).size).toBe(3); // distinct
  });

  it('drops unknown ids and dedupes', () => {
    const out = parseStrategist(`[RANKED_MARKETERS]\n1. bogus|x|x|x\n2. ogilvy|O|🎩|y\n3. ogilvy|O|🎩|y\n[/RANKED_MARKETERS]`);
    expect(out.ranked).toHaveLength(3);
    expect(out.ranked.filter(m => m.id === 'ogilvy')).toHaveLength(1);
    expect(out.ranked.every(m => m.id !== 'bogus')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/strategist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/strategist.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (local)**

```bash
git add lib/master-studio/strategist.ts tests/master-studio/strategist.test.ts
git commit -m "feat(master-studio): strategist stage (avatar + top-3 marketers)"
```

---

### Task 3: Creator stage

**Files:**
- Create: `lib/master-studio/creator.ts`
- Test: `tests/master-studio/creator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/creator.test.ts
import { describe, it, expect } from 'vitest';
import { composeCreatorPrompt, parseCreator } from '@/lib/master-studio/creator';
import { MARKETERS_BY_ID } from '@/lib/marketers';

const avatar = { persona: 'אמא טרייה', fears: 'x', desires: 'y', awareness_level: '2', objections: 'z' };

describe('composeCreatorPrompt', () => {
  it('embeds the assigned marketer name and the avatar persona', () => {
    const { system, user } = composeCreatorPrompt(
      { brief: 'קורס יוגה', platform: 'Instagram' }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toContain(MARKETERS_BY_ID.halbert.name);
    expect(system).toContain('אמא טרייה');
    expect(system).toContain('[POST]');
    expect(user).toContain('קורס יוגה');
  });
  it('forces framework when locked', () => {
    const { system } = composeCreatorPrompt(
      { brief: 'x', platform: 'FB', framework: 'pas' }, MARKETERS_BY_ID.halbert, avatar);
    expect(system).toMatch(/PAS|pas/);
  });
});

describe('parseCreator', () => {
  it('parses a full post block', () => {
    const raw = `[PRINCIPLES_APPLIED]\n- עקרון: "story" → איך התבטא: פתחתי בסיפור\n[/PRINCIPLES_APPLIED]
[POST]בוקר טוב אמהות 🌸[/POST][HASHTAGS]#יוגה #אמהות[/HASHTAGS]
[IMAGE_PROMPT]a calm yoga studio[/IMAGE_PROMPT][TIPS]פרסמי בבוקר[/TIPS][WHATSAPP]היי, יש קורס[/WHATSAPP]`;
    const d = parseCreator(raw)!;
    expect(d.post).toContain('בוקר טוב');
    expect(d.hashtags).toEqual(['#יוגה', '#אמהות']);
    expect(d.image).toBe('a calm yoga studio');
    expect(d.principles[0].principle).toBe('story');
  });
  it('returns null when [POST] missing', () => {
    expect(parseCreator('[HASHTAGS]#x[/HASHTAGS]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/creator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/master-studio/creator.ts
import { marketerToPromptBlock, type Marketer } from '@/lib/marketers';
import { FRAMEWORKS_BY_ID } from '@/lib/frameworks';
import {
  type MasterStudioInput, type AvatarProfile, type VariantDraft,
  MASTER_NOTES_MAX, localeWord, parsePostTags,
} from './index';

export function composeCreatorPrompt(
  input: MasterStudioInput, marketer: Marketer, avatar: AvatarProfile | null,
): { system: string; user: string } {
  const notes = (input.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const fw = input.framework
    ? `Forced framework: ${input.framework} (${FRAMEWORKS_BY_ID[input.framework]?.name_en ?? input.framework}) — MUST use this`
    : `Framework: use ${marketer.name}'s preferred framework`;
  const hook = input.hook ? `Forced hook style: ${input.hook} — MUST open this way` : 'Hook: pick the strongest for this avatar';
  const avatarBlock = avatar
    ? `persona: ${avatar.persona}\nfears: ${avatar.fears}\ndesires: ${avatar.desires}\nawareness: ${avatar.awareness_level}\nobjections: ${avatar.objections}`
    : '— (infer from brief) —';

  const system = `אתה ${marketer.name} ${marketer.emoji}. גלם אותו במלואו — קולו, signature moves, ה-framework המועדף שלו.

כתוב ${localeWord(input.locale)}.

═══ MASTER NOTES (🔒 עדיפות עליונה) ═══
${notes || '— אין —'}

═══ המשווק שאתה מגלם ═══
${marketerToPromptBlock(marketer)}

═══ אווטאר היעד ═══
${avatarBlock}

═══ OVERRIDES ═══
- ${fw}
- ${hook}
- Platform: ${input.platform} | Tone: ${input.tone ?? '—'} | Post type: ${input.type ?? '—'}

═══ OUTPUT CONTRACT (החזר רק את התגיות, בסדר הזה) ═══
[PRINCIPLES_APPLIED]
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המלא עם אמוג'ים וקריאה לפעולה[/POST]
[HASHTAGS]12-15 האשטגים[/HASHTAGS]
[IMAGE_PROMPT]Detailed English prompt for image generation[/IMAGE_PROMPT]
[TIPS]3 טיפים לפרסום[/TIPS]
[WHATSAPP]גרסה קצרה לוואטסאפ[/WHATSAPP]`;

  const user = `בריף: ${input.brief}`;
  return { system, user };
}

export function parseCreator(raw: string): VariantDraft | null {
  return parsePostTags(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/creator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit (local)**

```bash
git add lib/master-studio/creator.ts tests/master-studio/creator.test.ts
git commit -m "feat(master-studio): creator stage (marketer-voiced post)"
```

---

### Task 4: Judge stage

**Files:**
- Create: `lib/master-studio/judge.ts`
- Test: `tests/master-studio/judge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/judge.test.ts
import { describe, it, expect } from 'vitest';
import { composeJudgePrompt, parseJudge } from '@/lib/master-studio/judge';

const variants = [
  { marketer: { id: 'halbert', name: 'Gary Halbert', emoji: '🔥' }, draft: { post: 'פוסט א', hashtags: [], image: '', tips: '', whatsapp: '', principles: [] } },
  { marketer: { id: 'cialdini', name: 'Robert Cialdini', emoji: '🧲' }, draft: { post: 'פוסט ב', hashtags: [], image: '', tips: '', whatsapp: '', principles: [] } },
];

describe('composeJudgePrompt', () => {
  it('numbers each variant and lists scoring dims', () => {
    const { system, user } = composeJudgePrompt(variants as any, { brief: 'x', platform: 'FB' });
    expect(user).toContain('Variant 0');
    expect(user).toContain('Variant 1');
    expect(user).toContain('פוסט א');
    expect(system).toContain('hook_strength');
    expect(system).toContain('winner_index');
  });
});

describe('parseJudge', () => {
  const valid = JSON.stringify({
    variants: [
      { index: 0, score: 88, dims: { hook_strength: 90, clarity: 85, emotional_resonance: 92, cta_strength: 80, brand_fit: 88, awareness_match: 90, framework_adherence: 86 }, note: 'חזק' },
      { index: 1, score: 74, dims: { hook_strength: 70, clarity: 80, emotional_resonance: 72, cta_strength: 70, brand_fit: 75, awareness_match: 74, framework_adherence: 78 }, note: 'בסדר' },
    ],
    winner_index: 0, rationale: 'הראשון רגשי יותר',
  });

  it('parses scores, winner and rationale', () => {
    const r = parseJudge(valid, 2)!;
    expect(r.winnerIndex).toBe(0);
    expect(r.scores).toHaveLength(2);
    expect(r.scores[0].score).toBe(88);
    expect(r.rationale).toContain('רגשי');
  });
  it('strips ```json fences', () => {
    expect(parseJudge('```json\n' + valid + '\n```', 2)).not.toBeNull();
  });
  it('returns null on invalid json', () => {
    expect(parseJudge('not json', 2)).toBeNull();
  });
  it('falls back winner to highest score when winner_index out of range', () => {
    const bad = JSON.parse(valid); bad.winner_index = 9;
    const r = parseJudge(JSON.stringify(bad), 2)!;
    expect(r.winnerIndex).toBe(0); // index 0 has score 88 > 74
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/judge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/master-studio/judge.ts
import {
  type MasterStudioInput, type MarketerPick, type VariantDraft,
  type JudgeResult, type VariantScore, SCORE_DIMS, type ScoreDim,
  localeWord, stripFence,
} from './index';

export interface JudgeVariant { marketer: MarketerPick; draft: VariantDraft; }

export function composeJudgePrompt(
  variants: JudgeVariant[], input: MasterStudioInput,
): { system: string; user: string } {
  const system = `אתה שופט קופי שיווקי שדירג 250,000 מודעות. נקד כל גרסה 0-100 לפי פוטנציאל CTR והמרה ${localeWord(input.locale)}.

ממדי ניקוד (כל אחד 0-100): ${SCORE_DIMS.join(', ')}.
ה-score הסופי לכל גרסה הוא שקלול הממדים.

═══ OUTPUT CONTRACT — החזר אובייקט JSON תקין אחד בלבד, ללא markdown ═══
{
  "variants": [
    { "index": 0, "score": <0-100>, "dims": { ${SCORE_DIMS.map(d => `"${d}": <0-100>`).join(', ')} }, "note": "<משפט>" }
  ],
  "winner_index": <int>,
  "rationale": "<2-3 משפטים למה המנצח ניצח>"
}`;

  const body = variants.map((v, i) =>
    `── Variant ${i} (${v.marketer.name}) ──\n${v.draft.post}`).join('\n\n');
  const user = `פלטפורמה: ${input.platform}\nבריף: ${input.brief}\n\n${body}`;
  return { system, user };
}

function clamp(n: unknown): number {
  const x = Number(n); if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function parseJudge(raw: string, variantCount: number): JudgeResult | null {
  let obj: any;
  try { obj = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!obj || !Array.isArray(obj.variants) || obj.variants.length === 0) return null;

  const scores: VariantScore[] = obj.variants.slice(0, variantCount).map((v: any, i: number) => {
    const dims = {} as Record<ScoreDim, number>;
    for (const d of SCORE_DIMS) dims[d] = clamp(v?.dims?.[d]);
    return {
      index: Number.isInteger(v?.index) ? v.index : i,
      score: clamp(v?.score),
      dims,
      note: typeof v?.note === 'string' ? v.note : '',
    };
  });
  if (scores.length === 0) return null;

  let winnerIndex = Number(obj.winner_index);
  const valid = scores.some(s => s.index === winnerIndex);
  if (!valid) {
    winnerIndex = scores.reduce((best, s) => (s.score > best.score ? s : best), scores[0]).index;
  }
  return { scores, winnerIndex, rationale: typeof obj.rationale === 'string' ? obj.rationale : '' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/judge.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit (local)**

```bash
git add lib/master-studio/judge.ts tests/master-studio/judge.test.ts
git commit -m "feat(master-studio): judge stage (0-100 scorecard + winner)"
```

---

### Task 5: Editor stage

**Files:**
- Create: `lib/master-studio/editor.ts`
- Test: `tests/master-studio/editor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/editor.test.ts
import { describe, it, expect } from 'vitest';
import { composeEditorPrompt, parseEditor } from '@/lib/master-studio/editor';

const draft = { post: 'פוסט חלש', hashtags: ['#x'], image: 'img', tips: 't', whatsapp: 'w', principles: [] };
const marketer = { id: 'halbert', name: 'Gary Halbert', emoji: '🔥' };
const score = { index: 0, score: 64, dims: { hook_strength: 50, clarity: 80, emotional_resonance: 55, cta_strength: 60, brand_fit: 70, awareness_match: 68, framework_adherence: 66 }, note: 'hook חלש' };

describe('composeEditorPrompt', () => {
  it('includes the weak dims and the original post', () => {
    const { system, user } = composeEditorPrompt(draft as any, marketer as any, score as any, { brief: 'x', platform: 'FB' });
    expect(user).toContain('פוסט חלש');
    expect(system).toContain('hook_strength');   // names a dim to lift
    expect(system).toContain(marketer.name);
    expect(system).toContain('[POST]');
  });
});

describe('parseEditor', () => {
  it('parses the rewritten post (reuses post-tag parser)', () => {
    const d = parseEditor('[POST]פוסט משופר[/POST][HASHTAGS]#y[/HASHTAGS]')!;
    expect(d.post).toBe('פוסט משופר');
    expect(d.hashtags).toEqual(['#y']);
  });
  it('returns null when no [POST]', () => {
    expect(parseEditor('nothing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/editor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/master-studio/editor.ts
import { type Marketer } from '@/lib/marketers';
import {
  type MasterStudioInput, type VariantDraft, type VariantScore, type MarketerPick,
  SCORE_DIMS, MASTER_NOTES_MAX, localeWord, parsePostTags,
} from './index';

export function composeEditorPrompt(
  draft: VariantDraft, marketer: MarketerPick | Marketer, score: VariantScore, input: MasterStudioInput,
): { system: string; user: string } {
  const notes = (input.masterNotes ?? '').trim().slice(0, MASTER_NOTES_MAX);
  const weak = SCORE_DIMS
    .map(d => ({ d, v: score.dims[d] }))
    .sort((a, b) => a.v - b.v).slice(0, 3)
    .map(x => `${x.d} (${x.v})`).join(', ');

  const system = `אתה ${marketer.name} ${marketer.emoji} עורך גרסה קודמת של הפוסט. שמור על הקול, ה-framework וה-Master Notes — אבל חזק את הממדים החלשים: ${weak}.

כתוב ${localeWord(input.locale)}.

═══ MASTER NOTES (🔒 עדיפות עליונה) ═══
${notes || '— אין —'}

═══ OUTPUT CONTRACT (אותן תגיות בדיוק) ═══
[PRINCIPLES_APPLIED]
- עקרון: "<שם>" → איך התבטא: <משפט קצר>
[/PRINCIPLES_APPLIED]
[POST]הפוסט המשופר[/POST]
[HASHTAGS]...[/HASHTAGS]
[IMAGE_PROMPT]...[/IMAGE_PROMPT]
[TIPS]...[/TIPS]
[WHATSAPP]...[/WHATSAPP]`;

  const user = `בריף: ${input.brief}\n\nהגרסה הקודמת (ציון ${score.score}):\n${draft.post}`;
  return { system, user };
}

export function parseEditor(raw: string): VariantDraft | null {
  return parsePostTags(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/editor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (local)**

```bash
git add lib/master-studio/editor.ts tests/master-studio/editor.test.ts
git commit -m "feat(master-studio): editor stage (critique + rewrite weak dims)"
```

---

### Task 6: Pipeline orchestrator (the heart — fully unit-tested with a mock runner)

**Files:**
- Create: `lib/master-studio/pipeline.ts`
- Test: `tests/master-studio/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { runMasterPipeline } from '@/lib/master-studio/pipeline';

const STRAT = `[AVATAR_PROFILE]\npersona: אמא\nfears: x\ndesires: y\nawareness_level: 2\nobjections: z\n[/AVATAR_PROFILE]
[RANKED_MARKETERS]\n1. halbert|Gary|🔥|a\n2. cialdini|Rob|🧲|b\n3. hormozi|Alex|💰|c\n[/RANKED_MARKETERS]`;
const POST = (t: string) => `[POST]${t}[/POST][HASHTAGS]#x[/HASHTAGS][IMAGE_PROMPT]i[/IMAGE_PROMPT][TIPS]t[/TIPS][WHATSAPP]w[/WHATSAPP]`;
const judge = (winner: number, winnerScore: number) => JSON.stringify({
  variants: [0, 1, 2].map(i => ({ index: i, score: i === winner ? winnerScore : 50,
    dims: { hook_strength: 50, clarity: 50, emotional_resonance: 50, cta_strength: 50, brand_fit: 50, awareness_match: 50, framework_adherence: 50 }, note: '' })),
  winner_index: winner, rationale: 'כי כן',
});

// Build a runner that answers by stage, detected from the system prompt text.
function runner(map: { strat?: string; creators?: (string | null)[]; judge?: string; editor?: string }) {
  let creatorCall = 0;
  return async (system: string, _user: string) => {
    if (system.includes('אסטרטג'))   return map.strat ?? STRAT;
    if (system.includes('שופט'))      return map.judge ?? judge(0, 90);
    if (system.includes('עורך'))      return map.editor ?? POST('משופר');
    // creator
    const r = map.creators?.[creatorCall] ?? POST(`variant ${creatorCall}`);
    creatorCall++;
    return r ?? '';
  };
}
const input = { brief: 'קורס יוגה', platform: 'Instagram' };

describe('runMasterPipeline', () => {
  it('happy path: returns winner, marketers, scores; no boost when score >= 80', async () => {
    const res = await runMasterPipeline(input, runner({ judge: judge(1, 92) }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.marketers).toHaveLength(3);
      expect(res.output.winner.marketer.id).toBe('cialdini'); // survivor index 1
      expect(res.output.winner.score).toBe(92);
      expect(res.output.boosted).toBe(false);
      expect(res.output.scores).toHaveLength(3);
    }
  });

  it('runs the editor and sets boosted when winner score < 80', async () => {
    const res = await runMasterPipeline(input, runner({ judge: judge(0, 64), editor: POST('הרבה יותר חזק') }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.boosted).toBe(true);
      expect(res.output.winner.draft.post).toBe('הרבה יותר חזק');
    }
  });

  it('editor failure falls back to original winner (still ok, boosted false)', async () => {
    const res = await runMasterPipeline(input, runner({ judge: judge(0, 50), editor: 'garbage no tags' }) as any);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output.boosted).toBe(false);
      expect(res.output.winner.draft.post).toBe('variant 0');
    }
  });

  it('refunds (ok:false) when fewer than 2 creators parse', async () => {
    const res = await runMasterPipeline(input, runner({ creators: [POST('only one'), null, null] }) as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('creators');
  });

  it('refunds when judge returns invalid json', async () => {
    const res = await runMasterPipeline(input, runner({ judge: 'not json at all' }) as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('judge');
  });
});
```

> The mock runner returns `null` (→ empty string) for dropped creators; `parseCreator('')` yields `null`, simulating a failed variant.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/master-studio/pipeline.ts
import { MARKETERS_BY_ID, type Marketer } from '@/lib/marketers';
import { composeStrategistPrompt, parseStrategist } from './strategist';
import { composeCreatorPrompt, parseCreator } from './creator';
import { composeJudgePrompt, parseJudge, type JudgeVariant } from './judge';
import { composeEditorPrompt, parseEditor } from './editor';
import { type MasterStudioInput, type MasterV2Output } from './index';

/** Calls Claude with a (system, user) prompt and returns the raw text. */
export type StageRunner = (system: string, user: string, maxTokens: number) => Promise<string>;

export type PipelineResult =
  | { ok: true; output: MasterV2Output }
  | { ok: false; reason: 'strategist' | 'creators' | 'judge' };

const BOOST_THRESHOLD = 80;

export async function runMasterPipeline(
  input: MasterStudioInput, run: StageRunner,
): Promise<PipelineResult> {
  // A. Strategist
  const sp = composeStrategistPrompt(input);
  const strat = parseStrategist(await run(sp.system, sp.user, 800));
  if (strat.ranked.length === 0) return { ok: false, reason: 'strategist' };

  // B. Creators (parallel) — each ranked marketer writes one post.
  const drafts = await Promise.all(strat.ranked.map(async (m) => {
    const marketer = (MARKETERS_BY_ID as Record<string, Marketer>)[m.id as string];
    if (!marketer) return null;
    try {
      const cp = composeCreatorPrompt(input, marketer, strat.avatar);
      return parseCreator(await run(cp.system, cp.user, 1500));
    } catch { return null; }
  }));

  const survivors: JudgeVariant[] = [];
  drafts.forEach((d, i) => { if (d) survivors.push({ marketer: strat.ranked[i], draft: d }); });
  if (survivors.length < 2) return { ok: false, reason: 'creators' };

  // C. Judge
  const jp = composeJudgePrompt(survivors, input);
  const judge = parseJudge(await run(jp.system, jp.user, 1000), survivors.length);
  if (!judge) return { ok: false, reason: 'judge' };

  const winnerIdx = survivors[judge.winnerIndex] ? judge.winnerIndex : 0;
  const winnerScore = judge.scores.find(s => s.index === winnerIdx)?.score ?? 100;
  let winnerDraft = survivors[winnerIdx].draft;
  let boosted = false;

  // D. Editor (conditional)
  if (winnerScore < BOOST_THRESHOLD) {
    try {
      const scoreObj = judge.scores.find(s => s.index === winnerIdx)!;
      const ep = composeEditorPrompt(winnerDraft, survivors[winnerIdx].marketer, scoreObj, input);
      const edited = parseEditor(await run(ep.system, ep.user, 1500));
      if (edited) { winnerDraft = edited; boosted = true; }
    } catch { /* fall back to original winner */ }
  }

  return {
    ok: true,
    output: {
      avatar: strat.avatar,
      marketers: survivors.map(s => s.marketer),
      winner: { marketer: survivors[winnerIdx].marketer, draft: winnerDraft, score: winnerScore },
      scores: judge.scores,
      judgeRationale: judge.rationale,
      boosted,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/pipeline.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — all master-studio tests + existing scoring/policy tests green.

- [ ] **Step 6: Commit (local)**

```bash
git add lib/master-studio/pipeline.ts tests/master-studio/pipeline.test.ts
git commit -m "feat(master-studio): pipeline orchestrator with refund logic"
```

---

### Task 7: Bump credit cost 4 → 6

**Files:**
- Modify: `types/index.ts` (the `CREDIT_COSTS` map entry for `master_post`)
- Test: `tests/master-studio/credit-cost.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/master-studio/credit-cost.test.ts
import { describe, it, expect } from 'vitest';
import { CREDIT_COSTS } from '@/types';

describe('master_post credit cost', () => {
  it('is 6 for the best-of-N pipeline', () => {
    expect(CREDIT_COSTS.master_post).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/master-studio/credit-cost.test.ts`
Expected: FAIL — `expected 4 to be 6`.

- [ ] **Step 3: Implement**

In `types/index.ts`, change the `CREDIT_COSTS` entry:

```ts
  master_post: 6,   // best-of-N: strategist + 3 creators + judge + optional editor
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/master-studio/credit-cost.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (local)**

```bash
git add types/index.ts tests/master-studio/credit-cost.test.ts
git commit -m "feat(master-studio): bump master_post cost 4->6 for best-of-N"
```

---

### Task 8: Server route `/api/ai/master`

**Files:**
- Create: `app/api/ai/master/route.ts`

> This route is integration-level (calls Anthropic + Supabase) and is verified by type-check + build + manual run, not a unit test. The orchestration logic it depends on is already fully tested in Task 6.

- [ ] **Step 1: Implement the route**

```ts
// app/api/ai/master/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';
import { runMasterPipeline, type StageRunner } from '@/lib/master-studio/pipeline';
import { type MasterStudioInput } from '@/lib/master-studio';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit: best-of-N is expensive — 10 master calls / minute / user.
  const rl = checkRateLimit(`master:${user.id}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
  }

  const body = await req.json();
  const { brief, masterNotes, platform, tone, type, framework, hook, locale, client_id, brief_id } = body as
    MasterStudioInput & { client_id?: string | null; brief_id?: string | null };

  if (!brief?.trim() || !platform) {
    return NextResponse.json({ error: 'Missing fields: brief, platform' }, { status: 400 });
  }

  // Brand DNA + active client + brief context (prepended to every stage system prompt).
  const activeClientId = client_id ?? readActiveClientCookie(req.headers.get('cookie') ?? '');
  const ctx = await buildAiContext(supabase, { userId: user.id, clientId: activeClientId, briefId: brief_id ?? null });
  const ctxPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

  // Deduct 6 credits once, up front.
  const deduct = await deductCredits(supabase, user.id, 'master_post');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  // Anthropic-backed stage runner. Brand context is prepended to each stage's system prompt.
  const run: StageRunner = async (system, userPrompt, maxTokens) => {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: ctxPrefix + system,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const block = msg.content.find(b => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  };

  const input: MasterStudioInput = { brief, masterNotes, platform, tone, type, framework, hook, locale };

  let result;
  try {
    result = await runMasterPipeline(input, run);
  } catch (e) {
    await refundCredits(supabase, user.id, 'master_post');
    return NextResponse.json({ error: 'נכשל ביצירה — נסה שוב', detail: String(e).slice(0, 200) }, { status: 502 });
  }

  if (!result.ok) {
    await refundCredits(supabase, user.id, 'master_post');
    return NextResponse.json({ error: 'תוצאה חלקית — נסה שוב', reason: result.reason }, { status: 502 });
  }

  // Persist for history/analytics (best-effort; do not fail the request on insert error).
  const out = result.output;
  await supabase.from('generated_content').insert({
    user_id: user.id,
    client_id: activeClientId ?? null,
    type: 'master_post',
    content: out.winner.draft.post,
    meta: {
      avatar: out.avatar, marketers: out.marketers, winner: out.winner.marketer,
      scores: out.scores, why: out.judgeRationale, boosted: out.boosted,
    },
  });

  return NextResponse.json({ ...out, credits: deduct.credits });
}
```

> Verify field names against the existing `/api/ai/route.ts` insert into `generated_content` (column names `type`, `content`, `meta`, `client_id`). If the existing route uses different column names, match them exactly — read `app/api/ai/route.ts` around its insert before finalizing.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS (no errors in the new route).

- [ ] **Step 3: Commit (local)**

```bash
git add app/api/ai/master/route.ts
git commit -m "feat(master-studio): /api/ai/master orchestration route (6 credits, refund on failure)"
```

---

### Task 9: Rewire `/create` page — call the route, staged progress, enriched reveal

**Files:**
- Modify: `app/(dashboard)/create/page.tsx`

> Read the current file first. It imports `composeMasterPrompt`/`parseMasterResponse`/`MASTER_NOTES_MAX` from `@/lib/master-studio` and calls `useAI.call('master_post', …)`. Replace that path. Keep all existing UI (platform/tone/type chips, Master Notes textarea, Override chips, output tabs, the `/images` handoff button, ScoreBadge/Boost integration) intact — only swap the generate call and the reveal panel.

- [ ] **Step 1: Replace the generate handler**

Remove the `composeMasterPrompt`/`parseMasterResponse` import (keep `MASTER_NOTES_MAX` — it still comes from `@/lib/master-studio`). Replace the generate function body with a direct fetch and a staged progress signal:

```tsx
// state near the other useState calls:
const [stage, setStage] = useState<0 | 1 | 2 | 3>(0); // 0 idle,1 strategist,2 creators+judge,3 editor
const STAGE_LABELS = ['', 'מנתח קהל ובוחר 3 משווקים…', '3 משווקים כותבים + השופט בוחר…', 'משייף את הזוכה…'];

async function generate() {
  if (!brief.trim()) return;
  setLoading(true); setStage(1); setOutput(null);
  // optimistic stage ticker (no SSE in v1): advance the label on a timer
  const t1 = setTimeout(() => setStage(2), 12_000);
  const t2 = setTimeout(() => setStage(3), 75_000);
  try {
    const res = await fetch('/api/ai/master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brief, masterNotes, platform, tone, type: postType,
        framework: lockedFramework || undefined, hook: lockedHook || undefined, locale: 'he',
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error ?? 'שגיאה'); return; }
    setOutput(data);              // data is MasterV2Output + { credits }
    setCredits(data.credits);
  } catch {
    toast('שגיאת רשת — נסה שוב');
  } finally {
    clearTimeout(t1); clearTimeout(t2); setLoading(false); setStage(0);
  }
}
```

> Adapt variable names (`brief`, `masterNotes`, `platform`, `tone`, `postType`, `lockedFramework`, `lockedHook`, `setOutput`, `setCredits`, `toast`) to whatever the current file already uses. The output shape changes: the winning post is now `output.winner.draft.post` (was the flat `out.post`), hashtags `output.winner.draft.hashtags`, image `output.winner.draft.image`, tips `output.winner.draft.tips`, whatsapp `output.winner.draft.whatsapp`. Update every reference in the tabs/handoff accordingly. The `/images` handoff href becomes:
> `href={\`/images?prompt=${encodeURIComponent(output.winner.draft.image.slice(0, 2000))}\`}`

- [ ] **Step 2: Loading state shows the staged label**

Where the loading spinner renders, show `STAGE_LABELS[stage]` when `loading`.

- [ ] **Step 3: Enriched "🧠 למה זה עובד" panel**

Replace the old reveal panel body with one driven by the new shape:

```tsx
{output && (
  <div className="rounded-xl border border-[#E5C158]/40 bg-[#FFFBF0] p-4 space-y-3">
    <div className="flex items-center gap-2 font-semibold">
      <span className="text-xl">{output.winner.marketer.emoji}</span>
      <span>{output.winner.marketer.name}</span>
      <span className="ml-auto text-sm rounded-full bg-[#0A7AFF] text-white px-2 py-0.5">
        ציון {output.winner.score}
      </span>
      {output.boosted && <span className="text-xs rounded-full bg-emerald-500 text-white px-2 py-0.5">שופר ✨</span>}
    </div>
    <p className="text-sm text-gray-600">
      התחרה מול: {output.marketers.filter(m => m.id !== output.winner.marketer.id).map(m => `${m.emoji} ${m.name}`).join(' · ')}
    </p>
    <p className="text-sm">{output.judgeRationale}</p>
    {output.avatar && (
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">👤 פרופיל האווטאר</summary>
        <div className="mt-1 space-y-0.5 text-gray-700">
          <div>פרסונה: {output.avatar.persona}</div>
          <div>פחדים: {output.avatar.fears}</div>
          <div>רצונות: {output.avatar.desires}</div>
          <div>מודעות: {output.avatar.awareness_level}</div>
          <div>התנגדויות: {output.avatar.objections}</div>
        </div>
      </details>
    )}
  </div>
)}
```

> Style classes are illustrative — match the file's existing Tailwind conventions and the gold/blue palette already used.

- [ ] **Step 4: Update the credit-cost label**

Change the button/cost label from `4⚡` to `6⚡` wherever the Master Studio cost is shown.

- [ ] **Step 5: Type-check + build**

Run: `npm run type-check && npm run build`
Expected: PASS — no dangling imports, page compiles.

- [ ] **Step 6: Commit (local)**

```bash
git add app/(dashboard)/create/page.tsx
git commit -m "feat(master-studio): /create uses best-of-N route + enriched reveal panel"
```

---

### Task 10: Remove dead code + full suite

**Files:**
- Modify: `lib/master-studio/index.ts` (only if old `composeMasterPrompt`/`parseMasterResponse` were carried over — they should NOT have been; this is a verification step)

- [ ] **Step 1: Grep for stragglers**

Run: `grep -rn "composeMasterPrompt\|parseMasterResponse\|from '@/lib/master-studio'" app lib --include=*.ts --include=*.tsx`
Expected: every hit resolves to the new module API (`composeStrategistPrompt`, `parseStrategist`, `MASTER_NOTES_MAX`, types) — NO references to the removed `composeMasterPrompt`/`parseMasterResponse`. If any remain, fix the importer.

- [ ] **Step 2: Full suite + type-check + build**

Run: `npm test && npm run type-check && npm run build`
Expected: ALL PASS.

- [ ] **Step 3: Commit (local, only if changes were needed)**

```bash
git add -A lib app
git commit -m "chore(master-studio): remove dead single-shot path"
```

---

### Task 11: LLM-judge verification of the improvement (per user directive)

**Files:**
- Create: `scripts/verify-master-v2.mjs`

> Goal: prove v2 (best-of-N) beats v1 (single-shot) blind, using an independent judge — separate from the in-pipeline judge. Requires the dev server running and a logged-in QA session cookie (reuse the pattern in `scripts/verify-contacts-rls.mjs` / `scripts/qa-system-wide.mjs` for auth).

- [ ] **Step 1: Write the harness**

The script must:
1. Define ~5 representative briefs (varied: product launch, promo, trust-building, question-to-audience, pro-tip).
2. For each brief, capture a v1 output (the old single-shot prompt — keep a copy of the old `composeMasterPrompt`/`parseMasterResponse` inline in the script, or call a v1 snapshot) and a v2 output (POST `/api/ai/master`).
3. Send both posts (A/B order randomized per brief via the brief index parity so it's deterministic) to an independent judge call (Anthropic directly, a DIFFERENT scoring prompt than `lib/master-studio/judge.ts`) asking which post is the stronger Hebrew marketing post and why.
4. Tally wins. Print `v2 wins: X/5`.

```js
// scripts/verify-master-v2.mjs  (skeleton — fill the briefs + judge prompt)
import { readFileSync } from 'node:fs';
// load .env.local (same loader as scripts/verify-contacts-rls.mjs)
// BRIEFS = [ ... 5 objects { brief, platform } ... ]
// for each: v1 = await singleShot(brief); v2 = await fetch('/api/ai/master', ...)
// judge(a, b) -> 'A' | 'B' via Anthropic with an independent rubric
// account for randomized order; print "v2 wins: N/5"
```

- [ ] **Step 2: Run it**

Run: `npm run dev` (separate shell), then `node scripts/verify-master-v2.mjs`
Expected: prints a tally. **Ship gate: v2 must win the majority (≥3/5).** If it does not, capture which briefs lost and iterate on the Creator/Judge prompts before considering the feature done.

- [ ] **Step 3: Record the result**

Append the tally + date to the spec file's bottom (a "Verification result" line) so the outcome is durable.

- [ ] **Step 4: Commit (local)**

```bash
git add scripts/verify-master-v2.mjs docs/superpowers/specs/2026-05-31-master-studio-v2-best-of-n.md
git commit -m "test(master-studio): v1-vs-v2 LLM-judge verification harness + result"
```

---

### Task 12: Final verification + coordinated push

- [ ] **Step 1: Full gate**

Run: `npm test && npm run type-check && npm run build`
Expected: ALL PASS. (Per the verify-before-push rule — never push a broken state.)

- [ ] **Step 2: Coordinate the push**

The parallel DB session owns git. Before pushing: `git pull --rebase` first (so the DB session's commits are not clobbered), then surface to the user for the go-ahead to push the branch. Do NOT `git add -A` across the repo — the DB session has its own untracked files; stage only the Master Studio paths committed above.

- [ ] **Step 3: Adversarial review (optional, recommended)**

Spawn an independent review agent over the diff (correctness of refund logic, prompt-injection surface in the stage prompts, credit double-charge/leak) and address findings before merge.

---

## Self-Review

**Spec coverage:**
- §2 server route → Task 8. ✅
- §2 refactor into 4 stage modules → Tasks 1–5. ✅
- §3 Strategist/Creators/Judge/Editor → Tasks 2/3/4/5. ✅
- §3 top-3 compete, shared avatar → Task 2 (pad-to-3) + Task 6 (one creator per ranked, shared `strat.avatar`). ✅
- §4 credits 4→6, refund rules (<2 variants, no winner, strategist fail; editor non-fatal) → Task 7 + Task 6 (`PipelineResult` reasons) + Task 8 (refund calls). ✅
- §5 UX staged progress + enriched panel + cost label → Task 9. ✅
- §6 unit tests (parsers + orchestrator) → Tasks 1–7; type-check/build → Tasks 9/10/12; LLM-judge v1-vs-v2 → Task 11. ✅
- §7 non-goals (no SSE, no re-judge after editor, no corpus expansion) → respected (optimistic ticker in Task 9; single editor pass in Task 6). ✅

**Placeholder scan:** Task 11's script is a skeleton by necessity (briefs/judge rubric are authored at implementation) but its required behavior, ship gate (≥3/5), and run command are explicit. All other tasks contain complete code. No "TBD"/"add error handling" left.

**Type consistency:** `MasterStudioInput`, `AvatarProfile`, `MarketerPick`, `VariantDraft`, `VariantScore` (with `dims: Record<ScoreDim, number>`), `JudgeResult`, `StrategistResult`, `MasterV2Output`, `StageRunner`, `PipelineResult` all defined in Task 1 / Task 6 and used consistently downstream. `parsePostTags` (Task 1) is reused by `parseCreator` (Task 3) and `parseEditor` (Task 5). Judge `winner_index` (JSON) → `winnerIndex` (parsed) consistent. `runMasterPipeline(input, run)` signature matches Task 8's caller and Task 6's tests.
