# Master Studio v2 — Best-of-N + LLM Judge

**Date:** 2026-05-31
**Status:** Draft (awaiting user review)
**Branch:** to be decided (parallel session owns `feat/smart-image-pipeline` git — coordinate before commit)
**Scope:** Upgrade Master Studio (`/create`) from a single-shot generator into a server-orchestrated quality pipeline: a Strategist ranks the top-3 marketers, three Creators write competing posts in parallel, an LLM Judge scores them on a marketing scorecard and picks a winner, and an Editor self-critiques + rewrites the winner if it falls below a quality threshold.

---

## 1. Goal

Raise the average quality and consistency of `/create` output by replacing one AI call with a best-of-N + judge loop, while surfacing *why* the winning post won. Cost rises from 4 → **6 credits**; latency ~60s → ~90–120s.

This folds the four requested improvement directions into one loop:
- **Best-of-N + judge** — 3 competing posts, judge picks the winner.
- **Smarter marketer matching** — instead of committing to one marketer up front, the top-3 compete on a *real* post and the judge decides by output.
- **Auto-score** — the judge IS the scorer (0–100 marketing scorecard).
- **Self-critique loop** — the Editor stage critiques + rewrites the winner when it scores below threshold.

---

## 2. Architecture

### New server route
```
app/api/ai/master/route.ts   — orchestrates the whole pipeline server-side,
                               deducts 6 credits once, refunds on failure,
                               returns winner + reveal data in one response.
```
Mirrors the existing `app/api/ai/route.ts` patterns: Anthropic SDK, model `process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'`, `deductCredits`/`refundCredits` from `lib/credits`, `checkRateLimit`, and `buildAiContext` (Brand DNA + active client + brief injection). One client call → one credit deduction → one response. Logic and prompts never leave the server.

### Refactor of `lib/master-studio.ts`
Split the current single `composeMasterPrompt` / `parseMasterResponse` into **four isolated stage modules**, each with a prompt-builder + a parser that can be unit-tested independently:

```
lib/master-studio/
  strategist.ts  — composeStrategistPrompt(input)        → parseStrategist(raw): { avatar, ranked: MarketerPick[] (top 3) }
  creator.ts     — composeCreatorPrompt(input, marketer, avatar) → parseCreator(raw): VariantDraft
  judge.ts       — composeJudgePrompt(variants, input)    → parseJudge(raw): { scores: VariantScore[], winnerIndex, rationale }
  editor.ts      — composeEditorPrompt(winner, judgeFeedback, input) → parseEditor(raw): VariantDraft
  index.ts       — shared types + the existing tag-extract helpers (xt, parseKeyValueBlock, parseList)
```
Existing exports (`MasterStudioOutput`, etc.) re-exported from `index.ts` so the route and any callers stay stable.

### Data flow
```
client → POST /api/ai/master { brief, masterNotes, platform, tone, type, framework?, hook? }
   ↓ rate-limit + auth + buildAiContext
   ↓ deductCredits(user, 'master_post')           // now 6 credits
   ↓ A. Strategist  (1 call)  → avatar + top-3 marketers
   ↓ B. Creators    (3 calls, Promise.all) → 3 VariantDrafts (failed parses drop out)
   ↓ C. Judge       (1 call)  → per-variant scores + winnerIndex + rationale
   ↓ D. Editor      (0–1 call) → if winner.score < 80, critique + rewrite once
   ↓ insert into generated_content (meta = { avatar, marketers, scores, why, boosted })
   ↓ return { winner, avatar, marketers, scores, judgeRationale, boosted, credits }
```

---

## 3. The Stages

### A. Strategist
Input: brief + BrandDNA + Master Notes + platform + overrides. Output contract:
```
[AVATAR_PROFILE] persona / fears / desires / awareness_level / objections [/AVATAR_PROFILE]
[RANKED_MARKETERS]
1. id|name|emoji|one-line why
2. id|name|emoji|one-line why
3. id|name|emoji|one-line why
[/RANKED_MARKETERS]
```
Picks 3 distinct marketer ids from the 12-corpus, honoring Master Notes priority. Parser falls back to filling from the corpus head if fewer than 3 valid distinct ids are returned.

### B. Creators (×3, parallel)
Each Creator gets the shared avatar + ONE assigned marketer's full corpus block + the overrides. Writes a full post in that marketer's voice using their framework (or the forced framework if locked). Output contract = the current Master Studio post tags: `[POST]`, `[HASHTAGS]`, `[IMAGE_PROMPT]`, `[TIPS]`, `[WHATSAPP]`, plus `[PRINCIPLES_APPLIED]`. A variant whose `[POST]` fails to parse is dropped.

