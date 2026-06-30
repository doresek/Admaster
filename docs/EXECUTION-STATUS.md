# AdMaster Pro — Execution Status (LIVE)

> Single source of truth for the MASTER-PLAN execution. Orchestrator-maintained.
> States: `todo` → `doing` → `pr-open` → `green` → `merged` · or `BLOCKED-ON-HUMAN`.
> Plan: `docs/MASTER-PLAN.md`. Date started: 2026-06-29.

---

# ===== AI MARKETER EPIC (active focus, 2026-07-01) — plan: `docs/AI-MARKETER-MASTERPLAN.md` =====

**Branch:** `feat/ai-marketer-epic` (off `origin/main` @ `15ff2e4`). Baseline verified green: tsc clean, 376 tests, Node 20, Playwright present.

**Ground-truth (prod, data-plane verified 2026-07-01):** brain live + in use — `clients=7`, `client_insights=27`, `client_strategy`/`content_artifacts` present. `campaigns/content_performance/diagnoses/whatsapp_messages` absent (404) → 030 needed, no collision. ⚠️ **`meta_connections` returns 404 in prod** — table the OAuth callback writes to may NOT actually be applied despite docs claiming mig 019 landed; reconcile during H4/Wave-2.

**Capability blockers (user handling all three, 2026-07-01):** **C1** Postgres connection string incoming → full migration autonomy; until then 030 + 019-recheck wait for the channel. **H4** Meta App already EXISTS (skip creation); user auditing approved scopes (ads_management/instagram_content_publish/pages_manage_posts) + redirect URIs; App ID/secret incoming. **C2** InforU (Geula Mode) creds incoming; build against mock. **MONEY** gate before unpausing paid (stands).

**Reconcile during H4:** `meta_connections` returns 404 in prod — mig 019 (committed in Wave 0) may not be applied; if so, apply via C1 (additive) so the OAuth connect flow works.

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
| T2 Campaign domain + runner (dry-run) | **dispatched** (running) | `lib/campaigns/**`, `app/api/campaigns/**` | imports real T1 contract |
| T5 Diagnosis + auto-improve engines (fixtures) | **dispatched** (running) | `lib/diagnosis/**`, `lib/performance/**` | imports real T1 contract |
| Dry-run E2E loop (orchestrator) | **next** | `scripts/`, `tests/e2e/` | client→brief→brain→decision→campaign→perf→diagnosis→auto-improve→signal |
| T8–T11 live wiring + closed-loop E2E | **gated on H4/C1/C2** | orchestrator, serial | money gate for paid |

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
