# Performance Score — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Anyword-style Predictive Performance Score (0–100) to every generated variant in `create`, `variations`, and `refine`. Score panel shows demographic histogram, emotions, extracts, policy flags. "Boost" rewrites low-score variants up to 2 iterations.

**Architecture:** A new `scores` Supabase table persists every score. `lib/scoring.ts` composes the Claude prompt and parses a strict JSON response. Two API routes (`/api/ai/score` and `/api/ai/score/boost`) deduct credits via the existing `deductCredits` helper and refund on provider failure. Three React components (`<ScoreBadge>`, `<ScorePanel>`, `<BoostButton>`) plug into the three dashboard pages. Unit tests cover pure functions only (prompt composer, parser, policy rule matchers); routes and UI verified manually.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), Anthropic SDK (Claude Haiku 4.5), Tailwind (existing palette), Vitest (newly added for unit tests).

**Spec:** `docs/superpowers/specs/2026-05-27-admaster-3-features-design.md` (Feature A section).

---

## File Structure

**New files:**
- `lib/scoring.ts` — types, prompt composer, response parser
- `lib/policy-rules/meta.he.ts` — Meta ad policy patterns (Hebrew copy)
- `lib/policy-rules/google.he.ts` — Google Ads policy patterns (Hebrew copy)
- `app/api/ai/score/route.ts` — POST /api/ai/score
- `app/api/ai/score/boost/route.ts` — POST /api/ai/score/boost
- `components/ScoreBadge.tsx` — small color-coded pill
- `components/ScorePanel.tsx` — popover with histogram, emotion chips, extracts list, policy badges
- `components/BoostButton.tsx` — boost trigger w/ iteration counter
- `components/TopFiveFilter.tsx` — toggle for `variations` page
- `supabase/migrations/006_performance_score.sql` — `scores` table + indices + RLS
- `tests/scoring.test.ts` — unit tests for pure scoring functions
- `tests/policy-rules.test.ts` — unit tests for policy matchers
- `vitest.config.ts` — vitest config (root)

**Modified files:**
- `types/index.ts` — add `'score'` and `'score_boost'` to `CreditAction` union + `CREDIT_COSTS`
- `app/(dashboard)/create/page.tsx` — render `<ScoreBadge>` on Master Studio result; show panel on click
- `app/(dashboard)/variations/page.tsx` — render score per variant + `<TopFiveFilter>`
- `app/(dashboard)/refine/page.tsx` — render score per refined variant
- `package.json` — add vitest dev dep + test scripts

**Out of scope this phase** (deferred to Phase 1.5/2/3):
- `analyze` page integration (its backend is currently PARTIAL)
- AI Creative Tagging (Phase 2 spec)
- Hebrew Swipe File + Chrome Extension (Phase 3 spec)

---

## Task 1: Add credit actions to the type system

**Files:**
- Modify: `types/index.ts` (CreditAction union ~L7-31; CREDIT_COSTS ~L33-58)

- [ ] **Step 1: Add `score` and `score_boost` to the `CreditAction` union**

In `types/index.ts`, locate the `CreditAction` union (starts at line 7). Add two members at the end, before the closing `;`:

```ts
export type CreditAction =
  | 'post'
  | 'analyze'
  // ... (existing entries unchanged) ...
  | 'master_post'
  | 'recommend'
  // ── Performance Score (Phase 1) ──────────────
  | 'score'        // predictive performance score on a single copy
  | 'score_boost'; // rewrite + re-score iteration
```

- [ ] **Step 2: Add costs to `CREDIT_COSTS`**

In the same file, locate `CREDIT_COSTS` (starts ~L33). Add entries:

```ts
export const CREDIT_COSTS: Record<CreditAction, number> = {
  // ... existing entries unchanged ...
  master_post:   4,
  recommend:     0,
  // ── Performance Score (Phase 1) ──────────────
  score:         1,
  score_boost:   1,
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run type-check`
Expected: PASS (no errors). If errors appear in unrelated files, they are pre-existing and not in scope.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): add score + score_boost credit actions"
```

---

## Task 2: Create the `scores` table migration

**Files:**
- Create: `supabase/migrations/006_performance_score.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/006_performance_score.sql`:

```sql
-- ============================================================
-- AdMaster Pro — Schema Update v6 (Performance Score)
-- Predictive performance score for every generated variant.
-- Run AFTER 005_phase_c.sql
-- ============================================================

create table public.scores (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references public.users(id) on delete cascade not null,
  brand_id          uuid,  -- soft ref; admaster keeps brand on users.brand jsonb today
  source_kind       text not null check (source_kind in (
    'master_post','variation','refine','manual','saved_ad'
  )),
  source_id         uuid,                            -- soft ref to the originating row
  copy_text         text not null,
  channel           text not null check (channel in (
    'meta_feed','meta_story','meta_reel',
    'google_search','google_display',
    'email','sms','landing','tiktok'
  )),
  audience_segment  jsonb default '{}'::jsonb,
  locale            text not null default 'he' check (locale in ('he','en','ar')),
  score             int not null check (score between 0 and 100),
  band              text not null check (band in ('low','mid','high')),
  demographics      jsonb not null,                  -- {age: {...}, gender: {...}}
  emotions          text[] not null default '{}',
  extracts          jsonb not null default '{}'::jsonb,  -- {offerings:[], features:[], pains:[], benefits:[], ctas:[]}
  policy_flags      jsonb default '[]'::jsonb,
  predicted_hook    text,
  model_version     text not null default 'claude-haiku-4-5-v1',
  prompt_tokens     int,
  output_tokens     int,
  boost_iteration   int default 0,                   -- 0 = original, 1..n = boosted
  parent_score_id   uuid references public.scores(id) on delete set null,  -- chain boosts
  created_at        timestamptz default now()
);

create index idx_scores_user_created  on public.scores(user_id, created_at desc);
create index idx_scores_source        on public.scores(source_kind, source_id);
create index idx_scores_parent        on public.scores(parent_score_id) where parent_score_id is not null;

alter table public.scores enable row level security;
create policy "own_select" on public.scores for select using (auth.uid() = user_id);
create policy "own_insert" on public.scores for insert with check (auth.uid() = user_id);
create policy "own_delete" on public.scores for delete using (auth.uid() = user_id);
-- no update policy: scores are immutable; boosts create new rows
```

- [ ] **Step 2: Manually apply via Supabase**

The admaster project applies migrations via the Supabase SQL Editor (per README §2). Open the dashboard SQL editor, paste the migration above, and Run.

After running, confirm the table exists by running:
```sql
select column_name, data_type from information_schema.columns where table_name = 'scores' order by ordinal_position;
```
Expected: 18 rows, including `score (integer)`, `band (text)`, `demographics (jsonb)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/006_performance_score.sql
git commit -m "feat(db): scores table migration v6"
```

---

## Task 3: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDependencies + scripts)

- [ ] **Step 1: Install vitest**

Run: `npm i -D vitest @types/node`
Expected: vitest added to devDependencies; no peer-dep warnings.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

In `scripts`, add (keep existing entries):

```json
"test":       "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

