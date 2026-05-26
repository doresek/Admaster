# Master Studio — Design Spec

**Date:** 2026-05-27
**Status:** Draft (awaiting user approval)
**Scope:** Upgrade `/create` to a marketer-driven post generator that auto-selects an avatar profile, picks an ideal "master marketer" from a curated corpus of 12, and applies their principles with visible reasoning.

---

## 1. Goal

Turn `/create` from a framework-picker into a **Master Studio** — a one-click creator that:
1. **Infers** an audience avatar from the brief + BrandDNA.
2. **Picks** the best-matched marketer from 12 classic + modern legends.
3. **Generates** the post in that marketer's voice using their preferred framework.
4. **Reveals** the reasoning: avatar profile, marketer pick, principles applied.

All in **one AI call**, costing **4 credits**.

---

## 2. Concept

**Auto-Magic with reveal:** the user fills a brief (+ optional Master Notes), clicks once, and gets both the post and a "Why this works" panel showing the underlying analysis. No multi-step wizard; no manual marketer selection. Marketer choice is fully driven by the AI based on the brief, BrandDNA, awareness level, platform, and Master Notes.

### Priority of inputs (highest → lowest)
1. **Master Notes** (🔒 explicit user instructions — non-negotiable)
2. **AI-inferred avatar** from brief + BrandDNA (always computed this milestone)
3. **Brief**
4. **Marketers corpus** (knowledge baseline)

> A future milestone will add a "saved avatar" selector ranked between #1 and #2. Out of scope here.

---

## 3. The 12 Marketers

| # | Marketer | Archetype | Default Framework |
|---|----------|-----------|-------------------|
| 1 | Eugene Schwartz | Awareness levels | AICPBSAWN |
| 2 | David Ogilvy | Brand + research | FAB |
| 3 | Claude Hopkins | Scientific advertising | AIDA |
| 4 | Gary Halbert | Curiosity + story | AIDA + story |
| 5 | John Caples | Headline mastery | AIDA |
| 6 | Joseph Sugarman | Psychological triggers | AIDA |
| 7 | Dan Kennedy | Direct-response, no-BS | PAS |
| 8 | Russell Brunson | Funnel storytelling | Story |
| 9 | Alex Hormozi | Value-stack | 4Ps |
| 10 | John Carlton | Conversational street-smart | PAS |
| 11 | Gary Bencivenga | Believability + proof | QUEST |
| 12 | Robert Cialdini | Social-influence principles | BAB |

Each marketer record holds: name, era, archetype, best_for[], framework_default, principles[5-7], signature_moves[3-5], examples[2-3], voice_notes.

This list is curated, not exhaustive — extending to 16+ is a future task.

---

## 4. Architecture

### Files to add
```
lib/marketers.ts                 — 12 marketer records (corpus)
lib/master-studio.ts             — composeMasterPrompt(), parseMasterResponse()
```

### Files to update
```
app/(dashboard)/create/page.tsx  — UI: Master Notes textarea, optional overrides,
                                   reveal panel "Why this works"
app/api/ai/route.ts              — handle action='master_post', max_tokens=2500
types/index.ts                   — CreditAction += 'master_post'; CREDIT_COSTS['master_post']=4
```

`lib/hooks/useAI.ts` is unchanged — its `call(action, system, prompt, maxTokens, platform)` signature already supports the new action via the `action` string.

### No DB migration
We store metadata in the existing `generated_content.meta` (jsonb) column. Future analytics can be built off this without a schema change now.

### Data flow
```
User clicks "צור פוסט"
   ↓
useAI.call('master_post', system, prompt, 2500, platform)
   ↓
POST /api/ai
   ↓ deductCredits(user, 'master_post', 4)
   ↓ Claude Sonnet 4.6 — single call
   ↓ parseMasterResponse(text)
   ↓ insert into generated_content with meta = { avatar, marketer, why, principles }
   ↓ return { text, parsed, credits }
   ↓
UI renders:
   • Top: "🧠 Why this works" panel (avatar / marketer / principles)
   • Bottom: existing tabs (post / WhatsApp / image / hashtags / tips)
```

---

## 5. Prompt Contract

### System prompt (composed by `composeMasterPrompt`)

```
ROLE
אתה Master Studio — היוצר השיווקי הטוב בעולם. אתה מאחד את החוכמה
של 12 ענקי הקופי. תהליך:
  1) ניתוח אווטאר עמוק (Schwartz 5 awareness levels)
  2) בחירת המשווק האידיאלי מ-12 (לפי awareness, מוצר, פלטפורמה, MasterNotes)
  3) גילום מלא של אותו משווק — קול, framework, signature moves
  4) יישום עקרונות שלו עם הסבר קצר

═══ MASTER NOTES (🔒 PRIORITY — overrides everything below) ═══
{masterNotes or "—"}

═══ 12 MARKETERS CORPUS ═══
{compact block per marketer × 12}

═══ OVERRIDES ═══
- Forced framework: {fw or "none — choose freely"}
- Forced hook style: {hook or "none — choose freely"}
- Platform: {platform}
- Tone hint: {tone}
- Language: עברית

═══ OUTPUT CONTRACT (return ONLY these tags, nothing else) ═══
[AVATAR_PROFILE]
persona: …
fears: …
desires: …
awareness_level: 1-5 + label
objections: …
[/AVATAR_PROFILE]
[MARKETER_PICK]id|name|emoji[/MARKETER_PICK]
[WHY_THIS_MARKETER]2-3 sentences[/WHY_THIS_MARKETER]
[PRINCIPLES_APPLIED]
- principle → how it appeared in the post
- principle → how it appeared in the post
- principle → how it appeared in the post
[/PRINCIPLES_APPLIED]
[POST]…[/POST]
[HASHTAGS]…[/HASHTAGS]
[IMAGE_PROMPT]…[/IMAGE_PROMPT]
[TIPS]…[/TIPS]
[WHATSAPP]…[/WHATSAPP]
```

