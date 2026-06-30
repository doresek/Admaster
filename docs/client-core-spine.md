# Client Core Spine — `client → brief → analysis → avatar → everything`

**Status:** Design only. No code in this document. Implementation is gated on the dependencies in §5.
**Author intent:** Turn today's orphaned business analysis and manual, brief-scoped avatar into a durable **client core** (analysis + structured avatar on the client) that every generation surface reads through the existing `buildAiContext()` loader.

---

## 0. Problem recap (current state, verified)

The canonical flow we want is:

```
new client → brief → BUSINESS ANALYSIS → CLIENT AVATAR → every generator reads analysis + avatar
```

What exists today:

| Piece | Exists? | Where | Consumed by generators? |
|---|---|---|---|
| Brief | ✅ | `briefs` table (`001_schema.sql`), submit at `app/api/briefs/submit/route.ts` | ✅ via `buildAiContext` |
| Business analysis | ⚠️ manual QA tool | `app/api/tools/route.ts` (`analyze_brief`) → `brief_analyses` (`005_phase_c.sql`) | ❌ **never read back** |
| Avatar v1 (text) | ✅ AI-generated, manual button | `app/(dashboard)/briefs/page.tsx` `buildAvatar()` → `briefs.avatar text` | ✅ via `buildAiContext` (1500-char slice) |
| Avatar v2 (JSONB) | ⚠️ unmerged branch | `origin/feat/avatar-quality-v2`: `006_avatar_v2.sql` + `app/api/avatars/generate-v2/route.ts` | ❌ no generator reads `avatar_v2` |
| Shared context loader | ✅ | `lib/ai-context.ts` `buildAiContext()` | reads `meta_clients` + most-recent `briefs` (values + avatar text) |

**Three structural gaps this spec closes:**
1. `brief_analyses` is **write-only** — `buildAiContext` never queries it, and it isn't keyed to a client.
2. There is **no automation** after brief submit; analysis and avatar are separate manual clicks.
3. The **client is not the source of truth** — analysis/avatar hang off the brief; context is rebuilt each call from "most-recent brief."

---

## 1. The single migration — client core columns on `meta_clients`

### 1.1 Migration number — resolved across all worktrees

Audited every migration filename across **all branches** (`git log --all --diff-filter=A`). The full numeric landscape:

```
001..017   present on this branch (main line)
018_brief_code_token.sql   ← highest committed anywhere (brief-magic-link)
004_briefs_v2.sql, 005_imagen_module.sql, 006_avatar_v2.sql   ← divergent avatar-v2 line
003_lock_credits, 008_google_ads_oauth, 011_launched_ads, 012_landing_pixel ← other parallel lines
```

- **Highest committed integer anywhere = `018`** (`018_brief_code_token.sql`, brief-magic-link). Confirmed: no `019` or `020` file exists on disk in any branch.
- The **literal next free integer is `019`.**

> ⚠️ **Collision flag — do not assume 019 is safe.** The `meta_connections` design doc reserved **019 / 020 as placeholders** for the Meta OAuth/connections work. Those numbers are *informally claimed but not yet committed*. The repo also has a documented history of parallel-worktree number collisions (two `003`s, three `004`s, two `005`/`007`/`008`/`011`s) resolved after the fact by content. Per the cross-branch coordination rule, **the migration number must be confirmed with the human before writing the file.**
>
> **Recommendation:** claim **`021_client_core.sql`** to sit clearly above the `meta_connections` 019/020 reservation, OR take **019** only if `meta_connections` is confirmed dead/renumbered. Final integer = **coordinate before creating the file.** This doc uses `0NN_client_core.sql` as a placeholder.

### 1.2 DDL (pure ASCII — for the Supabase SQL editor; DDL is applied manually)

```sql
-- 0NN_client_core.sql   (NN = confirmed next free integer; see 1.1)
-- Adds the durable "client core" to meta_clients:
--   business_analysis : structured output of analyze_brief, keyed to the client
--   avatar            : structured Avatar v2 profile (JSONB), client-owned
--   core_generated_at : stamp set when the orchestrator last (re)built the core
-- Safe/idempotent. Does NOT drop briefs.avatar / brief_analyses (kept for fallback + history).

ALTER TABLE public.meta_clients
  ADD COLUMN IF NOT EXISTS business_analysis jsonb,
  ADD COLUMN IF NOT EXISTS avatar            jsonb,
  ADD COLUMN IF NOT EXISTS core_generated_at timestamptz;

-- GIN index so we can later filter inside the avatar (awareness_level, angle, etc.)
CREATE INDEX IF NOT EXISTS meta_clients_avatar_idx
  ON public.meta_clients USING gin (avatar);
```