Run: `npm test`
Expected: "No test files found" — this is correct because we haven't written tests yet.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore(test): add vitest with @/* alias"
```

---

## Task 4: `lib/scoring.ts` — types + system prompt

**Files:**
- Create: `lib/scoring.ts`
- Create: `tests/scoring.test.ts`

- [ ] **Step 1: Write the failing test for `composeScorePrompt`**

`tests/scoring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { composeScorePrompt } from '@/lib/scoring';

describe('composeScorePrompt', () => {
  it('includes the copy text and channel in the user prompt', () => {
    const { system, user } = composeScorePrompt({
      copy:    'בוא נגדיל לך את העסק פי 3 ב-90 יום',
      channel: 'meta_feed',
      locale:  'he',
    });
    expect(user).toContain('בוא נגדיל לך את העסק');
    expect(user).toContain('meta_feed');
    expect(system).toContain('JSON');                   // contract is JSON
    expect(system).toMatch(/Hebrew|עברית/);             // locale anchored
  });

  it('uses English anchor when locale=en', () => {
    const { system } = composeScorePrompt({ copy: 'Hello', channel: 'email', locale: 'en' });
    expect(system).toMatch(/English/);
  });

  it('appends brand DNA block when brand provided', () => {
    const { system } = composeScorePrompt({
      copy: 'x', channel: 'meta_feed', locale: 'he',
      brand: { name: 'MyShop', audience: 'בעלות עסקים' },
    });
    expect(system).toContain('MyShop');
    expect(system).toContain('בעלות עסקים');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — "Cannot find module '@/lib/scoring'".

- [ ] **Step 3: Write the minimal implementation**

`lib/scoring.ts`:
```ts
// ════════════════════════════════════════════
// Performance Score — prompt composition & parsing
// ════════════════════════════════════════════

import type { BrandDNA } from '@/types';

export type ScoreChannel =
  | 'meta_feed' | 'meta_story' | 'meta_reel'
  | 'google_search' | 'google_display'
  | 'email' | 'sms' | 'landing' | 'tiktok';

export type ScoreBand = 'low' | 'mid' | 'high';

export interface ScoreInput {
  copy:     string;
  channel:  ScoreChannel;
  locale?:  'he' | 'en' | 'ar';
  brand?:   BrandDNA;
  audience_segment?: {
    age_range?: string;        // e.g. "25-44"
    gender?:    'm' | 'f' | 'all';
    interests?: string[];
    custom_label?: string;
  };
}

export interface ScoreResult {
  score:         number;       // 0..100
  band:          ScoreBand;    // <40 low, 40-69 mid, 70+ high
  demographics:  { age: Record<string, number>; gender: { m: number; f: number } };
  emotions:      string[];     // ordered by salience
  extracts:      { offerings: string[]; features: string[]; pains: string[]; benefits: string[]; ctas: string[] };
  policy_flags:  Array<{ type: string; severity: 'info'|'warn'|'block'; issue: string }>;
  predicted_hook: 'question'|'callout'|'contrarian'|'stat'|'story'|'curiosity'|'urgency'|'social_proof'|'other';
}

const LANG_ANCHOR: Record<NonNullable<ScoreInput['locale']>, string> = {
  he: 'The copy is in Hebrew (עברית). Score using Hebrew-specific norms.',
  en: 'The copy is in English. Score using English-specific norms.',
  ar: 'The copy is in Arabic (العربية). Score using Arabic-specific norms.',
};

function brandBlock(brand?: BrandDNA): string {
  if (!brand) return '';
  const bits: string[] = [];
  if (brand.name)     bits.push(`Brand: ${brand.name}`);
  if (brand.audience) bits.push(`Audience: ${brand.audience}`);
  if (brand.tone)     bits.push(`Tone: ${brand.tone}`);
  if (brand.usp)      bits.push(`USP: ${brand.usp}`);
  if (brand.pains)    bits.push(`Audience pains: ${brand.pains}`);
  return bits.length ? `\n\n═══ BRAND CONTEXT ═══\n${bits.join('\n')}` : '';
}

export function composeScorePrompt(input: ScoreInput): { system: string; user: string } {
  const locale = input.locale ?? 'he';
  const langLine = LANG_ANCHOR[locale];

  const system = `You are a Hebrew-native performance copywriter who has graded 250,000 Israeli ads. Score each piece of ad copy on a 0-100 scale based on predicted CTR + conversion potential for the given channel and (if provided) audience.

${langLine}
${brandBlock(input.brand)}

═══ OUTPUT CONTRACT — return ONE valid JSON object, nothing else, no markdown, no commentary ═══
{
  "score": <int 0-100>,
  "band": "low" | "mid" | "high",         // <40 / 40-69 / 70+ — must match the score
  "demographics": {
    "age":    { "18-24": <0..1>, "25-34": <0..1>, "35-44": <0..1>, "45-54": <0..1>, "55+": <0..1> },
    "gender": { "m": <0..1>, "f": <0..1> }
  },
  "emotions":       ["urgency","social_proof", ...],     // up to 5, ordered by salience
  "extracts": {
    "offerings": [<string>, ...], "features": [<string>, ...],
    "pains":     [<string>, ...], "benefits": [<string>, ...],
    "ctas":      [<string>, ...]
  },
  "policy_flags": [
    { "type": "meta_ad_policy" | "google_ads_policy" | "brand_voice", "severity": "info"|"warn"|"block", "issue": "<one-sentence rationale>" }
  ],
  "predicted_hook": "question"|"callout"|"contrarian"|"stat"|"story"|"curiosity"|"urgency"|"social_proof"|"other"
}

All histogram fractions must sum to ~1.0 (±0.05). emotions/extracts arrays may be empty but must be present. policy_flags is empty when no issues are detected.`;

  const audienceLine = input.audience_segment
    ? `\nTarget audience: ${JSON.stringify(input.audience_segment)}`
    : '';

  const user = `Channel: ${input.channel}${audienceLine}\n\nCopy:\n${input.copy}`;

  return { system, user };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring.ts tests/scoring.test.ts
git commit -m "feat(scoring): types + system prompt composer"
```

---

## Task 5: `lib/scoring.ts` — response parser

**Files:**
- Modify: `lib/scoring.ts` (append parser)
- Modify: `tests/scoring.test.ts` (append parser tests)

- [ ] **Step 1: Write failing parser tests**

Append to `tests/scoring.test.ts`:
```ts
import { parseScoreResponse } from '@/lib/scoring';

describe('parseScoreResponse', () => {
  const valid = JSON.stringify({
    score: 73, band: 'high',
    demographics: { age: { '18-24': 0.1, '25-34': 0.4, '35-44': 0.3, '45-54': 0.15, '55+': 0.05 },
                    gender: { m: 0.6, f: 0.4 } },
    emotions: ['urgency','social_proof'],
    extracts: { offerings:['קורס'], features:[], pains:['חוסר זמן'], benefits:['חיסכון'], ctas:['הירשם'] },
    policy_flags: [],
    predicted_hook: 'urgency',
  });

  it('parses a valid JSON response', () => {
    const r = parseScoreResponse(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.score).toBe(73);
      expect(r.value.band).toBe('high');
      expect(r.value.emotions).toEqual(['urgency','social_proof']);
    }
  });

  it('handles a fenced ```json block', () => {
    const fenced = '```json\n' + valid + '\n```';
    const r = parseScoreResponse(fenced);
    expect(r.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const r = parseScoreResponse('not json');
    expect(r.ok).toBe(false);
  });

  it('rejects score out of range', () => {
    const bad = valid.replace('"score": 73', '"score": 142');
    const r = parseScoreResponse(bad);
    expect(r.ok).toBe(false);
  });

  it('corrects band when it disagrees with score (band reset to derived)', () => {
    const bad = valid.replace('"band": "high"', '"band": "low"');
    const r = parseScoreResponse(bad);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.band).toBe('high');  // score 73 → high
  });
});
```

- [ ] **Step 2: Run, verify failures**

Run: `npm test`
Expected: parser tests fail with "parseScoreResponse is not exported".

- [ ] **Step 3: Implement the parser**

Append to `lib/scoring.ts`:
```ts
export type ParseOk  = { ok: true;  value: ScoreResult };
export type ParseErr = { ok: false; error: string };