### User prompt
```
בריף: {brief}
מותג (BrandDNA): {json}
```

### Token budget
- Input ≈ 3,500 tokens (system role 150 + corpus 2,400 + contract 300 + user 400 + overrides 100 + buffer)
- Output ≈ 2,000 tokens
- Model: Claude Sonnet 4.6 (Anthropic SDK)
- `max_tokens: 2500`

### Estimated cost (per call)
- Input 3,500 × $3/1M ≈ $0.0105
- Output 2,000 × $15/1M ≈ $0.030
- **~$0.04 / call** — covered by 4 credits.

---

## 6. UI

### Settings column (left)
- **Platform** chips (unchanged)
- **Tone** chips (unchanged)
- **Post type** chips (`הצגת מוצר / מבצע / בניית אמון / שאלה לקהל / טיפ מקצועי`) — kept as a hint to the AI.
- **🎛 Override (optional)** section
  - Framework chips — default state "— AI יבחר —" (no chip active). Tapping locks a framework.
  - Hook chips — same pattern.
- **Brief** textarea (unchanged)
- **🔒 הערות מאסטר** textarea (NEW)
  - Placeholder: "הוראות שמועדפות על הכל. למשל: לא להזכיר מחיר, להדגיש את הסבא…"
  - Soft purple border to mark priority.
  - Hard cap: 2,000 characters; client-side counter.
- **✨ צור פוסט** button — disabled until brief non-empty.

### Output column (right)
- **🧠 Why this works** card (new, top)
  - 👤 **Avatar profile** (collapsible, default expanded)
  - 🎯 **Marketer pick** (emoji + name + 1-line "why")
  - 📚 **Principles applied** (3 bullets: principle → application)
- **Tabs** (existing): post / WhatsApp / image / hashtags / tips
- **Actions**: copy / regenerate

### Moved / removed
- `framework` chips moved into "Override (optional)" section — no longer mandatory.
- `hook` chips moved into the same Override section.
- Nothing is removed outright.

---

## 7. Parsing & Error Handling

### `parseMasterResponse(raw: string)` returns:
```ts
{
  avatar:    { persona, fears, desires, awareness_level, objections } | null,
  marketer:  { id, name, emoji } | null,
  why:       string,
  principles: { principle: string; application: string }[],
  post:      string,
  hashtags:  string[],
  image:     string,
  tips:      string,
  whatsapp:  string,
}
```

### Error cases
| Case | Handling |
|------|----------|
| Empty brief | Button disabled, no call. |
| Master Notes > 2000 chars | Truncate client-side + toast warning. |
| Missing `[POST]` or `[MARKETER_PICK]` in response | Toast: "תוצאה חלקית — נסה שוב"; auto-refund via `refundCredits()`. |
| `marketer.id` not in 12 | Fallback to `schwartz`; `console.warn`. |
| Network error | Toast + auto-refund + brief preserved in state. |
| Insufficient credits | 402 (existing behavior). |

### Validation: avatar block
If `[AVATAR_PROFILE]` is missing → still show the post but hide the "Why this works" panel and log a warn. Do not refund; the user still got a usable post.

---

## 8. Testing

### Manual QA checklist
- [ ] Generate without Master Notes — baseline flow works.
- [ ] Generate with Master Notes "אל תזכיר מחיר" — output contains no price.
- [ ] Lock framework = PAS — marketer still picked but framework forced to PAS.
- [ ] Lock hook = "עובדה מפתיעה" — first line uses a surprising fact.
- [ ] Cycle through 4 platforms (FB / IG / WA / TikTok) — output adapts.
- [ ] Mobile (≤640px): two columns collapse into one, reveal panel stays usable.
- [ ] Regenerate same brief twice — outputs differ (no caching surprises).
- [ ] Trigger network error → confirm refund happened (credits unchanged).
- [ ] `npm run type-check` passes.
- [ ] `npm run build` passes.

### Future automated tests (out of scope here)
- Unit test for `parseMasterResponse` with golden fixtures.
- Snapshot test for `composeMasterPrompt` so the contract doesn't drift.

---

## 9. Non-goals (deferred)

- Avatar select dropdown / Avatar CRUD page.
- Multi-language output (Arabic, English) — kept Hebrew-only.
- Marketer A/B history dashboard.
- Few-shot user-uploaded ads.
- Expanding the corpus beyond 12 marketers.
- Replacing the `/create` URL — feature lives in the same path.

---

## 10. Open questions

None blocking. The corpus contents (the 5-7 principles per marketer) will be finalized during implementation; the spec defines the shape, not the literal text.