**`business_analysis` shape** = the existing `analyze_brief` output (mirrors `brief_analyses`):
```jsonc
{ "completeness_score": 0, "strengths": [], "gaps": [], "questions": [], "refinements": [], "raw_text": "" }
```

**`avatar` shape** = the **Avatar v2 `Avatar` interface** (from `lib/avatar/generator.ts` on `feat/avatar-quality-v2`), so we adopt the rich structure rather than v1 tagged text:
```jsonc
{
  "name": "", "age": "", "occupation": "", "location": "", "income_range": "", "family_status": "",
  "demographics_summary": "", "psychographics_summary": "",
  "pains": [], "desires": [], "fears": [], "status_gains": [],
  "voice_quotes": [], "daily_routine": "",
  "jobs_to_be_done": { "functional": "", "emotional": "", "social": "", "old_hire": "" },
  "awareness_level": "", "awareness_strategy": "", "market_sophistication": "", "recommended_angle": "",
  "objections": [], "buying_triggers": [], "channels": [], "recommended_creative_angles": []
}
```
(Until Avatar v2 merges, `avatar` may transitionally hold a `{ "v1_text": "<tagged text>" }` shim — see §2.4.)

> RLS: `meta_clients` already has owner policies; new columns inherit them. No new policy needed. Confirm during implementation that the orchestrator's writer client respects RLS (it acts as the owning user).

---

## 2. The post-brief-submit orchestrator

### 2.1 Where it hooks in

`app/api/briefs/submit/route.ts` today inserts the brief and calls `advanceJourneyOnBrief(...)` → status `brief_in`. **No code is removed.** After the existing insert + journey advance, fire the orchestrator.

### 2.2 Async / background (required)

Avatar v2 alone is **60–90s** (research + 3 LLM passes, `maxDuration = 120`). The brief-submit response **must not block** on it (the submit endpoint is called unauthenticated by the client-facing form). Run the orchestrator out-of-band:

