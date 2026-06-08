# Client attribution — consolidated findings

How each persisted artifact is (or isn't) tied to a **client** (`meta_clients`) today, and how its reads scope. Grounded in the real migrations and the characterization tests on `tests/feature-coverage`:
`tests/landing-leads.test.ts`, `tests/images-content.test.ts`, `tests/ad-analysis.test.ts` (plus `tests/brief-flow.test.ts`). This supersedes `system-overview.md` for attribution questions.

**Legend**
- **Populated** — a `client_id` column exists *and* a writer sets it in practice.
- **Latent** — the link exists in schema/API but the production UI doesn't supply it (→ null in practice).
- **Two-hop** — no own column; client is reachable only by joining through another table.
- **Absent** — no client column and no join path.

## Reference table

| Artifact (table) | `client_id` column | Today | How a client is reached | Read scoping |
|---|---|---|---|---|
| **briefs** | yes (`014`, FK→meta_clients ON DELETE CASCADE) | **Populated (conditionally)** | Direct column; inherited deterministically from `brief_codes.client_id` at submit (`briefs/submit/route.ts:47`). Null if the code had no client. | `buildAiContext` filters `briefs WHERE client_id = activeClient`; dashboard lists `user_id`-scoped. |
| **generated_content** (posts) | yes (`004_phase_b`, FK ON DELETE SET NULL) | **Partial** | Direct column, but only **master-studio** sets it (`ai/master/route.ts:85`). `/api/ai` (`route.ts:79`) and `/api/quick-campaign` (`route.ts:101`) **omit it** → null. | `user_id` only everywhere (library, history, recommendations, dashboard). No per-client read despite the column. |
| **generated_images** | **none** | **Absent** | No column, no FK to meta_clients. Smart path resolves a clientId and threads it into the pipeline, then drops it at persistence (`images/route.ts:195` vs insert `:210`). | `user_id` only (GET `/api/images` limit 50; dashboard count). |
| **landing_pages** | yes (`004_phase_b`, FK ON DELETE SET NULL) | **Latent** | Direct column; `POST/PATCH` accept `client_id`, but the dashboard create posts only `{template,title,content}` (`landing-pages/page.tsx:88`) → null in practice. | `user_id` (GET list); `public_published` RLS for `/lp/[slug]`. |
| **landing_page_leads** | **none** | **Two-hop (latent)** | `lead.landing_page_id → landing_pages.client_id` — and that middle column is itself null in practice, so leads are effectively unattributed. | `user_id` only; the sole reader is `/api/recommendations` (global count, never per client). |
| **brief_analyses** | **none** | **Two-hop (latent)** | `brief_id → briefs.client_id`. `brief_id` is set when a brief is picked in the UI (`analyze-brief/page.tsx:42`), null on pasted text. | Owner-scoped `"own"` RLS; dashboards re-run rather than list. |
| **weak_ad_analyses** | **none** | **Absent** | No column, no `brief_id`, no ad ref — the "ad" is free-text `ad_text`. Active client is resolved for AI context (`tools/route.ts:40`) then dropped. | Owner-scoped `"own"` RLS; no list reader. |
| **ad_performance** | yes, **NOT NULL** (`002`) | **Populated (mandatory)** | Direct column, always set from the validated `?clientId` (`analytics/route.ts:69`). But `ad_account_id` is **account-level — no `ad_id`**. | Client-scoped: `reports/route.ts:17` by `client_id`+dates; `analytics` 404s without `?clientId`. |
| **offer_stacks** (contrast) | yes **and** `brief_id` (`005_phase_c`, both ON DELETE SET NULL) | **Latent** | Route forwards `client_id`/`brief_id` from input (`tools/route.ts:215`), but the offer-stack UI sends neither (`offer-stack/page.tsx:35`) → null in practice. | Owner-scoped `"own"` RLS. |

## Cross-cutting themes

### 1. "Resolve active client → feed AI context → drop at persistence"
A recurring pattern: a writer reads the active client (cookie/body), uses it to build AI context, then fails to store it on the row.
- **generated_images** smart path — `clientId` → `runImagePipeline`, no column to persist it (`images/route.ts:195` → insert `:210`). *(locked: `images-content.test.ts`)*
- **weak_ad_analyses** & **brief_analyses** — `activeClientId` → `buildAiContext` (`tools/route.ts:40-41`); weak has no column at all, brief stores only `brief_id`. *(locked: `ad-analysis.test.ts`)*
- **generated_content** via `/api/ai` — a near-miss *with* a column: it resolves `activeClientId` (`ai/route.ts:41`) yet the insert omits `client_id` (`:79`). The column exists; the writer just doesn't fill it. Only master-studio (`ai/master/route.ts:85`) actually persists it.

Net effect: even where attribution is "available," it's inconsistently captured. A per-client rollup today would mostly read empty for images, leads, weak-ad and brief analyses, and standard AI posts.

### 2. No `ad_id` / specific-ad entity anywhere
No table models a specific ad. `ad_performance` is an **account + date** aggregate (`UNIQUE(client_id, ad_account_id, date)`), and `weak_ad_analyses` keeps only the pasted `ad_text`. So "the performance/analysis of *this* ad" cannot be expressed in the current schema — only per-account metrics and per-paste text analyses exist.

### 3. Billing wart — deduct-before-validate, no refund
In `/api/tools`, `deductCredits` runs (`tools/route.ts:36`) **before** per-tool validation. Two early-return 400s charge the user without a refund:
- `analyze_weak` with empty `ad_text` (`:103`)
- unknown `tool` (`:223`)

Both paths short-circuit before the `catch` (which is the only place `refundCredits` runs), so credits are spent on invalid input. *(locked: `ad-analysis.test.ts`)*
