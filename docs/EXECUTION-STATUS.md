# AdMaster Pro — Execution Status (LIVE)

> Single source of truth for the MASTER-PLAN execution. Orchestrator-maintained.
> States: `todo` → `doing` → `pr-open` → `green` → `merged` · or `BLOCKED-ON-HUMAN`.
> Plan: `docs/MASTER-PLAN.md`. Date started: 2026-06-29.

---

# ===== SESSION 2026-07-05 — UX layer: client-context propagation + campaign traceability =====

**Theme:** make the whole app operate in ONE client's context, and make the owner's real campaign path auditable — then verify it all live on prod. Doctrine held: additive only, no migrations this session, money gate untouched, self-campaign PAUSED.

**Merged to main (all live-verified on prod):**
- **Option B — client-context propagation (PR #63, `42db8c9`).** `ClientProvider` (`components/ClientProvider.tsx`) is the single source of truth for the active client (reactive context over the `admaster_active_client` cookie). The top `ClientSwitcher` writes it; every dashboard screen reads it via `useActiveClient()`. Removed the ~10 duplicate client pickers; Create Post / calendar / messages / series / approvals read context directly; Meta-field screens (campaign/publish/schedule/pixel) + analytics/reports default to the active client and gate their picker behind no-active-client; library/history open pre-scoped; briefs/send-brief/analyze-brief default their target; images sends `client_id`; `ConnectFacebookButton` falls back to context. Principle documented in `docs/CLIENT-UX-PLAN.md` §"Client-context propagation". **Prod click-through: Create Post / quick-campaign / analytics all follow the switch instantly (in-place, no reload).**
- **quick-campaign decision trace (PR #64, `134587e`).** The path owners actually use now records the SAME grounded trace as every other path: a `campaigns` row (`meta_organic`/`whatsapp`, `status='assembled'`, `dry_run=true`, `meta_campaign_id=null`) + `campaign_items` (one `post` per variant, artifact-linked) + `campaign_decisions` (channel · platform · framework), all `grounded_in` the atoms `buildAiContext` used. Client-aware via `client_id` from context (cookie fallback). **Prod E2E verified: real rows created, grounded in the client's atoms, visible in the Command Center.**
- **Command Center status reconciliation (PR #65, `de53046`).** Fixed two bugs: (1) `resume→'active'`/`approve→'approved'` were NOT in the `campaigns.status` CHECK → DB constraint errors; now `pause→paused`/`resume→live`/`approve→scheduled`, all validated with `canTransition()` before the write (illegal → 409). (2) the WHY panel rendered `campaign_decisions.decision` (jsonb OBJECT) as a React child → crash on ANY campaign with decisions; now `summarizeDecision()` renders it as text. Label maps rebuilt to the real vocabulary (status/channel/funnel/decision-type + `failed_link`); action buttons gated to only-legal transitions. **Prod: Command Center renders all campaigns (incl. a 7-decision runner campaign) with no crash; approve `assembled→scheduled` persists, `dry_run` stays true.**

**Open PR (found during the prod click-through — HELD for owner merge):**
- **quick-campaign duplicate-write fix (PR #66).** One generation created TWO identical campaigns + double 15-credit charge. Root cause: the route had no `maxDuration`, so a ~50-60s Anthropic call runs on the default Node budget and a long request gets re-driven → double trace + double charge. Fix mirrors the master route: `export const runtime='nodejs'; maxDuration=300`. tsc + build green. **Urgent — live double-charge until merged.**

**Findings / follow-ups:**
- **Command Center is owner-wide, not client-filtered.** It renders every owner campaign regardless of the active client — the one screen that does not "follow" the switch. Deliberate design so far (the "see everything" view); client-scoping is the `CLIENT-UX-PLAN` §1 wave (the client command center). **Owner decision needed:** scope it to the active client (with a "no client = all" fallback, consistent with analytics/reports) or keep it owner-wide.
- **S5 (PR #54 — Next.js 15.5.20 + React 19) — STILL HELD, needs a focused rebase.** It predates this session's 4 merges and now conflicts with current main: **4 real content conflicts** (`campaign/page.tsx`, `publish/page.tsx`, `command-center/campaigns/[id]/route.ts`, `components/ClientSwitcher.tsx`) + it requires migrating the NEW code added this session to Next 15's async-`params` contract (e.g. the Command-Center PATCH must become `params: Promise<{id}>` + `await params`). Per the "stop on real conflicts/breakage" rule, NOT force-merged. **Recommended:** a dedicated rebase pass that (a) resolves the 4 conflicts by taking this session's logic in Next-15 form, (b) re-runs tsc + full test suite + build + `npm audit` against current main (S5's old green run predates today's code), then merges. S5 clears 9 HIGH `next` CVEs, so it's worth doing soon — just not rushed alongside feature work.

**Money gate / self-campaign:** every campaign this session is `dry_run=true`; approve never touches `dry_run`; no Meta object, no publish, no spend. Self-campaign (`62dce105-…`) untouched, still PAUSED.

**Still remaining (external / prior "on the 10th"):**
- **Nano Banana image gen (Gemini)** — blocked on Gemini API billing (free tier 429s on `gemini-3-pro-image`). Owner said billing "around the 10th"; until then image gen stays on the cheap default / Ideogram path.
- **Self-campaign go-live review** — the staged AdMaster self-campaign stays PAUSED pending an owner review; no unpause code exists (structural gate).
- **Fuller UX plan waves** (`docs/CLIENT-UX-PLAN.md`) — the client command center (client-scoped campaigns + WHY + diagnosis under one client page), the command-center sidebar entry, and the `/quick-campaign` → client-command-center linkage remain to build. The status-vocabulary prerequisite (this session's #65) is now cleared.

---

# ===== SESSION 2026-07-04 (morning) — audit #2 + bugs + C-02 =====
- **PART 1 — Security Audit #2 of PR #44/#45 (`docs/SECURITY-AUDIT-2.md`/`HARDENING-PLAN-2.md`).** 4 parallel auditors. **0 CRITICAL; 4 HIGH — all fixed + merged (PR #47, mig 045):** F1/F2 cost-DoS gates on `/api/voc`+`/api/competitor-watch` (credit-gate + rate-limit + `MAX_ADS_PER_RUN=40`); HB-1 heartbeat claim unique index (=bug #4); PII-1/PII-2 VoC stores stripped text at rest. **Money/autonomy gate HOLDS** (5 gates); RLS owner-only on all 13 new tables (prod-verified). MED/LOW tracked.
- **C-02 episodic activated (PR #46, mig none):** provided GOOGLE_AI_API_KEY exposes `gemini-embedding-001` (not text-embedding-004) → embedder repointed @768 dims + L2-normalized; key in .env.local + Vercel Prod/Dev.
- **PART 2 — bugs (branch `fix/part2-bugs`, mig 047+048 applied):** #1 logout → server-side `/api/auth/logout` clears httpOnly cookies + hard-nav (client-only signOut left them, "stuck logged in"); #2 brain-hang → BuildingBrain now TRIGGERS the idempotent `/api/client-core/run` (resolves latest brief) instead of only polling a freeze-prone `waitUntil` (root cause: orphaned safety-net endpoint, no retry path); #3 meta_connections FK already→clients (no repoint), added `token_expires_at` + stored in both callbacks + C-06 pipe-health expiry blocker (mig 047); #4 done in Part 1; #5 widened `learning_signals` CHECK with `competitor_evidence` (mig 048). tsc clean · 1510 tests · build 120/120.
- **PART 3 billing/anti-abuse:** #6 owner exemption APPLIED (mig 049 — `users.credits_exempt` + `deduct_credits` skips charge/limit; `elirankahalani27@gmail.com` exempt, verified no-charge). #7 150 free credits already default (`handle_new_user`). #8 anti-abuse (PR #51, mig 050) DORMANT-SAFE: fingerprint+IP+SMS OTP (InforU mock-default)+repeat-business; phone-gate off until `NEXT_PUBLIC_SIGNUP_PHONE_VERIFICATION=true` (after InforU creds C2). Security-review follow-up fixed (PR #55): gate fails closed in prod, no error-message leak.
- **PART 4 Meta:** organic scopes added (PR #49) then REVERTED to 5 paid (PR #53) — Facebook rejects `pages_manage_posts`/`instagram_basic`/`instagram_content_publish` as Invalid until Meta-console Login use case + App Review. Paid connection unblocked. T8 live scope-check on (mig H4 env set: App ID/secret validated vs Graph, redirect URIs, state secret, `META_LIVE_SCOPE_CHECK=true`; Vercel Prod+Dev).
- **PART 5 (S5):** Next.js 15.5.20 + React 19, **next HIGH CVEs 9→0**, tsc/build/1548 tests green — **PR #54 HELD for owner merge** (major upgrade).
- **AUTH FLOW (owner-requested full audit, PR #50+#52):** 3-bug chain fixed — logout (#48), CSP missing `connect-src` blocked browser→Supabase fetch (#50), **middleware blocked `/forgot-password`/`/reset-password`/`/auth/callback` for logged-out users** (#52, the big one → recovery+confirmation broken end-to-end). All auth flows now code-correct. Owner password admin-set + login-verified.
- **FOLLOW-UPS / external:** **(organic Meta scopes)** re-add `pages_manage_posts`+`instagram_basic`+`instagram_content_publish` after app Live mode + Business Verification + App Review (revert of PR #53). **(SMTP/H2)** custom SMTP needed for reliable signup-confirm + password-reset email delivery (email-confirmation is ON). **(InforU/C2)** SMS creds to activate the #8 phone-gate. **(CSP tighten)** narrow `connect-src https:` to an explicit allow-list. **(S5 merge)** owner to merge PR #54. **(lucide-react)** peer-range warning under React 19.

---

# ===== HEARTBEAT + REMAINING CAPABILITIES (2026-07-04) — plan: VISION-DEEP §1–§7 + spec C-04/09/11 =====

**Branch:** `feat/heartbeat-and-capabilities` off `origin/main` @ `586ddf1` (post-#44 merge). Baseline verified green: tsc clean, **1,097 tests**. Same doctrine: disjoint folders, serial shared files, gate after each integration, branch always green, everything dry-run/PAUSED.

| Item | State | Notes |
|---|---|---|
| Foundation: migrations **039–043 applied+verified** (heartbeat_runs, client_autonomy+autonomy_events, digests, competitor_entities+competitor_ads, fleet_daily_factors) — RLS 7/7; fleet table policy-less by design (service-role only, aggregate) + contracts extension | **done** ✅ (`e488a5b`) | |
| Autonomy (`lib/autonomy` + API) — **retrofitted to D1's 3 user-selectable modes** (migration 044 applied): draft_only / propose_approve (default) / act_within_caps; protective-bypass, malformed-block ordering, rate limit, fail-safe audit downgrade (no un-audited execution EVER), graduation = mode SUGGESTION only | **green ✅** (78 tests) | all L0-L3 invariants preserved through the retrofit |
| C-09 competitor watch (`lib/competitor-watch` + API) — longevity method (56d veteran / 28d churn boundaries), coverage map w/ hand-argued fixture, manual-paste fetcher (Hebrew metadata aliases, deterministic refs), audited atom emission | **green ✅** (80 tests) | learning_signals 'competitor_evidence' CHECK widening = logged follow-up |
| C-04 shock detection (`lib/fleet`) — median+MAD, direction quorum, ≥8-client activation gate, IL calendar overlay (honesty-noted Gregorian windows), split-market contrast proven | **green ✅** (78 tests) | found+handled: live perf pipe stores `conversion_rate` not `cvr`, no `cpm` key (derived) |
| C-11 experiments (`lib/experiments`) — info-value slates (Bernoulli-variance belief movement), deterministic seeded Thompson, floors-first allocation, pooling readiness; zero C-01 reimplementation | **green ✅** (70 tests) | ₪50/day headline scenario proven both maturity ways |
| Digest composer (`lib/digest` + API) — deterministic narration; 3-layer structural anti-hallucination (no generative path, source-id accounting, ₪/% whitelist scan test); approved digests immutable (CAS) | **green ✅** (29 tests) | 'sent' gated on C2 by design |
| **Wave A gate** | **green ✅** (`95d5dc5`) | 1,445 tests, build clean (118 pages), composition holds |
| **D1 retrofit** (3 modes) + composition extension (slate→mode-gate→shock flow) | **green ✅** (`3fc0afe`, `9eb3630`) | 1,432+ tests (grid restructure −9 explained), migration 044 applied+verified |
| **Marketing Heartbeat** (`lib/heartbeat` + cron API) — daily (shock-annotated hypothesis review: mercy kills routed through autonomy, floor-met → resolveAndLearn), weekly (attention-ordered "Monday plan": slate → register → ≤1 dry-run campaign → digest with the week's proposals), monthly (strategy re-synth + mode suggestion + monthly digest); claim-lease ledger (calendar-window idempotency, stale-lease reclaim); CRON_SECRET-gated API (fail-closed, Vercel-Cron GET compatible) | **green ✅** (58 tests) | knowledge actions (verdicts) don't route through the money gate — documented WHY; deterministic, zero LLM in the loop itself |
| **FINAL GATE (whole branch)** | **green ✅** | repo-wide tsc clean · **1,495 tests, 0 fail** · prod build clean (119 pages) · composition suite (3 flows) passes |

**Go-live flip (deliberately NOT wired — Eliran's call):** vercel.json crons `{/api/heartbeat?tick=daily @ 0 4 * * *, weekly @ 0 5 * * 1, monthly @ 0 6 1 * *}` + `CRON_SECRET` env. Until then the heartbeat is a fully-tested engine with no scheduler pulling it — no LLM spend, no rows written for real clients without opt-in. **Logged follow-ups:** partial unique index on heartbeat claims before any parallel-worker future · `learning_signals` 'competitor_evidence' CHECK widening · approvals surface (C2) for real proposal-resolution tracking.

---

# ===== MARKETING CAPABILITIES — OVERNIGHT BUILD (2026-07-03/04) — plan: `docs/MARKETING-CAPABILITIES-SPEC.md` =====

**Branch:** `feat/marketing-capabilities` off `origin/main` @ `9a9e718` (post-#42 epic merge + #43 H4 wiring). Baseline verified green: tsc clean, **644 tests**, prod build (verified at gates). Doctrine: excellence over volume; every capability atom-grounded, deeply tested, adversarially reviewed; branch stays green; additive migrations only; everything dry-run; no live/spend actions.

**Scope (buildable-now from spec):** C-01 hypotheses · C-02 episodic (pgvector) · C-03 calibration · C-06 attention · C-07 brand-lint · C-08 VoC · C-10 strategy-objects. Wire-ins into shared files (decision engine, generation path) deliberately DEFERRED to a reviewed follow-up — capabilities expose typed modules; composition happens through contracts + the lifecycle engine.

| Item | State | Notes |
|---|---|---|
| Foundation: migrations 034–037 authored + **applied to prod + verified** (6 tables, RLS all, `match_episodes` RPC, `learning_signals` CHECK widened additively) | **done** ✅ | preflight: tables absent, pgvector available; post-verify all green; down files authored |
| Foundation: `lib/capability-contracts` (shared row types + Embedder seam; orchestrator-owned) | **done** ✅ | agents import, never edit — collision doctrine |
| C-01 hypotheses (`lib/hypotheses` + read API) | **green ✅** (77 tests) | pure core (validate incl. §7 resolvability math / resolve vs frozen criteria / kill-rule boundaries) · resolution flows through `lib/intelligence` lifecycle ONLY (signal→claim→apply, insight_events audited) · two-layer CAS idempotency (`WHERE status='open'` + claimSignal) · immutability by supersession · priors-as-warnings dedup guard |
| C-02 episodic (`lib/episodic` + backfill script) | **green ✅** (61 tests) | deterministic Situation/Action/Outcome/Lesson composition · Hebrew-aware PII/name abstraction (gershayim-tolerant, IL-anchored phone regex, too-short→null=fleet-excluded) · Google embedder behind `Embedder` seam + deterministic test embedder · 1-batch-embed/1-bulk-upsert ingest (N+1-proof) · backfill dry-run-by-default, verified no-op vs prod |
| C-03 calibration (`lib/calibration`) | **green ✅** (45 tests) | Brier + PAV isotonic (exact L2, hand-computed expectations in tests) · exclusion semantics typed (inconclusive/killed excluded, documented WHY) · headline test: overconfident 'angle' domain exposed + corrected, calibrated 'offer' untouched |
| C-06 attention (`lib/attention`) | **green ✅** (50 tests) | information-value ranking (headline: token-error & near-floor hypothesis outrank big quiet client; size NEVER feeds score) · peak-near-floor Gaussian · calendar decision-lag math (30d-out event with 45d lag = urgent NOW) · one-query-per-table loaders, test-enforced |
| **Wave A integration gate** | **green ✅** | repo-wide tsc clean · **877 tests** (644 baseline + 233 new, 0 fail) · prod build clean · adversarial review passed (casts/any/silent-catch greps + behavior spot-runs) |
| C-07 brand-lint (`lib/brand-lint`) | **green ✅** (76 tests) | deterministic pass: Hebrew clitic-chain prefix matching (ומבצע caught, מקלדת safe), curated gender-address markers (mixed 2sg = block; honest limits documented), grapheme-cluster emoji policy (`Intl.Segmenter`; ZWJ family = 1), 12 Meta personal-attribute block patterns · LLM register check behind `RegisterJudge` seam — judge errors → `flag`, publishing never LLM-hostage · zero casts anywhere |
| C-08 VoC ingestion (`lib/voc` + API) | **green ✅** (60 tests) | seven extractables via reviewable Hebrew prompt · **anti-fabrication gate** (quote must be a normalized span of the source; reworded quotes rejected+counted) · PII stripped BEFORE the LLM (tested) · reconcile flows through the real lifecycle only (contentMatches/claimSignal/applyLearningSignal; weight 0.25→0.4 on cross-document recurrence) · proof quotes corroborate-only (owner permission before quoting per craft) · resumable status flow, dedupe idempotency |
| C-10 strategy objects (`lib/strategy-objects` + API) | **green ✅** (60 tests) | deterministic atom→pillar projection (greedy contentMatches clustering, summed-confidence ranking, content-independent pillar keys so coverage survives anchor drift) · funnel designed walk-backwards, every edge expected-rate + provenance (client_baseline n≥30 > declared_guess > playbook_prior) · funnelHealth blames only statistically sufficient edges (n≥30) · version race handled (23505 retry) · skip-on-identical (no version churn) |
| **Wave B integration gate** | **green ✅** | repo-wide tsc clean · **1,075 tests** (0 fail) · prod build clean (114 pages) |
| **Composition proof** (`tests/capabilities-composition.test.ts`, orchestrator-owned) | **green ✅** | ONE hypothesis flows C-06 attention (open, near-floor → tiny client outranks big quiet one) → C-01 resolve (frozen verdict_map honored) → C-03 calibration (registered 0.7 belief → brier 0.09) → C-02 episode (win, Hebrew name abstracted); same atoms → C-10 pillars + C-07 lint (bad copy blocked, atom-consistent copy passes). The contracts module held across all six with zero adjustment |

**Orchestrator integration fixes during Wave A gate:** (1) supabase-js v2 type pathology — structural DB-seam assignment passes bare tsc but blows TS2589 under Next's build pass; standardized a runtime-guarded type-predicate bridge (zero casts) in `lib/attention/load.ts` + `lib/calibration/store.ts`; (2) removed a stray agent debug file (`__seamprobe.ts`).

**Wire-ins (continued run, orchestrator-serial):**
| Wire-in | State | Notes |
|---|---|---|
| W4: migration **038** — first-class `'voc'` InsightSource (CHECK widened additively, **applied+verified**) + `lib/voc` switched to it | **green ✅** | closes C-08's provenance follow-up |
| W1: runner → C-01 pre-registration — every executed `MarketingDecision` registered as a frozen falsifiable hypothesis (`hypothesisFromDecision`, pure) grounded in exactly `decision.grounded_in`; weights 0.4/0.3 (below decisive — one campaign never refutes alone); registration failure degrades to a note, never blocks the run; fully-injected test contexts stay side-effect free | **green ✅** (+9 tests; **1,085 total**) | §8.2.6 pre-registration is now live runner behavior, not just a library |
| W2: decision context → C-02 precedents — runner recalls the k most-similar past episodes per decision (`episodicRecaller`, degrades gracefully without embedder key), records them as a grounded `'precedents'` decision-log row, and the generator prepends them to every stage's context; `generated_from.precedents_in_context` stamped | **green ✅** | decide() stays pure — memory joins at the runner/generation seams |
| W3: generation path → C-07 lint stamp + C-08 quote bank — the generator pulls funnel-stage VoC quotes into the brief ("customer's own words for hooks"), lints the winning draft against brand_voice atoms (deterministic rules, REAL lint in tests), stamps verdict+violations into `generated_from.lint`; quote-bank failure stamped as `voc_bank_error`, never blocks | **green ✅** | lint stamps, publish-gate policy reads them (follow-up) |
| Consolidation: `lib/pii` — shared primitives (URL/email/IL-phone regexes, gershayim-tolerant term matching) extracted from voc/episodic; both consumers refactored, POLICIES stay with owners; both suites pass unchanged | **green ✅** | byte-identical regexes proved the extraction safe |
| **FINAL VERIFICATION PASS** | **green ✅** | repo-wide tsc clean · **1,097 tests, 0 fail** · prod build clean (114 pages) · composition test passes WITH wire-ins · RLS re-verified in prod 6/6 tables + 6/6 policies · both CHECK widenings live · zero ts-suppressions, zero silent catches (last one fixed → stamped error), shared-file diff vs main = 6 files, all deliberate wire-ins, zero overlap with the security session's merged files |

**Skipped/logged for morning:** `GOOGLE_AI_API_KEY` in `.env.local` is an empty placeholder — live embeddings (C-02 runtime/backfill `--execute`) need a real key; everything ships dormant-safe (deterministic embedder for tests, dry-run default). `meta_connections` is keyed to the legacy `meta_clients` id space and has no expiry column → C-06 errorStates are caller-injected until the meta-health wire-in (TODO in code).

---

# ===== AI MARKETER EPIC (active focus, 2026-07-01) — plan: `docs/AI-MARKETER-MASTERPLAN.md` =====

**Branch:** `feat/ai-marketer-epic` (off `origin/main` @ `15ff2e4`). Baseline verified green: tsc clean, 376 tests, Node 20, Playwright present.

**Ground-truth (prod, data-plane verified 2026-07-01):** brain live + in use — `clients=7`, `client_insights=27`, `client_strategy`/`content_artifacts` present. `campaigns/content_performance/diagnoses/whatsapp_messages` absent (404) → 030 needed, no collision. ⚠️ **`meta_connections` returns 404 in prod** — table the OAuth callback writes to may NOT actually be applied despite docs claiming mig 019 landed; reconcile during H4/Wave-2.

**Capability blockers:** **C1 RESOLVED** ✅ (2026-07-01) — Postgres conn string in `.env.local` `SUPABASE_DB_URL` (session pooler); **full additive-migration autonomy live** (destructive still gated). **H4** Meta App EXISTS; awaiting App ID/secret + approved-scope audit + redirect URIs. **C2** InforU creds incoming; mock meanwhile. **MONEY** gate before unpausing paid (stands).

**PROD-SCHEMA RECONCILIATION (verified via PostgREST 2026-07-01):** docs claimed 019/020/021/025 applied, but prod says otherwise:
- `meta_connections` (019) → **404 PGRST205, genuinely absent** → merged OAuth connect flow would fail in prod.
- `report_shares` (025) → **404, genuinely absent** → `/report/<token>` share-link broken in prod.
- Present: `meta_clients`, `ad_performance`, `briefs`, and brain tables (`clients`/`client_insights`/`content_artifacts` = 026–028).
- **Migration backlog — APPLIED + VERIFIED ✅ (2026-07-01):** `030` (6 ai-marketer tables, all 200 on data plane, RLS on, `scope_item_id` present) + `031` (created `meta_connections` + `report_shares`, **FK→clients** not legacy meta_clients, both 404→200). Meta OAuth connect flow + `/report/<token>` are now schema-backed in prod. (020/021 legacy connect-token columns: superseded by the v2 `clients`/`meta_connections` model — not needed.)

**Wave 1 COMPLETE (2026-07-01):** all 7 subsystems integrated + green — tsc clean, **545 tests**, prod build clean (all new routes compiled), and the **dry-run closed-loop E2E passes** (`tests/e2e/ai-marketer-loop.test.ts`): decide→runCampaign(dry-run,PAUSED,0 live calls)→ingestPerformance→diagnose(OFFER via objection atom)→autoImprove(A/B + weakens that atom + audit). Commits: Wave1a `e327f20`, Wave1b `321a490`, E2E `2ab88e3`.

| Task | State | Owns (disjoint) | Notes |
|---|---|---|---|
| T0.1 commit orphan migs (019–029) + docs + plan | **done** ✅ (`1b7292a`) | `supabase/migrations`, `docs` | record-keeping; non-destructive |
| T0.2 migration 030 (additive) | **authored, await C1 apply** | `supabase/migrations/030*` | self-reviewed vs 028 conventions |
| T1 Decision Engine (moat) | **green ✅** (37 tests, `c65c5f0`) | `lib/decision-engine/**` | pure core + isolated LLM refine |
| T3 Meta Ads object model + client (sandbox) | **green ✅** (29, `50691e4`) | `lib/meta-ads/**` | objects default PAUSED |
| T4 Organic publishing (dry-run) | **green ✅** (12, `3b80603`) | `lib/meta-publish/**` | |
| T6 WhatsApp (InforU) adapter | **green ✅** (25, `50f3bef`) | `lib/whatsapp/**`, `app/api/whatsapp/**` | mock-default, live gated C2 |
| T7 Owner Command Center | **green ✅** (14, `8bdf360`) | `app/(dashboard)/command-center/**`, `app/api/command-center/**` | surfaces the WHY |
| **Wave 1a integration** | **green ✅** (`e327f20`) | orchestrator | tsc + **493 tests** + prod build all clean; all new routes compiled |
| T2 Campaign domain + runner (dry-run) | **green ✅** (27, `2ef3010`) | `lib/campaigns/**`, `app/api/campaigns/**` | decision→Meta targeting map; PAUSED |
| T5 Diagnosis + auto-improve engines (fixtures) | **green ✅** (24, `54280e9`) | `lib/diagnosis/**`, `lib/performance/**` | reuses intelligence lifecycle |
| **Wave 1b integration** | **green ✅** (`321a490`) | orchestrator | tsc + **544 tests** |
| Dry-run E2E closed-loop | **green ✅** (`2ab88e3`) | `tests/e2e/` | full loop runs in-process; 545 tests |
| T8 Meta connection health/readiness (dry-run) | **green ✅** (12, `a4f3ffd`) | `lib/meta-health.ts`, `app/api/meta/health/**` | live scope-check opt-in; flip on at H4 |
| T9 live publish wiring (sandbox, behind flag) | **green ✅** (13, `5ead7a2`) | `lib/campaigns/**` | `LIVE_PUBLISH_ENABLED` off; always PAUSED; spend-cap; unpause = MONEY gate |
| T10 live performance ingestion (sandbox) | **green ✅** (7, `385130d`) | `lib/performance/ingest-live.ts` | Meta insights→content_performance via ad_id; fetch flips on at H4 |
| T11 dry-run closed-loop E2E + trace script | **green ✅** (4, `4bbc00e`) | `tests/e2e/**`, `scripts/**` | `node scripts/e2e-ai-marketer-dryrun.mjs` = PASS |
| **Wave 2 integration** | **green ✅** (`85b9a4b`) | orchestrator | tsc + **581 tests** + prod build + E2E script PASS + route smoke (307 gate / 401 / boot OK) |

**WAVE 2 COMPLETE (2026-07-01).** Whole plan (Wave 0→2) built. Live half fully coded behind flags/mocks → go-live = creds + flag flip, not new construction. Remaining = external only: **H4** (Meta App ID/secret + scope audit → flip T8 scope-check, T9 `LIVE_PUBLISH_ENABLED`, T10 fetch), **C2** (InforU creds → WhatsApp live), **MONEY** gate (unpause paid). Deferred: authed browser walkthrough of `/command-center` (needs a test session/seed data), image-URL wiring for live paid creatives (master-studio stores a prompt, not a URL).

---

# ===== SECURITY AUDIT + WAVE-1 HARDENING (2026-07-03) — reports: `docs/SECURITY-AUDIT.md`, `docs/HARDENING-PLAN.md` =====

**Audit:** 6 parallel auditors (RLS/IDOR/AuthN · secrets/OAuth/webhooks/deps · injection/XSS/prompt · money-gate · correctness/reliability · code-health). 32 findings: **1 CRITICAL · 8 HIGH · 15 MED · 6 LOW**. Verified SAFE: RLS owner-only on all 026–031 tables, AuthN, AES-256-GCM token crypto, OAuth CSRF state, Stripe webhook sig+idempotency, no SQL-injection, no committed secrets. **💰 MONEY-GATE VERDICT: holds structurally** — every Meta object hard-coded PAUSED, no code path unpauses/activates, live path fails CLOSED. (Forward-looking R1: gate the autopilot `launch` step before `feat/meta-ads-launcher` merges.)

**Wave-1 fixes — DONE + VERIFIED ✅ (commit `9a96430`, migration `032` applied):**

| # | Sev | Finding | Fix | Proof |
|---|---|---|---|---|
| S1 | CRITICAL | cross-tenant BOLA on `/api/client-core/run` | orchestrator verifies `clients.owner_user_id` under admin client + unconditional `brief.client_id===clientId` (null-bypass removed); route RLS pre-check | tests (e)+(f) |
| C1 | HIGH | concurrent brief double-build/charge | atomic `claim_client_build` RPC (CAS on `core_building_at`) | test (g) |
| S2 | HIGH | stored XSS in public landing pages | `lib/safe-url.ts` at render+write, sandboxed host-allowlisted iframe, global CSP | 14 tests |
| S3 | HIGH | serverless-ineffective rate limiter | durable `check_rate_limit` RPC (`checkRateLimitDurable`), fail-open | 5 tests + live DB (t/f) |
| S4 | HIGH | unauth brief-submit → unbounded LLM cost | hard per-client durable throttle (5/hr) before orchestrator; brief still saved | brief-resubmit tests |
| S6 | MED | competitor/reports ungated LLM spend | deduct+refund + per-user durable limit | tsc+suite |

**Migration 032 (additive/idempotent/reversible) APPLIED + verified on prod:** `briefs_client_id_uniq`, `client_strategy.core_building_at` + `claim_client_build()`, `rate_limits` (RLS on, 0 policies, DEFINER-only) + `check_rate_limit()` (both `SECURITY DEFINER`, live behavior confirmed).

**Green:** tsc clean · **603 tests** (+22) · prod build 110/110 pages.

**Wave-2/3 fixes — DONE + VERIFIED ✅ (commit `b5e74af`, migration `033` applied):**

| # | Sev | Finding | Fix | Proof |
|---|---|---|---|---|
| C2/H2 | HIGH/MED | autopilot timeout → silent credit loss + stuck `running` | `maxDuration=300` + opportunistic stale-run reconciler (claim-then-refund) + resume-from-`current_step` (no double-charge) + typed `PipelineAcc` bus | `autopilot-reconcile` (6) |
| C4 | MED | learning-signal double-apply | `processed`-flag CAS (only winner applies) + 5s rapid-click dedup | lifecycle/signal tests |
| C5 | MED | perf-ingest / auto-improve non-idempotent | `content_performance` UPSERT on mig-033 unique key; auto-improve gated by `diagnoses.applied` | ingest/auto-improve tests |
| C6 | MED | false "brain ready" over empty build | orchestrator stamps `core_generated_at` only when atoms exist | orch test (c2) |
| H1 | HIGH | no runtime validation on LLM→decision→spend | hand-written guards (`parseStrategyAnalysis`) at `runner.ts` seam (degrades to fallback) + `safeJsonParse` on image/judge/scoring | `validation` + runner-degrade tests |
| S7/S11 | MED/LOW | prompt injection | fenced untrusted brief data + `parseAnalysis` hardened (single `[INSIGHTS]` block, no whole-text fallback, `kind∈KINDS[layer]`) | analyze tests |

Dead code removed (3 orphaned avatar modules); live avatar prompt extracted to `lib/avatar-prompt.ts`. **Migration 033** (content_performance unique) additive/idempotent — applied + verified on prod. **Green:** tsc clean · **642 tests** (+39) · prod build 110/110.

**S5 (Next.js 9 HIGH CVEs) — IN-FLIGHT, isolated worktree/branch** (2-major bump 14→16 needs async `cookies`/`params` + React 19; kept off #42 so the hardening merges clean; own PR when green).

**PR #42 status:** every **CRITICAL + HIGH** security finding in the branch is **closed + test-proven** (S1/S2/S3/S4/C1/H1/C2 + Q1). Remaining: **S5** as its own isolated PR; R1 is a merge-gate on the sibling `feat/meta-ads-launcher` branch. Money gate untouched (structural).

---


## Capability-blocker register (human/external — orchestrator cannot do these)
These are surfaced (not me pausing for approval) — all other work proceeds around them.

| ID | Blocker | Needed for | Status |
|---|---|---|---|
| H1 | **Apply DDL in Supabase SQL Editor** (no prod DDL access by policy) | every migration: 019/020/021/025 | pending — files authored + SQL shown, await apply |
| H2 | **Custom SMTP provider creds** in Supabase Auth | W1.1a email delivery, reset/confirm | pending |
| H3 | **Real Stripe price IDs** (`STRIPE_PRICE_STARTER/PRO/AGENCY`) + `STRIPE_WEBHOOK_SECRET` in env | W1.3 live billing | pending |
| H4 | **Meta app redirect URIs + OAuth secrets** (`META_OAUTH_STATE_SECRET`, redirect URI byte-exact) | W4.2 live OAuth | pending |
| H5 | **Merge to shared `main`** — done by orchestrator (ADMIN) only when branch green + deps met | all PR landings | active |

Code is built to green against all of these; H1–H4 only gate the *live* end-to-end, not the code/PR.

## Migration lock (confirm integer before authoring file)
`018` highest committed · **019,020 = W3** (meta_connections) · **021 = W2** (client_core) · **022-024 = avatar-v2** · **025 = W5** (reporting). P1 (money) is **migration-free** (Stripe customer resolved by email, no new column) to avoid colliding with the lock.

---

## PHASE 0 — Land done work
| Task | Branch/PR | State | Notes |
|---|---|---|---|
| Merge #12 (`feat/create-uses-brief`) | PR #12 | **merged** ✅ (`4bfaf59`) | unblocks W2 loader |
| Merge #11 (`feat/brief-magic-link`) | PR #11 | **merged** ✅ (`29c5ae6`) | verifier confirmed safe: local-green, mig 018 additive/idempotent; red "Supabase Preview" = pre-existing duplicate-migration artifact, not the real gate. **Mig 018 already applied to prod per PR.** |
| ~~Re-point #10 in P0~~ | — | **moved to P2** | Hard edge `019/020 → re-point #10`; cannot precede W3 migrations |

## PHASE 1 — Money (parallel with 502 fix) — does NOT depend on P0 merges
| Task | Branch | State | Worker |
|---|---|---|---|
| W4.1a/b create-post 502 fix | `fix/create-post-502` → PR #14 | **merged** ✅ (`006ab48`) — tsc/build/152 tests | A |
| W1.2a/b auth callback + forgot/reset password + login link | `feat/password-reset` → PR #13 | **merged** ✅ (`913d643`) — tsc/build/142 tests | B |
| W1.3a/b Stripe correctness (topup credit, sub metadata, portal by email) + W1.3c portal UI | `fix/stripe-billing-correctness` → PR #15 | **merged** ✅ (`634ff5d`) — tsc/build/149 tests; used `status='paid'` to respect existing CHECK (no migration) | C |
| W1.1a Custom SMTP config | (config) | **BLOCKED-ON-HUMAN (H2)** | — |
| W1.4a Post-signup onboarding | `feat/post-signup-onboarding` → PR #20 | **merged** ✅ (`7141e76`) — tsc/build/186 tests; new-user FirstRunHero, non-trapping | E |

**P1 COMPLETE** ✅ (code) — all of money/auth/onboarding/502/security merged. Live operation still needs H2 (SMTP creds) + H3 (Stripe price ids + webhook secret).

## PHASE 2 — Execution spine (starts only after P0 + P1 merged)
| Task | Branch | State |
|---|---|---|
| W3.1a 019 meta_connections (table+RLS+backfill) | (DDL) | **applied** ✅ (human, verify passed) |
| W3.1b 020 connect-token | (DDL) | **applied** ✅ (human, verify passed) |
| W2.1a 021 client_core | (DDL) | **applied** ✅ (human, verify passed) |
| W3.2a re-point #10 callback → meta_connections + W3.4a read paths | PR #10 | **merged** ✅ (`bf5937e`) — un-drafted, tsc/169 tests; audit: no direct token reads bypass `getDecryptedMetaToken` | W3-A |
| W3.3a/b session-less connect-link (mint + public resolver + authorize + service-role callback) | `feat/meta-connect-link` → PR #21 | **merged** ✅ (`f4f1bb6`) — tsc/build/199 tests; `verifyState` now userId-OR-connectToken (dashboard path unweakened) | W3-B |

**P2 COMPLETE** ✅ (code) — agency model (#10 re-point + #21 connect-link) + client-core spine (#17/#18/#19) all merged. Gated/deferred: W4.2a OAuth env + connect callback redirect URI = **H4**; W4.2b graph-version unify = deferred hygiene; W2.5a Avatar v2 = P4.
| W3.4b un-draft + merge #10 | PR #10 | **done** ✅ (merged with re-point) |
| W2.4a/b buildAiContext extend + images straggler | `feat/aicontext-client-core` → PR #18 | **merged** ✅ (`0f098e6`) — tsc/build/174 tests | W2-C |
| W2.2a analyze_brief → lib + persist business_analysis | `feat/analyze-brief-lib` → PR #17 | **merged** ✅ (`62e9dc8`) — tsc/build/175 tests | W2-A |
| W2.3a/b/c orchestrator + brief-submit hook (no new journey states; core_generated_at signals readiness) | `feat/client-core-orchestrator` → PR #19 | **merged** ✅ (`f0e7c8a`) — tsc/build/179 tests | W2-B |

**Tech-debt logged (non-blocking):** (1) Avatar v1 prompt now duplicated — server copy `lib/client-core/avatar.ts` vs client-component `buildAvatar`; dedupe by routing the manual avatar button through the lib via an API route. (2) `recommendations` route still reads `meta_clients.selected_*` (stale for brand-new connection-only clients) — re-point to active connection. (3) brief-submit fire-and-forget has no `waitUntil` (serverless caveat); `/api/client-core/run` + idempotency are the safety net.
| W2.4a/b buildAiContext extend + images straggler | `feat/aicontext-client-core` | **doing** (worker W2-C) |
| W3.3a/b connect-link + session-less OAuth | `feat/meta-connect-link`, `feat/meta-connect-oauth` | todo (needs #11) |
| W3.4a read paths via getActiveConnection | `feat/meta-read-via-connection` | todo |
| W3.4b un-draft + merge #10 | PR #10 | todo |
| W2.1a 021 client_core migration | `feat/client-core-migration` | todo (needs #12 merged ✓ pending) |
| W2.2a analyze_brief → lib | `feat/analyze-brief-lib` | todo |
| W2.3a/b/c journey states + orchestrator + brief-submit hook | `feat/journey-core-states`,`feat/client-core-orchestrator`,`feat/brief-submit-orchestrate` | todo |
| W2.4a/b buildAiContext extend + images straggler | `feat/aicontext-client-core`,`feat/images-simple-grounding` | todo |
| W4.2a/b Meta OAuth env wiring + graph-version unify | `chore/meta-oauth-env`,`chore/meta-graph-version` | todo |

## PHASE 3 — Differentiator (after P2 merged)
| Task | Branch | State |
|---|---|---|
| W5.1a attribution capture | `fix/attribution-capture` → PR #24 | **merged** ✅ (`52a9d3a`) — posts/images already persisted client_id on main; fixed landing-lead path; leads table has no client_id col (two-hop via landing_page) | 
| W5.1b 025 reporting migration (report_shares; ad_id deferred) | `feat/reporting-migration` → PR #22 | **merged** ✅ (`9f68fa6`); **SQL handed to human — awaiting apply (H1)** |
| W5.2a Meta insights sync | `feat/meta-insights-sync` → PR #23 | **merged** ✅ (`54e2958`) — tsc/build/215 tests |
| W5.3b ROI-outcome framing + period-over-period | `feat/report-roi-framing` → PR #26 | **merged** ✅ (`da937c7`) — tsc/build/233 tests; honest ROAS, no fabrication |
| W5.3a report share-link `/report/<token>` | `feat/report-share-link` → PR #27 | **green, HOLDING merge** — tsc/build/250 tests; merge the instant 025 is applied (dependency-met rule) |

## PHASE 4 — Polish (started — P3 complete)
| Task | Branch | State |
|---|---|---|
| W2.5a Avatar v2 (PORT generator; NO migration — meta_clients.avatar jsonb already exists; v1 fallback) | `feat/avatar-v2-port` → PR #30 | **merged** ✅ (`4845182`) — tsc/build/252 tests; structured avatar + v1 fallback |

**P4 COMPLETE** ✅ — #28 graph-version, #29 recommendations, #30 Avatar v2. (#5 visual refresh + #7 meta-ads-launcher remain FLAGGED — stale, deliberate-rebase only.)

## Post-completion fix — brief-first client creation
- **Gap found (read-only investigation):** prod was current (`4845182`), but `/clients` creation screen was never rewired — still required a pasted Meta token; the brief->analysis->avatar spine was unreachable as the entry point. Root cause = plan gap (no W2/W3 task owned the `/clients` creation UI), not a stale deploy or regression.
- **Fix shipped:** `fix/clients-brief-first-creation` → PR #31 **merged** ✅ (`13aed8c`) — tsc/build/264 tests. `/clients` now: "צור לקוח" needs name only; token demoted to optional collapsed toggle; post-create CTA "📋 צור בריף ללקוח" → `/send-brief?client=<id>` (auto-selects → orchestrator); OAuth + token-paste paths preserved. Prod auto-deploys from main.

## NEW TASK — Strategy Analysis (AutoAds-depth client core)
**Gap:** `analyze_brief` only does a brief-completeness critique; AutoAds produces a 4-section marketing STRATEGY. Git history confirms the rich version NEVER existed (no pickaxe hits, no deleted files). This builds it. No schema change (richer object into existing `meta_clients.business_analysis` jsonb).
**Spec — `StrategyAnalysis` (Hebrew) on `business_analysis`:** (1) Strategic Summary {goal, core_offer, usp, constraints[]}; (2) Recommended sub-audience {name, awareness_level (Schwartz, reuse `lib/avatar/frameworks.ts`), persona, explanation}; (3) Platform+funnel {platform, ad_format, funnel_type, +reason each}; (4) Offer Stack {components[], strengths[], assessment} (seed from `offer_stacks` if a client row exists). Keep 2-credit cost. Avatar v2 stays (complementary). `buildAiContext` emits `═══ MARKETING STRATEGY ═══` (all 4), backward-compat with legacy completeness rows. UI: `/analyze-brief` + client/brief view render the 4 sections. Verify: parser unit test + buildAiContext emit test + orchestrator E2E + no legacy regression.
**Branch:** `feat/strategy-analysis` → PR #32 **merged** ✅ (`2fb18f5`) — tsc/build/268 tests. 4-section StrategyAnalysis on `business_analysis`; offer_stacks seeding; `═══ MARKETING STRATEGY ═══` in buildAiContext w/ legacy fallback; `/analyze-brief` renders 4 sections; 2-credit; no migration. Prod auto-deploys.
**Minor follow-up (non-blocking):** `brief_analyses` history insert maps strategy fields into completeness-named columns (strengths←offer_stack.strengths, gaps←constraints; full strategy in raw_text) — harmless audit-only quirk; tidy later if history columns are ever read.

## CLIENT MODEL V2 + CLIENT INTELLIGENCE — clean rebuild — design `docs/client-model-v2.md` + `docs/client-intelligence.md`
- **FOUNDATION APPLIED 2026-06-30:** `026` clients+client_strategy (F1) · `027` backfill (F2, verified **clients=meta_clients=4**) · `028` brain tables (F3: client_insights, content_artifacts [canonical], learning_signals, insight_events). Foundation code merged **PR #34 (`a60e00d`)**.
- **Ground-truth drift found:** prod `meta_clients` had email/phone/company/notes (preserved); lacked business_analysis/avatar/core_generated_at (`021` never applied) + connect_token (`020` never applied) → `client_strategy` backfill empty by design.
- **NOW (doing):** re-point identity READS meta_clients→clients (`feat/client-reads-repoint`).
- **Next:** **M3** FK swaps (show SQL — needs real constraint names; introspect prod) → re-point WRITES (orchestrator→client_strategy, tools→client_strategy) → clean /clients + brief UI + per-client workflow home → **Phase-A brain code** (`client-intelligence.md` §8: deep 3-layer analysis→insights, lifecycle engine, tagged generation→content_artifacts, user-signal loop). **GATES: M4 drop-legacy + Phase-B (Meta) need explicit OK.**
- **P1 queued (after P0 merges):** angle memory (persist used angles per client across campaigns — real AutoAds feature we lack). Also: per-client 5-step workflow client-home, approval→upload pipeline.
- Finding: AutoAds has **no standalone strategy-analysis artifact** (strategy = brief + framework-tagged ads + angle memory); AdMaster's #32 is richer. AdMaster also ahead on ROI reporting (#26/#27).

# ✅ CODED PLAN COMPLETE (P0→P4)
21 PRs merged this session (#10–#30), every one green (tsc + build + tests) before merge. Remaining work is ENTIRELY external setup — see `docs/GO-LIVE-CHECKLIST.md` (H2 SMTP · H3 Stripe · H4 Meta · Supabase tier) + the env-gated live smoke tests. Migrations applied: 019/020/021 (human) + 025 (human). No destructive ops were run.
| W4.2b graph-version hygiene (no hardcoded v19.0) | `chore/meta-graph-version` → PR #28 | **merged** ✅ (`acf3df3`) — 6 callsites centralized; tsc/build/253 tests; grep clean |
| Tech-debt: recommendations reads selection from active connection | `fix/recommendations-connection` → PR #29 | **merged** ✅ (`26dd450`) — tsc/build/254 tests |
| #5 visual refresh | PR #5 | **FLAGGED — needs deliberate rebase** (stale since 2026-05-28, 964/447; predates all session UI/auth/schema work; auto-merge = regression risk). Will not auto-merge. |
| #7 meta-ads-launcher (011/012 migrations) | PR #7 | **FLAGGED — stale**, separate reconciliation if its launch chain is wanted (targeting/launch/insights). Not on critical path. |

**P3 COMPLETE** ✅ — #22/#23/#24/#25/#26/#27 merged; `025` applied (manual, verified). Client ROI report + `/report/<token>` share-link live.

---

## Live log
- **P0 start** — inspected PRs: #12 CLEAN, #11 UNSTABLE (Supabase Preview fail), #10 DRAFT. Repo viewerPermission=ADMIN.
- Resolved ordering conflict (re-point #10 → P2) and migration collision (P1 migration-free).
- Merging #12; dispatching Wave-1 workers A/B/C + #11 verifier.
- **P0 COMPLETE:** #12 (`4bfaf59`) + #11 (`29c5ae6`) merged. CI note: non-required "Supabase Preview" check is red for any migration-bearing PR (pre-existing duplicate-numbered migrations) — not a gate; local tsc/build/tests is the gate.
- **P1 code:** #14 502-fix, #13 password-reset, #15 Stripe — all merged (`634ff5d`). Remaining P1: W1.4a onboarding (worker E, running). External gates H2 (SMTP) + H3 (Stripe price ids/webhook secret) tracked separately — not phase-blockers.
- **SECURITY (auto-review):** open redirect in `app/auth/callback/route.ts` (from #13) — fixed via PR #16 (`safeNextPath` in `lib/`, +6 tests), **merged** ✅ (`ad8d914`).
- **SECURITY (auto-review #2):** Meta token passed as URL query param in `app/api/meta/insights/route.ts` (#23) — leak risk in logs/URLs; catch echoed raw error. Fixed via PR #25 (`Authorization: Bearer` header + generic catch + URL-has-no-token test), **merged** ✅ (`9dfe768`).
- **P3 Wave 1 merged:** #24 attribution, #23 insights, #22 (025 file). 025 SQL handed to human — **awaiting apply (H1)**. W5.3b ROI framing running. W5.3a share-link blocked on 025 apply.
- **Next:** on E merge → P1 done → start P2. P2 plan: author migrations 019/020/021 as PRs + dependent code (unit-green), then batch the SQL to human (H1) for apply; re-point #10 only after 019/020 applied.