function deriveBand(score: number): ScoreBand {
  if (score < 40) return 'low';
  if (score < 70) return 'mid';
  return 'high';
}

function stripFence(raw: string): string {
  // Strip leading/trailing ```json ... ``` if present.
  return raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function parseScoreResponse(raw: string): ParseOk | ParseErr {
  let obj: any;
  try {
    obj = JSON.parse(stripFence(raw));
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (typeof obj !== 'object' || obj === null) return { ok: false, error: 'not_object' };

  const score = Number(obj.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    return { ok: false, error: 'score_out_of_range' };
  }

  const value: ScoreResult = {
    score,
    band: deriveBand(score),  // always re-derive — Claude sometimes disagrees with itself
    demographics: {
      age:    obj.demographics?.age    ?? { '18-24':0,'25-34':0,'35-44':0,'45-54':0,'55+':0 },
      gender: obj.demographics?.gender ?? { m: 0.5, f: 0.5 },
    },
    emotions:      Array.isArray(obj.emotions) ? obj.emotions.slice(0, 5).map(String) : [],
    extracts: {
      offerings: Array.isArray(obj.extracts?.offerings) ? obj.extracts.offerings.map(String) : [],
      features:  Array.isArray(obj.extracts?.features)  ? obj.extracts.features.map(String)  : [],
      pains:     Array.isArray(obj.extracts?.pains)     ? obj.extracts.pains.map(String)     : [],
      benefits:  Array.isArray(obj.extracts?.benefits)  ? obj.extracts.benefits.map(String)  : [],
      ctas:      Array.isArray(obj.extracts?.ctas)      ? obj.extracts.ctas.map(String)      : [],
    },
    policy_flags: Array.isArray(obj.policy_flags)
      ? obj.policy_flags.filter((f: any) => f && typeof f === 'object' && typeof f.issue === 'string')
                        .map((f: any) => ({
                          type:     String(f.type ?? 'meta_ad_policy'),
                          severity: (['info','warn','block'].includes(f.severity) ? f.severity : 'info') as 'info'|'warn'|'block',
                          issue:    String(f.issue),
                        }))
      : [],
    predicted_hook: ['question','callout','contrarian','stat','story','curiosity','urgency','social_proof','other'].includes(obj.predicted_hook)
      ? obj.predicted_hook
      : 'other',
  };

  return { ok: true, value };
}
```

- [ ] **Step 4: Run, verify all tests pass**

Run: `npm test`
Expected: all scoring tests green (3 + 5 = 8).

- [ ] **Step 5: Commit**

```bash
git add lib/scoring.ts tests/scoring.test.ts
git commit -m "feat(scoring): response parser with band-derivation safety"
```

---

## Task 6: Policy rules — Meta (Hebrew)

**Files:**
- Create: `lib/policy-rules/meta.he.ts`
- Create: `tests/policy-rules.test.ts`

- [ ] **Step 1: Write failing test**

`tests/policy-rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { matchMetaPolicy } from '@/lib/policy-rules/meta.he';

describe('matchMetaPolicy (Hebrew)', () => {
  it('flags "100 אחוז הצלחה" as performance guarantee', () => {
    const flags = matchMetaPolicy('100 אחוז הצלחה מובטח');
    expect(flags.some(f => f.type === 'performance_guarantee')).toBe(true);
  });

  it('flags before/after weight loss claims', () => {
    const flags = matchMetaPolicy('לפני ואחרי - ירדתי 15 קילו בחודש');
    expect(flags.some(f => f.type === 'before_after_body')).toBe(true);
  });

  it('returns empty for clean copy', () => {
    expect(matchMetaPolicy('שלום לכולם, הצטרפו לקורס שלנו')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/policy-rules/meta.he.ts`:
```ts
// Meta ad policy patterns (Hebrew). Each rule emits a policy_flags entry.
// Source: facebook.com/business/help — interpreted into Hebrew regex patterns.

export type PolicyFlag = {
  type:     string;
  severity: 'info' | 'warn' | 'block';
  issue:    string;
};

type Rule = { id: string; pattern: RegExp; severity: PolicyFlag['severity']; issue: string };

const RULES: Rule[] = [
  {
    id: 'performance_guarantee',
    pattern: /\b(100\s*אחוז|100%)\s*(הצלחה|מובטח|תוצאה)/,
    severity: 'block',
    issue: 'Meta אוסר על הבטחות הצלחה של 100%',
  },
  {
    id: 'before_after_body',
    pattern: /(לפני\s*ואחרי|before\s*&?\s*after).*(\d+\s*ק"?ג|\d+\s*קילו|\d+\s*kg)/i,
    severity: 'block',
    issue: 'Meta אוסר על תמונות/טענות לפני-ואחרי הקשורות למשקל גוף',
  },
  {
    id: 'personal_attribute',
    pattern: /\bאתה\s+(שמן|גזעני|הומו|דתי|נכה|חולה)\b/,
    severity: 'block',
    issue: 'Meta אוסר על פנייה ישירה לתכונה אישית רגישה',
  },
  {
    id: 'medical_claim_strong',
    pattern: /\b(מרפא|ריפוי|תרופה|מסיר\s+(כאב|מחלה))\b/,
    severity: 'warn',
    issue: 'טענות רפואיות חזקות דורשות אישור מיוחד; מומלץ לרכך',
  },
  {
    id: 'crypto_get_rich',
    pattern: /\b(להתעשר|רווח\s*מובטח|תשואה\s*של\s*\d+%)/,
    severity: 'block',
    issue: 'Meta אוסר על הבטחות התעשרות מהירה / תשואה מובטחת',
  },
  {
    id: 'shocking_imagery_text',
    pattern: /\b(זוועה|תמותה|דם|אסון)\b/,
    severity: 'warn',
    issue: 'שפה מזעזעת עלולה לפסול את המודעה',
  },
];

export function matchMetaPolicy(copy: string): PolicyFlag[] {
  const out: PolicyFlag[] = [];
  for (const r of RULES) {
    if (r.pattern.test(copy)) {
      out.push({ type: r.id, severity: r.severity, issue: r.issue });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, verify passes**

Run: `npm test`
Expected: 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/policy-rules/meta.he.ts tests/policy-rules.test.ts
git commit -m "feat(policy): Meta ad policy Hebrew rules"
```

---

## Task 7: Policy rules — Google Ads (Hebrew)

**Files:**
- Create: `lib/policy-rules/google.he.ts`
- Modify: `tests/policy-rules.test.ts`

- [ ] **Step 1: Append failing tests**

In `tests/policy-rules.test.ts`, add:
```ts
import { matchGooglePolicy } from '@/lib/policy-rules/google.he';

describe('matchGooglePolicy (Hebrew)', () => {
  it('flags excessive caps in headline', () => {
    expect(matchGooglePolicy('!!!מכירת ענק היום בלבד!!!')).toContainEqual(
      expect.objectContaining({ type: 'excessive_punctuation' })
    );
  });

  it('flags trademark phrasing patterns', () => {
    const flags = matchGooglePolicy('פתרון מאת iPhone מקורי');
    expect(flags.some(f => f.type === 'trademark_risk')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`lib/policy-rules/google.he.ts`:
```ts
import type { PolicyFlag } from './meta.he';

type Rule = { id: string; pattern: RegExp; severity: PolicyFlag['severity']; issue: string };

const RULES: Rule[] = [
  {
    id: 'excessive_punctuation',
    pattern: /[!]{3,}|[?]{3,}/,
    severity: 'warn',
    issue: 'Google Ads מגביל שימוש מוגזם בסימני קריאה/שאלה',
  },
  {
    id: 'trademark_risk',
    pattern: /\b(iPhone|iPad|Apple|Google|Microsoft|Samsung|Nike|Adidas)\b/,
    severity: 'warn',
    issue: 'שימוש בשם מותג מסחרי דורש אישור בעלים',
  },
  {
    id: 'misleading_claim',
    pattern: /\b(מספר\s*1\s*בארץ|הטוב\s*ביותר\s*במדינה)\b/,
    severity: 'warn',
    issue: 'טענות "מספר 1" דורשות הוכחה ציבורית',
  },
  {
    id: 'click_bait_punctuation',
    pattern: /\b(לחצו\s+(כאן|עכשיו)|לא\s+תאמינו)\b/,
    severity: 'info',
    issue: 'ניסוח clickbait — Google עלול להוריד את ציון הרלוונטיות',
  },
];

export function matchGooglePolicy(copy: string): PolicyFlag[] {
  const out: PolicyFlag[] = [];
  for (const r of RULES) {
    if (r.pattern.test(copy)) {
      out.push({ type: r.id, severity: r.severity, issue: r.issue });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, verify passes**

Run: `npm test`
Expected: 2 new tests pass; total green.

- [ ] **Step 5: Commit**

```bash
git add lib/policy-rules/google.he.ts tests/policy-rules.test.ts
git commit -m "feat(policy): Google Ads Hebrew rules"
```

---

## Task 8: `POST /api/ai/score` — score endpoint

**Files:**
- Create: `app/api/ai/score/route.ts`

- [ ] **Step 1: Implement the route**

Pattern matches existing `app/api/ai/route.ts` (rate limit → deduct → Claude → refund on fail → persist).

`app/api/ai/score/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { composeScorePrompt, parseScoreResponse, type ScoreInput, type ScoreChannel } from '@/lib/scoring';
import { matchMetaPolicy } from '@/lib/policy-rules/meta.he';
import { matchGooglePolicy } from '@/lib/policy-rules/google.he';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const SCORE_MODEL = process.env.CLAUDE_SCORE_MODEL || 'claude-haiku-4-5-20251001';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit(`score:${user.id}`, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי בקשות — נסה שוב בעוד מספר שניות', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const body = await req.json() as Partial<ScoreInput> & {
    source?: { kind: string; id?: string };
    persist?: boolean;
  };

  if (!body.copy || !body.channel) {
    return NextResponse.json({ error: 'Missing fields: copy, channel' }, { status: 400 });
  }
  if (body.copy.length > 2000) body.copy = body.copy.slice(0, 2000);

  // 1. Deduct
  const deduct = await deductCredits(supabase, user.id, 'score');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  // 2. Pull brand DNA for prompt context
  const { data: userRow } = await supabase.from('users').select('brand').eq('id', user.id).single();
  const input: ScoreInput = {
    copy:    body.copy,
    channel: body.channel as ScoreChannel,
    locale:  body.locale ?? 'he',
    brand:   userRow?.brand,
    audience_segment: body.audience_segment,
  };

  // 3. Call Claude
  const { system, user: userPrompt } = composeScorePrompt(input);
  let text: string;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const message = await anthropic.messages.create({
      model:       SCORE_MODEL,
      max_tokens:  900,
      temperature: 0.2,
      system,
      messages:    [{ role: 'user', content: userPrompt }],
    });
    text  = message.content.find(b => b.type === 'text')?.text ?? '';
    usage = { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens };
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'score', deduct.cost);
    console.error('[score route] provider error:', err);
    return NextResponse.json(
      { error: extractErrorMessage(err), refunded: deduct.cost },
      { status: err?.status || 502 }
    );
  }

  // 4. Parse
  const parsed = parseScoreResponse(text);
  if (!parsed.ok) {
    await refundCredits(supabase, user.id, 'score', deduct.cost);
    console.error('[score route] parse error:', parsed.error, 'raw:', text.slice(0, 300));
    return NextResponse.json({ error: 'parse_failed', refunded: deduct.cost }, { status: 502 });
  }

  // 5. Merge deterministic policy flags with model-emitted flags
  const channelRules = body.channel.startsWith('google') ? matchGooglePolicy(body.copy)
                     : body.channel.startsWith('meta')   ? matchMetaPolicy(body.copy)
                     : [];
  parsed.value.policy_flags = [...channelRules, ...parsed.value.policy_flags];

  // 6. Persist (unless persist:false)
  let score_id: string | undefined;
  if (body.persist !== false) {
    const { data: row, error: insErr } = await supabase.from('scores').insert({
      user_id:          user.id,
      source_kind:      body.source?.kind ?? 'manual',
      source_id:        body.source?.id   ?? null,
      copy_text:        body.copy,
      channel:          body.channel,
      audience_segment: body.audience_segment ?? {},
      locale:           input.locale,
      score:            parsed.value.score,
      band:             parsed.value.band,
      demographics:     parsed.value.demographics,
      emotions:         parsed.value.emotions,
      extracts:         parsed.value.extracts,
      policy_flags:     parsed.value.policy_flags,
      predicted_hook:   parsed.value.predicted_hook,
      model_version:    SCORE_MODEL,
      prompt_tokens:    usage.input_tokens,
      output_tokens:    usage.output_tokens,
      boost_iteration:  0,
    }).select('id').single();
    if (insErr) console.error('[score route] insert failed:', insErr.message);
    else score_id = row?.id;
  }

  return NextResponse.json({
    ok: true,
    score_id,
    ...parsed.value,
    credits: deduct.credits,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Start dev server in another terminal: `npm run dev`

In the running app, log in as a test user, then in browser DevTools console:
```js
const r = await fetch('/api/ai/score', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ copy: 'בוא נגדיל לך את העסק פי 3 ב-90 יום', channel: 'meta_feed', locale: 'he' }),
});
console.log(await r.json());
```
Expected: response with `ok:true`, `score` 0-100, `band`, `demographics` with histograms, `policy_flags` array, `credits` (decremented by 1).

- [ ] **Step 4: Commit**

```bash
git add app/api/ai/score/route.ts
git commit -m "feat(api): POST /api/ai/score endpoint"
```

---

## Task 9: `POST /api/ai/score/boost` — boost endpoint

**Files:**
- Create: `app/api/ai/score/boost/route.ts`

- [ ] **Step 1: Implement**

`app/api/ai/score/boost/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { checkRateLimit } from '@/lib/rate-limit';
import { composeScorePrompt, parseScoreResponse } from '@/lib/scoring';
import { matchMetaPolicy } from '@/lib/policy-rules/meta.he';
import { matchGooglePolicy } from '@/lib/policy-rules/google.he';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';      // Sonnet for the rewrite — better prose
const SCORE_MODEL = process.env.CLAUDE_SCORE_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ITERATIONS = 2;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit(`score_boost:${user.id}`, { max: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited', retryAfter: rl.retryAfter }, { status: 429 });

  const body = await req.json() as { prior_score_id: string };
  if (!body.prior_score_id) return NextResponse.json({ error: 'Missing prior_score_id' }, { status: 400 });

  // 1. Load the prior score row + parent chain to count iterations
  const { data: prior, error: loadErr } = await supabase.from('scores')
    .select('*').eq('id', body.prior_score_id).eq('user_id', user.id).single();
  if (loadErr || !prior) return NextResponse.json({ error: 'prior_not_found' }, { status: 404 });
  if (prior.boost_iteration >= MAX_ITERATIONS) {
    return NextResponse.json({ error: 'max_iterations_reached', max: MAX_ITERATIONS }, { status: 409 });
  }

  // 2. Deduct
  const deduct = await deductCredits(supabase, user.id, 'score_boost');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error }, { status: deduct.status });

  // 3. Rewrite (Sonnet)
  const rewriteSystem = `You are a Hebrew-native performance copywriter. Rewrite the given Hebrew/English/Arabic ad copy to score higher on predicted CTR + conversion. The current score is ${prior.score}/100, band="${prior.band}". The detected weaknesses are encoded in the policy flags and missing extracts. Keep the same channel (${prior.channel}) and the same locale (${prior.locale}). Return ONLY the rewritten copy, no commentary, no markdown.`;
  const rewriteUser = `Current copy:\n${prior.copy_text}\n\nIssues to address:\n- Predicted hook: ${prior.predicted_hook}\n- Emotions present: ${(prior.emotions as string[]).join(', ') || 'none'}\n- Policy flags: ${JSON.stringify(prior.policy_flags)}\n\nRewrite for a stronger hook, stronger benefit framing, and a clear CTA. Preserve the brand voice.`;

  let rewritten: string;
  try {
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 600, temperature: 0.7,
      system: rewriteSystem,
      messages: [{ role: 'user', content: rewriteUser }],
    });
    rewritten = message.content.find(b => b.type === 'text')?.text?.trim() ?? '';
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'score_boost', deduct.cost);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
  if (!rewritten) {
    await refundCredits(supabase, user.id, 'score_boost', deduct.cost);
    return NextResponse.json({ error: 'rewrite_empty', refunded: deduct.cost }, { status: 502 });
  }

  // 4. Re-score (Haiku, same path as /api/ai/score)
  const { data: userRow } = await supabase.from('users').select('brand').eq('id', user.id).single();
  const { system, user: userPrompt } = composeScorePrompt({
    copy:    rewritten,
    channel: prior.channel,
    locale:  prior.locale,
    brand:   userRow?.brand,
    audience_segment: prior.audience_segment,
  });
  let scoreText: string;
  let usage = { input_tokens: 0, output_tokens: 0 };
  try {
    const message = await anthropic.messages.create({
      model: SCORE_MODEL, max_tokens: 900, temperature: 0.2,
      system, messages: [{ role: 'user', content: userPrompt }],
    });
    scoreText = message.content.find(b => b.type === 'text')?.text ?? '';
    usage = { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens };
  } catch (err: any) {
    return NextResponse.json({ error: extractErrorMessage(err), rewritten }, { status: 502 });
  }
  const parsed = parseScoreResponse(scoreText);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'parse_failed', rewritten }, { status: 502 });
  }

  const channelRules = prior.channel.startsWith('google') ? matchGooglePolicy(rewritten)
                     : prior.channel.startsWith('meta')   ? matchMetaPolicy(rewritten)
                     : [];
  parsed.value.policy_flags = [...channelRules, ...parsed.value.policy_flags];

  // 5. Persist boosted row
  const { data: row, error: insErr } = await supabase.from('scores').insert({
    user_id:          user.id,
    source_kind:      prior.source_kind,
    source_id:        prior.source_id,
    copy_text:        rewritten,
    channel:          prior.channel,
    audience_segment: prior.audience_segment,
    locale:           prior.locale,
    score:            parsed.value.score,
    band:             parsed.value.band,
    demographics:     parsed.value.demographics,
    emotions:         parsed.value.emotions,
    extracts:         parsed.value.extracts,
    policy_flags:     parsed.value.policy_flags,
    predicted_hook:   parsed.value.predicted_hook,
    model_version:    `${MODEL}+${SCORE_MODEL}`,
    prompt_tokens:    usage.input_tokens,
    output_tokens:    usage.output_tokens,
    boost_iteration:  prior.boost_iteration + 1,
    parent_score_id:  prior.id,
  }).select('id').single();
  if (insErr) console.error('[boost] insert failed:', insErr.message);

  return NextResponse.json({
    ok: true,
    score_id:   row?.id,
    copy:       rewritten,
    iteration:  prior.boost_iteration + 1,
    max:        MAX_ITERATIONS,
    ...parsed.value,
    credits:    deduct.credits,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

After running Task 8's smoke test, copy the returned `score_id`. In DevTools console:
```js
const r = await fetch('/api/ai/score/boost', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prior_score_id: '<paste here>' }),
});
console.log(await r.json());
```
Expected: `ok:true`, `copy` is a new Hebrew sentence, `score` likely higher than the original, `iteration: 1`.

Call it again with the SAME prior_score_id → expect `iteration: 1` again (boost from same parent). Call with the NEW score_id → expect `iteration: 2`. Call with iteration-2 id → expect 409 `max_iterations_reached`.

- [ ] **Step 4: Commit**

```bash
git add app/api/ai/score/boost/route.ts
git commit -m "feat(api): POST /api/ai/score/boost with iteration cap"
```

---

## Task 10: `<ScoreBadge>` component

**Files:**
- Create: `components/ScoreBadge.tsx`

- [ ] **Step 1: Implement**

`components/ScoreBadge.tsx`:
```tsx
'use client';
import { clsx } from 'clsx';
import type { ScoreBand } from '@/lib/scoring';

const BAND_STYLES: Record<ScoreBand, string> = {
  low:  'bg-red-900/25 text-red-300 border-red-500/40',
  mid:  'bg-amber-900/25 text-amber-300 border-amber-500/40',
  high: 'bg-emerald-900/25 text-emerald-300 border-emerald-500/40',
};

interface Props {
  score:   number;
  band:    ScoreBand;
  onClick?: () => void;
  className?: string;
}

export function ScoreBadge({ score, band, onClick, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`ציון חיזוי ביצועים: ${score}/100`}
      className={clsx(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all hover:brightness-110',
        BAND_STYLES[band],
        className
      )}
    >
      <span className="text-base leading-none">{score}</span>
      <span className="opacity-60 text-[10px]">/100</span>
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/ScoreBadge.tsx
git commit -m "feat(ui): ScoreBadge component"
```

---

## Task 11: `<ScorePanel>` component (histograms + chips + extracts)

**Files:**
- Create: `components/ScorePanel.tsx`

- [ ] **Step 1: Implement**

`components/ScorePanel.tsx`:
```tsx
'use client';
import { clsx } from 'clsx';
import type { ScoreResult } from '@/lib/scoring';

interface Props {
  result: ScoreResult;
  onClose?: () => void;
}

const AGE_BUCKETS = ['18-24','25-34','35-44','45-54','55+'] as const;

const EMOTION_LABELS_HE: Record<string, string> = {
  urgency:      'דחיפות',
  social_proof: 'הוכחה חברתית',
  authority:    'סמכות',
  curiosity:    'סקרנות',
  fear:         'פחד',
  trust:        'אמון',
  greed:        'הזדמנות',
  pride:        'גאווה',
  belonging:    'שייכות',
};
const HOOK_LABELS_HE: Record<string, string> = {
  question: 'שאלה', callout: 'פנייה ישירה', contrarian: 'נגד הזרם',
  stat: 'סטטיסטיקה', story: 'סיפור', curiosity: 'סקרנות',
  urgency: 'דחיפות', social_proof: 'הוכחה חברתית', other: 'אחר',
};

function HistogramBar({ label, fraction }: { label: string; fraction: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 text-right text-[#6B8FA8]">{label}</span>
      <div className="flex-1 h-2 bg-[#162030] rounded overflow-hidden">
        <div className="h-full bg-[#0A7AFF]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-[#6B8FA8] tabular-nums">{pct}%</span>
    </div>
  );
}

export function ScorePanel({ result, onClose }: Props) {
  const bandColor = result.band === 'high' ? 'text-emerald-300'
                  : result.band === 'mid'  ? 'text-amber-300'
                  : 'text-red-300';
  return (
    <div className="bg-[#0E1620] border border-[#1E2F42] rounded-xl p-4 shadow-2xl max-w-md w-full" dir="rtl">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className={clsx('text-4xl font-black leading-none', bandColor)}>{result.score}<span className="text-base opacity-50">/100</span></div>
          <div className="text-[10px] uppercase tracking-widest text-[#6B8FA8] mt-1">חיזוי ביצועים</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-[#6B8FA8] hover:text-white text-lg leading-none">×</button>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-3 mb-2">קהל פוטנציאלי — גיל</div>
      <div className="space-y-1.5">
        {AGE_BUCKETS.map(b => (
          <HistogramBar key={b} label={b} fraction={Number(result.demographics.age?.[b] ?? 0)} />
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">מין</div>
      <div className="space-y-1.5">
        <HistogramBar label="גברים"  fraction={result.demographics.gender?.m ?? 0.5} />
        <HistogramBar label="נשים"   fraction={result.demographics.gender?.f ?? 0.5} />
      </div>

      {result.emotions.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">רגשות מובילים</div>
          <div className="flex flex-wrap gap-1.5">
            {result.emotions.map(e => (
              <span key={e} className="px-2 py-0.5 rounded-full bg-[#162030] border border-[#1E2F42] text-[11px] text-[#D9E8F5]">
                {EMOTION_LABELS_HE[e] ?? e}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">קונספט הפתיחה</div>
      <div className="text-xs text-[#D9E8F5]">{HOOK_LABELS_HE[result.predicted_hook] ?? result.predicted_hook}</div>

      {(result.extracts.benefits.length + result.extracts.ctas.length) > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">תוכן שזוהה</div>
          <ul className="text-[11px] text-[#D9E8F5] space-y-0.5">
            {result.extracts.benefits.map((b, i) => <li key={`b${i}`}>✓ <span className="text-[#6B8FA8]">תועלת:</span> {b}</li>)}
            {result.extracts.ctas.map((c, i)     => <li key={`c${i}`}>→ <span className="text-[#6B8FA8]">CTA:</span> {c}</li>)}
            {result.extracts.pains.map((p, i)    => <li key={`p${i}`}>! <span className="text-[#6B8FA8]">כאב:</span> {p}</li>)}
          </ul>
        </>
      )}

      {result.policy_flags.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-widest text-[#2E4459] font-bold mt-4 mb-2">בדיקת מדיניות</div>
          <ul className="text-[11px] space-y-1">
            {result.policy_flags.map((f, i) => (
              <li key={i} className={clsx(
                f.severity === 'block' ? 'text-red-300'
              : f.severity === 'warn'  ? 'text-amber-300'
              :                          'text-[#6B8FA8]'
              )}>
                {f.severity === 'block' ? '⛔' : f.severity === 'warn' ? '⚠️' : 'ℹ️'} {f.issue}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/ScorePanel.tsx
git commit -m "feat(ui): ScorePanel with histograms, emotions, extracts, policy flags"
```

---

## Task 12: `<BoostButton>` component

**Files:**
- Create: `components/BoostButton.tsx`

- [ ] **Step 1: Implement**

`components/BoostButton.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { Btn, Spinner } from '@/components/ui';

interface BoostResult {
  ok: true;
  score_id: string;
  copy: string;
  iteration: number;
  max: number;
  score: number;
  band: 'low'|'mid'|'high';
  // ...rest of ScoreResult fields are spread in the API; we only use these here
}

interface Props {
  priorScoreId: string;
  iteration:    number;       // 0,1,2
  max:          number;       // typically 2
  onBoosted:    (boost: BoostResult & Record<string, any>) => void;
}

export function BoostButton({ priorScoreId, iteration, max, onBoosted }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  if (iteration >= max) return null;

  async function go() {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/ai/score/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prior_score_id: priorScoreId }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setErr(data.error || 'boost_failed');
      } else {
        onBoosted(data);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'network_error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Btn variant="violet" size="sm" loading={loading} onClick={go}>
        ✨ שפר ציון ({iteration + 1}/{max})
      </Btn>
      {err && <span className="text-[11px] text-red-400">{err}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/BoostButton.tsx
git commit -m "feat(ui): BoostButton with iteration counter"
```

---

## Task 13: Wire score into `/create` (Master Studio)

**Files:**
- Modify: `app/(dashboard)/create/page.tsx`

- [ ] **Step 1: Read the file to locate the result-render block**

Read `app/(dashboard)/create/page.tsx`. Locate the JSX block that renders the Master Studio post output (it includes the post text, hashtags, image prompt, tips, whatsapp variant — see `MasterStudioOutput` shape in `lib/master-studio.ts`). Identify the variable that holds the result (likely something like `master`, `result`, or `output`).

- [ ] **Step 2: Add score state + auto-fetch effect**

Near the top of the component, alongside existing `useState` calls, add:

```tsx
import { useEffect, useState } from 'react';   // ensure imports exist
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScorePanel } from '@/components/ScorePanel';
import { BoostButton } from '@/components/BoostButton';
import type { ScoreResult } from '@/lib/scoring';

// ── inside the component, alongside other state:
const [score,       setScore]       = useState<(ScoreResult & { score_id: string; iteration: number; max: number }) | null>(null);
const [showPanel,   setShowPanel]   = useState(false);
const [scoreLoading, setScoreLoading] = useState(false);
```

- [ ] **Step 3: Add the score-fetch effect right after the post is generated**

Find the function that handles Master Studio generation success (it assigns to `master`/`result`/`output`). At the point where the post text is set, add a call to `fetchScore(postText)`. Define `fetchScore` inside the component:

```tsx
async function fetchScore(copy: string, sourceId?: string) {
  if (!copy) return;
  setScoreLoading(true);
  setScore(null);
  try {
    const r = await fetch('/api/ai/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        copy,
        channel: 'meta_feed',                                  // default channel for Master Studio
        locale:  'he',
        source:  { kind: 'master_post', id: sourceId },
      }),
    });
    const data = await r.json();
    if (data.ok) setScore({ ...data, iteration: 0, max: 2 });
  } catch (e) { console.error('[create] score failed', e); }
  finally { setScoreLoading(false); }
}
```

If the post-text variable is, for example, `master?.post`, add this right after the line where `setMaster` is called inside the success handler:
```tsx
if (data.post) fetchScore(data.post);
```
(Replace `data.post` and `setMaster` with the actual local names you find.)

- [ ] **Step 4: Add the badge + panel + boost button to the result JSX**

Inside the result-render block, near the post text, insert:

```tsx
{(score || scoreLoading) && (
  <div className="flex items-center gap-3 mt-3">
    {scoreLoading && <Spinner size={14} />}
    {score && (
      <>
        <ScoreBadge score={score.score} band={score.band} onClick={() => setShowPanel(v => !v)} />
        {score.band !== 'high' && (
          <BoostButton
            priorScoreId={score.score_id}
            iteration={score.iteration}
            max={score.max}
            onBoosted={(b) => {
              // Replace the displayed post with the boosted copy and update score state
              setMaster(prev => prev ? { ...prev, post: b.copy } : prev);   // adapt to actual setter name
              setScore({ ...b });
            }}
          />
        )}
      </>
    )}
  </div>
)}
{showPanel && score && (
  <div className="mt-3 max-w-md">
    <ScorePanel result={score} onClose={() => setShowPanel(false)} />
  </div>
)}
```
(Adapt `setMaster` to the actual state setter name in the file.)

Also add `Spinner` to the imports from `@/components/ui` if not already imported.

- [ ] **Step 5: Type-check and manual verify**

Run: `npm run type-check`
Expected: PASS.

Run: `npm run dev`. Open `/create`, generate a post. Within ~2 seconds after the post renders, the score badge should appear next to it. Click the badge → panel opens with histogram + emotions + extracts. If band is `low` or `mid`, the Boost button is visible — click it, observe the post text update and the score change.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/create/page.tsx
git commit -m "feat(create): score badge + panel + boost on Master Studio output"
```

---

## Task 14: Wire score into `/variations` + Top Five filter

**Files:**
- Modify: `app/(dashboard)/variations/page.tsx`
- Create: `components/TopFiveFilter.tsx`

- [ ] **Step 1: Create `<TopFiveFilter>`**

`components/TopFiveFilter.tsx`:
```tsx
'use client';
import { clsx } from 'clsx';

interface Props {
  active: boolean;
  onToggle: () => void;
  hidden: number;     // how many variations are currently hidden
}

export function TopFiveFilter({ active, onToggle, hidden }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
        active
          ? 'border-[#0A7AFF] bg-[#0A7AFF]/12 text-[#3D9FFF]'
          : 'border-[#1E2F42] bg-[#162030] text-[#6B8FA8] hover:border-[#2A4158] hover:text-[#D9E8F5]',
      )}
    >
      <span>{active ? '🏆 רק 5 המובילות' : 'הצג רק 5 מובילות'}</span>
      {active && hidden > 0 && (
        <span className="text-[10px] opacity-70">({hidden} מוסתרות)</span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Read `/variations/page.tsx` to find the list-render block**

Identify the array of generated variations (likely `variations: string[]` or `variants: SomeShape[]`).

- [ ] **Step 3: Add per-variant score state + fetch + UI**

At the top of the component:
```tsx
import { useEffect, useState } from 'react';
import { ScoreBadge } from '@/components/ScoreBadge';
import { ScorePanel } from '@/components/ScorePanel';
import { BoostButton } from '@/components/BoostButton';
import { TopFiveFilter } from '@/components/TopFiveFilter';
import type { ScoreResult } from '@/lib/scoring';

type ScoredVariant = ScoreResult & { score_id: string; iteration: number; max: number };

// inside the component:
const [scores,    setScores]    = useState<Record<number, ScoredVariant | undefined>>({});
const [openPanel, setOpenPanel] = useState<number | null>(null);
const [topFive,   setTopFive]   = useState(false);
```

After variations are generated (in the success handler), call:
```tsx
async function scoreVariant(idx: number, copy: string) {
  const r = await fetch('/api/ai/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ copy, channel: 'meta_feed', locale: 'he', source: { kind: 'variation' } }),
  });
  const data = await r.json();
  if (data.ok) setScores(prev => ({ ...prev, [idx]: { ...data, iteration: 0, max: 2 } }));
}

useEffect(() => {
  // Re-score whenever the variations list changes
  variations.forEach((v, i) => { if (!scores[i]) scoreVariant(i, v); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [variations]);
```

Replace `variations` with the actual array variable name.

- [ ] **Step 4: Apply Top-5 filter when rendering**

Compute the visible list:
```tsx
const visibleIdx = (() => {
  if (!topFive) return variations.map((_, i) => i);
  const idxs = variations.map((_, i) => i);
  idxs.sort((a, b) => (scores[b]?.score ?? -1) - (scores[a]?.score ?? -1));
  return idxs.slice(0, 5);
})();
const hidden = variations.length - visibleIdx.length;
```

Above the variant list render:
```tsx
<div className="flex justify-end mb-2">
  <TopFiveFilter active={topFive} onToggle={() => setTopFive(v => !v)} hidden={hidden} />
</div>
```

Inside each rendered variant, add (using the variant's index `i`):
```tsx
<div className="flex items-center gap-2 mt-2">
  {scores[i] && <ScoreBadge score={scores[i]!.score} band={scores[i]!.band} onClick={() => setOpenPanel(openPanel === i ? null : i)} />}
  {scores[i] && scores[i]!.band !== 'high' && (
    <BoostButton
      priorScoreId={scores[i]!.score_id}
      iteration={scores[i]!.iteration}
      max={scores[i]!.max}
      onBoosted={(b) => {
        setVariations(prev => prev.map((v, j) => j === i ? b.copy : v));
        setScores(prev => ({ ...prev, [i]: { ...b } }));
      }}
    />
  )}
</div>
{openPanel === i && scores[i] && (
  <div className="mt-2 max-w-md"><ScorePanel result={scores[i]!} onClose={() => setOpenPanel(null)} /></div>
)}
```
(Replace `setVariations` with the actual setter.)

When mapping over variants, iterate over `visibleIdx` and index into `variations` for the text:
```tsx
{visibleIdx.map(i => {
  const text = variations[i];
  return (
    <div key={i} className="...existing classes...">
      {/* ...existing card render using `text`... */}
    </div>
  );
})}
```

- [ ] **Step 5: Type-check and manual verify**

Run: `npm run type-check`
Expected: PASS.

Run: `npm run dev`. Open `/variations`, run a generation. Each variant should get a score badge within a few seconds. Click "🏆 רק 5 מובילות" → list shrinks to 5 highest. Click again → restored.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/variations/page.tsx components/TopFiveFilter.tsx
git commit -m "feat(variations): per-variant score + Top-5 filter"
```

---

## Task 15: Wire score into `/refine`

**Files:**
- Modify: `app/(dashboard)/refine/page.tsx`

- [ ] **Step 1: Read the file to find the refined-output render block**

Same pattern as Task 13 but for the refine flow. The refine result is a single piece of text (or a small set of refined variants — confirm in the file).

- [ ] **Step 2: Add score state + auto-fetch + badge/panel/boost**

Same code shape as Task 13 but adapt the source kind:
```tsx
const [score, setScore] = useState<(ScoreResult & { score_id: string; iteration: number; max: number }) | null>(null);
const [showPanel, setShowPanel] = useState(false);

async function fetchScore(copy: string) {
  setScore(null);
  const r = await fetch('/api/ai/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ copy, channel: 'meta_feed', locale: 'he', source: { kind: 'refine' } }),
  });
  const data = await r.json();
  if (data.ok) setScore({ ...data, iteration: 0, max: 2 });
}
```

Call `fetchScore(refinedText)` after the refine API returns. Render the same badge/panel/boost trio inside the refined-output card.

- [ ] **Step 3: Type-check and manual verify**

Run: `npm run type-check` → PASS.

Run: `npm run dev`. Open `/refine`, run a refinement. Badge appears next to refined output.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/refine/page.tsx
git commit -m "feat(refine): score badge + panel on refined output"
```

---

## Task 16: End-to-end smoke + cleanup

**Files:**
- None new

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: 0 errors (warnings tolerated; document any new ones in the commit body if introduced).

- [ ] **Step 4: Manual end-to-end test in browser**

Start `npm run dev`. As a logged-in user with credits:

1. Visit `/create`. Generate a Master Studio post. Verify badge appears, click it → panel opens with histogram, emotions, hook, extracts. If band ≠ high, click Boost → post updates, score updates, counter shows 1/2.
2. Visit `/variations`. Generate variations. Verify each variant has its own badge. Toggle Top-5 filter → list shrinks. Toggle again → restored. Boost a low-scoring variant → score updates in place.
3. Visit `/refine`. Refine an existing post. Verify badge on output.
4. In the Supabase SQL editor: `select source_kind, count(*), avg(score) from scores group by source_kind;` — expect rows for `master_post`, `variation`, `refine`.

- [ ] **Step 5: Final commit summarizing Phase 1**

```bash
# If any small fixes were made during smoke test, stage them; otherwise this is informational only.
git log --oneline -16          # confirm the 16 commits above are present
```

No new commit unless fixes were applied.

---

## Self-Review Checklist (completed inline during plan authoring)

- **Spec coverage:** All Feature A requirements covered: scoring scale (Task 4), demographics + emotions + extracts + policy flags (Tasks 4-7), boost loop with iteration cap (Task 9), Top-5 filter (Task 14), per-channel policy rules (Tasks 6-7), credit deduction with refund on failure (Tasks 8-9), persistence (Task 2), RLS (Task 2). The `analyze` page integration was explicitly deferred per the spec's amended Phase 1 scope.
- **Placeholder scan:** No TBDs, no "add appropriate error handling", every code step shows the code. Three steps include "Replace `setMaster` / `setVariations` / `variations` with the actual local names" — these are not placeholders; they're explicit hand-offs to the engineer because the existing state variable names in those pages are unknown until the file is read. The plan tells them what to look for.
- **Type consistency:** `ScoreBand`, `ScoreResult`, `ScoreInput`, `ScoreChannel` defined once in `lib/scoring.ts` (Task 4), imported by route (Task 8), boost route (Task 9), and all three UI components (Tasks 10-12). `PolicyFlag` exported from `lib/policy-rules/meta.he.ts` and re-imported by `google.he.ts`. `CreditAction` extended in Task 1 and used in Tasks 8-9.