- **Preferred:** enqueue a job (Vercel background function / queue) keyed by `{ user_id, client_id, brief_id }`; submit returns immediately.
- **Acceptable interim:** a fire-and-forget internal POST to an authenticated orchestrator route that the dashboard polls via the journey state.
- The orchestrator is **idempotent** per `(client_id, brief_id)` and guards against double-runs (e.g. skip if `core_generated_at` is newer than the brief's `submitted_at` unless `force`).

### 2.3 Orchestrator steps

```
orchestrateClientCore({ userId, clientId, briefId, force? }):
  1. Load brief.values for briefId (ownership-checked).
  2. ANALYSIS:
       - Reuse the analyze_brief logic from app/api/tools/route.ts (extract to lib/ so
         both the manual /analyze-brief page and the orchestrator call one function).
       - Write result → meta_clients.business_analysis  (also keep inserting into
         brief_analyses for history; optionally backfill brief_analyses.client_id — see note).
  3. AVATAR:
       - Call avatar generation (see 2.4 for which generator) with brief.values.
       - Write structured result → meta_clients.avatar.
  4. Stamp meta_clients.core_generated_at = now().
  5. Advance the journey: brief_in → 'analyzed' / 'core_ready'
     (extend the journey state machine in lib that advanceJourneyOnBrief lives in).
  6. On partial failure: write whichever piece succeeded, stamp partial state, surface error;
     credits already deducted by each sub-step — manual re-run can complete the rest.
```

**Credits:** analysis = 2, avatar v1 = 10 / avatar v2 = 20 (`CREDIT_COSTS`). The orchestrator deducts via the existing `deduct_credits` RPC inside each sub-step, exactly as the manual paths do — no new credit logic.

### 2.4 Avatar v2 branch dependency + migration renumber

- The structured generator lives on **`origin/feat/avatar-quality-v2`** (`app/api/avatars/generate-v2/route.ts` → `lib/avatar/generator.ts` `generateAvatarV2`, `lib/avatar/frameworks.ts`). **Not merged** to `main` or this branch.
- That branch carries **divergent migrations** `004_briefs_v2.sql`, `005_imagen_module.sql`, `006_avatar_v2.sql` whose numbers **collide** with the main line's `004_phase_b` / `005_phase_c` / `006_performance_score`. **Merging Avatar v2 requires renumbering its migrations** to the next free integers above this spec's migration, and re-pointing its `briefs.avatar_v2` columns (or, preferably, retargeting the generator to write `meta_clients.avatar` directly per §1).
- **Sequencing options:**
  - **(a) Merge Avatar v2 first** (renumbered), then build the orchestrator on top of `generateAvatarV2`. Cleanest end state.
  - **(b) Ship the spine now on Avatar v1** (`app/api/ai` `action='avatar'`), storing `{ v1_text }` in `meta_clients.avatar`; swap to `generateAvatarV2` when the branch lands. Unblocks the spine without waiting on the v2 merge.
- **Recommendation:** (b) to ship the spine, then (a) as a fast-follow.

### 2.5 Keep manual re-run buttons

Do **not** remove the existing manual entry points — they become "regenerate / override":
- `/analyze-brief` page (`app/(dashboard)/analyze-brief/page.tsx`) → now also persists to `meta_clients.business_analysis` (not just display).
- Avatar button on `app/(dashboard)/briefs/page.tsx` (and the v2 generator UI) → writes `meta_clients.avatar`, re-stamps `core_generated_at`.
Manual runs share the same `lib/` functions the orchestrator calls (single code path), so manual and automated output are identical.

> Note on `brief_analyses.client_id`: that table has no `client_id` today. For history/back-reference, optionally add `client_id` to it in the same migration; not required for the spine since the live core lives on `meta_clients`.

---

## 3. The `buildAiContext` change

### 3.1 What changes

`lib/ai-context.ts` `buildAiContext()` currently loads `meta_clients` (name/industry/emoji) + most-recent `briefs` (values + `avatar` text). Extend it to also select `business_analysis`, `avatar`, `core_generated_at` from `meta_clients`, and emit two new blocks into `combined`:

```
═══ ACTIVE CLIENT ═══        (existing)
═══ CLIENT BRIEF ═══         (existing — keep as raw ground truth)
═══ BUSINESS ANALYSIS ═══    (NEW — completeness_score, strengths, gaps, refinements)
═══ CLIENT AVATAR ═══        (NEW — structured: name, pains, desires, objections,
                              awareness_level, recommended_angle, voice_quotes, …)
```

- Prefer the **client core** (`meta_clients.avatar` / `business_analysis`) as the source. **Fallback** to the legacy `briefs.avatar` text block only when `meta_clients.avatar` is null (keeps current behavior for clients onboarded before the spine).
- Keep the existing brief block — the analysis is a *summary/lens*, the brief is the *facts*; generators benefit from both.
- Mind prompt budget: the avatar is richer than the 1500-char v1 slice. Emit a compact projection (key arrays capped), not the entire JSONB.

### 3.2 Every wired surface inherits it for free

Because all these call `buildAiContext()` and prepend `ctx.combined`, **no per-surface change is needed** — they automatically gain the analysis + structured avatar:

| Surface | Route | Inherits automatically |
|---|---|---|
| Posts / `/create` (PR #12) | `app/api/ai/master/route.ts` | ✅ |
| Campaigns / ads (quick-campaign) | `app/api/quick-campaign/route.ts` | ✅ |
| Emails / SMS / WhatsApp | `app/api/ai/route.ts` (via `useAI`) | ✅ |
| Lifecycle series | `app/api/ai/route.ts` (via `useAI`) | ✅ |
| Landing pages | `app/api/landing/generate/route.ts` | ✅ |
| Images — smart mode | `app/api/images/route.ts` (`runImagePipeline`) | ✅ |

### 3.3 The 2 stragglers to wire explicitly

These do **not** route through `buildAiContext` today and will **not** inherit the core:

1. **Images — simple mode** — `app/api/images/route.ts` (~line 244): direct prompt-to-image, no client/brief. To wire: when an active client exists, fetch `meta_clients.avatar` and prepend the avatar's `recommended_creative_angles` / visual cues to `finalPrompt` (or route simple-mode through the smart pipeline's context fetch). *(Counts as one straggler with two entry shapes — generate and edit/adapt — under the same route.)*
2. **Meta Ads Campaign Builder** — `app/(dashboard)/campaign/page.tsx`: pure Meta API, **no AI generation** → out of scope (nothing to ground). Listed for completeness only.

> So the practical wiring work beyond the loader is **just images simple-mode**; everything else is free.

---

## 4. Dependency / sequence notes

- **PR #12 (`feat/create-uses-brief`, this branch):** already grounds `/create` in active client's brief + avatar via `buildAiContext`. This spine is the **generalization** of PR #12: same loader, now also carrying analysis + structured avatar, sourced from the client instead of the latest brief. **No conflict** — extending `buildAiContext` upgrades `/create` for free. Land PR #12 first; build the spine on the merged loader.
- **`meta_connections` work:** owns the **019/020** migration reservation (§1.1). Coordinate the integer so the client-core migration sits above it (recommend `021`). No functional overlap — `meta_connections` is OAuth/connection plumbing, this is content grounding; they only contend on the migration counter.
- **Avatar v2 merge (`feat/avatar-quality-v2`):** see §2.4. Its migrations **collide** (004/005/006) and must be renumbered above this spec's migration on merge. The spine can ship on Avatar v1 first (§2.4 option b) and swap the generator in without schema change, since `meta_clients.avatar` already holds the v2 shape.
- **Migration ordering on the main line:** this migration must be numbered **after** `018_brief_code_token` and after whatever `meta_connections` claims; renumbered Avatar v2 migrations come after this one.

---

## 5. Ordered build checklist

1. **Confirm migration integer** with the human (resolve 019 vs `meta_connections`'s 019/020; recommend `021_client_core.sql`). — §1.1
2. **Land PR #12** (`feat/create-uses-brief`) so `buildAiContext` is the merged, shared loader. — §4
3. **Write & apply the migration** (`0NN_client_core.sql`): `business_analysis jsonb`, `avatar jsonb`, `core_generated_at timestamptz`, GIN index on `avatar`. Pure-ASCII block, applied manually in the Supabase SQL editor. — §1.2
4. **Extract `analyze_brief` into a `lib/` function** shared by `/analyze-brief` page route and the orchestrator; have it also persist to `meta_clients.business_analysis`. — §2.3
5. **Extend the journey state machine** with `analyzed` / `core_ready` after `brief_in`. — §2.3
6. **Build the orchestrator** (`orchestrateClientCore`) as a background job/route: analysis → avatar → stamp `core_generated_at` → advance journey; idempotent, partial-failure tolerant. Ship on **Avatar v1** first (store `{v1_text}` or structured). — §2.2–2.4
7. **Hook brief submit** (`app/api/briefs/submit/route.ts`) to enqueue the orchestrator after the existing insert + `advanceJourneyOnBrief`. Non-blocking. — §2.1
8. **Repoint manual buttons** (`/analyze-brief`, avatar button on `briefs/page.tsx`) to write to `meta_clients` via the shared `lib/` functions; keep them as "regenerate/override." — §2.5
9. **Extend `buildAiContext`** to select + emit `═══ BUSINESS ANALYSIS ═══` and structured `═══ CLIENT AVATAR ═══`, with fallback to legacy `briefs.avatar`. — §3.1
10. **Verify inheritance** across the 6 wired surfaces (smoke each generator with a client that has a core). — §3.2
11. **Wire images simple-mode** to prepend avatar creative angles when an active client exists. — §3.3
12. **Fast-follow: merge Avatar v2** (`feat/avatar-quality-v2`) — renumber its 004/005/006 migrations above the client-core migration; retarget `generateAvatarV2` to write `meta_clients.avatar`; swap the orchestrator's avatar step from v1 → v2. — §2.4 / §4

---

### Out of scope (explicitly)
- Meta Ads Campaign Builder (no AI generation).
- Removing `briefs.avatar` / `brief_analyses` (kept for fallback + history).
- Any change to credit costs or the `deduct_credits` RPC.