### C. Judge
Receives the 2–3 surviving variants (marketer label + post text only — blind to nothing, but scored on output). Reuses the spirit of `lib/scoring.ts`: a 0–100 score per variant, JSON contract. Scorecard dimensions (each contributes to the 0–100 and is returned for transparency):
`hook_strength, clarity, emotional_resonance, cta_strength, brand_fit, awareness_match, framework_adherence`.
```
{ "variants": [ { "index": 0, "score": 87, "dims": {...}, "note": "..." }, ... ],
  "winner_index": 0, "rationale": "<2-3 sentences why it beat the others>" }
```
Ties broken by highest `hook_strength`, then lowest index.

### D. Editor (conditional)
Runs only if `winner.score < 80`. Gets the winning post + the judge's per-dimension scores + rationale, and rewrites once to lift the weakest dimensions — preserving voice, framework, and Master Notes. Output = same post tags. The rewritten post is returned with `boosted: true`; we do NOT re-judge (one pass, bounded cost). If the Editor call fails, fall back to the original winner.

---

## 4. Credits & Errors

- **Deduct 6 credits once**, before stage A (action stays `master_post`; bump `CREDIT_COSTS.master_post` 4 → 6 in `types/index.ts`).
- **Refund (full)** when: Strategist fails to yield an avatar+≥1 marketer, OR fewer than **2** Creator variants parse successfully, OR the Judge yields no valid winner. Partial success (≥2 variants + a winner) is NOT refunded.
- The Editor failing is non-fatal (fall back to winner; no refund).
- Per-stage timeouts; any single failed Creator just drops that variant.
- 429 rate-limit and 402 insufficient-credits behaviors unchanged from `/api/ai`.

---

## 5. UX (`app/(dashboard)/create/page.tsx`)

- Switch the generate handler from `useAI.call('master_post', …)` to a direct `POST /api/ai/master`.
- **Staged progress indicator** during the ~90–120s run: `מנתח קהל… → 3 משווקים כותבים… → השופט בוחר… → משייף…`. Driven by an optimistic client-side stage timer (no streaming in v1; SSE is a future enhancement noted below).
- **Enriched "🧠 למה זה עובד" panel:** winning marketer (emoji + name), "התחרה מול X ו-Y" (the runner-up marketers), the judge's winning score + per-dimension bars, and the judge rationale. A `boosted` badge when the Editor ran.
- Existing tabs (post / WhatsApp / image / hashtags / tips) and the `/images` handoff button are unchanged.
- The credit-cost label updates 4 → 6.

---

## 6. Testing

### Unit
- Golden-fixture parser tests for each stage parser (`parseStrategist`, `parseCreator`, `parseJudge`, `parseEditor`) incl. malformed-input fallbacks.
- Orchestrator logic test (mocked stage calls): refund triggers, <2-variant drop, Editor-skip when score ≥ 80, Editor-runs when < 80, Editor-failure fallback.

### Type-check + build
`npm run type-check` and `npm run build` must pass before any push (per the verify-before-push rule).

### LLM-Judge verification of the improvement (per user directive: every improvement validated with an LLM judge)
After implementation, run an **independent judge panel** (separate agents, not the in-pipeline judge) over a fixed set of ~5 representative briefs, comparing **v1 (single-shot)** vs **v2 (best-of-N)** output head-to-head, blind to which is which, scoring on the same marketing scorecard. Ship only if v2 wins the majority. Record the result.

---

## 7. Non-goals (deferred)

- SSE / real token streaming of stage progress (v1 uses an optimistic staged timer).
- Re-judging after the Editor pass (one bounded rewrite only).
- Expanding the corpus beyond 12 marketers (separate task).
- Saved-avatar selector / avatar CRUD.
- Multi-language output beyond the existing he/en/ar locale switch.
- A/B history dashboard of winning marketers.

---

## 8. Open questions

None blocking. The exact judge scorecard weights are finalized during implementation; the contract shape is fixed here.

---

## Verification result (2026-05-31)

Live blind LLM-judge comparison (`tests/master-studio/verify-v2.live.test.ts`, `RUN_MS_VERIFY=1`) ran v2 (best-of-N) vs v1 (single-shot) over 5 representative briefs, judged by an independent rubric with A/B order alternated to cancel position bias. **Ship gate met: v2 won the majority (>= 3/5).** Run duration ~405s (real Anthropic calls).
