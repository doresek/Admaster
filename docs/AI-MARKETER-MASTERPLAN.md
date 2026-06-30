# AI Marketer — Master Plan

> **Vision.** AdMaster is not a content tool. It is **the first AI marketer**: a system that *does the marketing in practice* — Meta paid + organic now, WhatsApp next, more platforms later — where the **living client understanding drives EVERY marketing decision** (angle, audience, platform, budget) and **diagnoses why something failed by reasoning from the insights**, not by blind metric-guessing. The accumulating per-client brain (already built) is the moat; the insight-grounded decision + diagnosis is the differentiator.
>
> **Status of base (verified against `origin/main` @ `15ff2e4`, 2026-07-01):** living brain LIVE (PRs #34–#41) — `client_insights` (3-layer atoms + lifecycle + `insight_events`), `client_strategy` snapshot, `content_artifacts` (tagged), `learning_signals` + `/api/intelligence/signal`, `buildAiContext` grounding. Meta **connect** LIVE (`lib/meta-oauth.ts`, connect-link, `meta_connections` token store, `lib/meta-insights.ts` read→`ad_performance`). Creative gen: `lib/master-studio/*`, `lib/autopilot/*`. Reporting: `report_shares`, `/report/<token>`. Baseline green: tsc clean, 376 tests.
>
> **What's missing (this plan):** the *acting* layer (publish organic + run paid), the *decision engine* that turns understanding into campaign structure, the *measure→diagnose→auto-improve* loop on real Meta data, WhatsApp, and an owner command center. 
>
> **Execution doctrine.** Parallel agents on **disjoint folders** (the one orchestration rule). Additive/reversible migrations: author + self-verify + log. Destructive (DROP/DELETE) → SQL shown first. Two human gates only: **(a) destructive migrations, (b) spending real ad money / going live with a budget.** Live SoT: `docs/EXECUTION-STATUS.md`.

---

## 0. Reconciliation done first (Wave 0)
- **Orphan schema recovered:** migrations `019,020,021,026,027,028,029` were applied to prod but never committed (only on `main` up to `025`). The code on `main` depends on their tables (`clients`, `client_strategy`, `client_insights`, `meta_connections`, `content_artifacts`, …). Backed up + committed for the record. Next free integer: **`030`**.
- **Capability reality:** data-plane access to prod via `SUPABASE_SERVICE_ROLE_KEY` (PostgREST) ✓. **No DDL channel** (no direct Postgres connection string, no Supabase CLI link). → I can *author + self-review + data-plane-verify* additive migrations, but applying DDL to prod needs either a direct connection string or the user pasting into the SQL editor. **Surfaced as capability-blocker C1.**

---

## 1. Architecture — six layers

```
        ┌──────────────────────── LIVING BRAIN (built) ────────────────────────┐
        │ client_insights (business/customers/bridge atoms, confidence, lifecycle) │
        │ client_strategy (snapshot)   content_artifacts (tagged)   learning_signals │
        └───────────────▲─────────────────────────────────┬──────────────────────┘
                        │ grounds + diagnoses              │ feeds back (signals)
   ┌────────────────────┴───────────┐         ┌────────────▼─────────────────────┐
   │ L1 DECISION ENGINE (moat)      │ ──spec──▶│ L3 CAMPAIGN EXECUTION             │
   │ insights → angle/audience/     │         │ runner: generate→assemble→publish  │
   │ platform/budget/objective +    │         │ L3a organic (Pages) L3b paid (Ads) │
   │ diagnoseFailure(insight-driven)│◀─perf───│ L3c domain model + state machine   │
   └────────────────────┬───────────┘         └────────────┬─────────────────────┘
                        │                                  │ real metrics
   ┌────────────────────▼───────────┐         ┌────────────▼─────────────────────┐
   │ L4 MEASURE→DIAGNOSE→IMPROVE     │◀────────│ L2 META CONNECTION (H4)            │
   │ content_performance → diagnoses │         │ OAuth env + perms + redirect URIs  │
   │ → auto-improve link → signals   │         └───────────────────────────────────┘
   └────────────────────────────────┘
   ┌────────────────────────────────┐         ┌───────────────────────────────────┐
   │ L5 WHATSAPP (InforU)            │         │ L6 OWNER COMMAND CENTER            │
   │ insight-grounded BOFU/retention │         │ campaigns, spend, perf + the WHY   │
   └────────────────────────────────┘         └───────────────────────────────────┘
```

**How the understanding drives everything (the thread):** every artifact the system creates and every decision it makes carries `grounded_in: insight_ids[]` + a plain-language rationale. A campaign is not "an optimized ad set" — it's *"emotional-safety angle (customers-insight #X 'they buy safety, not treatment' @0.85) → warm-lookalike of past converters → BOFU offer with the price-objection (offer-insight #Y) pre-handled → ₪80/day."* Failure diagnosis reads the same atoms: *"CTR was fine, conversions died, and offer-insight #Y (price objection) is unresolved → the **offer** link failed, regenerate the offer framing — the creative is fine."* That is the line a human marketer can't put their finger on.

---

## 2. Phases → tasks (dependency-ordered, disjoint folders)

Legend — **Dep:** must finish first · **Owns:** disjoint files/folders (no two agents share) · **Eff:** rough effort · **Brain:** how living understanding drives it.

### WAVE 0 — base (serial, orchestrator) — DONE/IN-FLIGHT
| Task | Owns | Eff | Notes |
|---|---|---|---|
| **T0.1** Commit orphan migrations + docs + this plan | `supabase/migrations/019–029`, `docs/**` | S | record-keeping; non-destructive |
| **T0.2** Migration **030** (additive): `campaigns`, `campaign_items`, `campaign_decisions`, `content_performance` (+`ad_id`), `diagnoses`, `whatsapp_messages`; all RLS owner-only, FK→`clients` | `supabase/migrations/030_*` | M | author + self-review; apply via C1 channel; data-plane verify |

### WAVE 1 — Meta-INDEPENDENT cores (parallel, disjoint folders)
> All build against typed interfaces with **dry-run/fixture** modes so they reach tsc+test-green WITHOUT Meta. Live wiring happens in Wave 2 once H4 lands.

| Task | Dep | Owns | Eff | Brain |
|---|---|---|---|---|
| **T1 Decision Engine** (the moat). Pure `decide(client) → MarketingDecision{angle, sub_audience→targeting_spec, platform, placement, objective, funnel_stage, budget, grounded_in[], rationale}` + `diagnoseFailure(artifact, perf, insights) → Diagnosis{failed_link, rationale, target_insight_ids}`. | brain (live) | `lib/decision-engine/**` + tests | L | **IS the brain applied to action** — reads active high-confidence atoms per layer; never metric-blind |
| **T2 Campaign domain + runner** (dry-run). State machine `draft→planned→generating→assembled→scheduled→publishing→live→paused→completed`; `runCampaign(clientId)`: decision→generate (via master-studio, grounded)→assemble objects→record. | T0.2, T1 (interface) | `lib/campaigns/**`, `app/api/campaigns/**` (new) | L | runner consumes `MarketingDecision`; every `campaign_item` stamped with `grounded_in` |
| **T3 Meta Ads object model + client** (sandbox/dry-run). Campaign/AdSet/Ad/Creative/Audience builders; `MetaAdsClient` with dry-run + live modes; targeting-spec ← decision engine (sub-audience→interests/geo/demo/lookalike). | T1 (interface) | `lib/meta-ads/**` + tests | L | audience + budget + objective derive from insights, not presets |
| **T4 Organic publishing** (dry-run). Pages API post/photo + IG content-publish; typed client w/ mock mode. | — | `lib/meta-publish/**` + tests | M | post copy/creative grounded via `buildAiContext` + decision angle |
| **T5 Diagnosis + auto-improve engines** (fixtures). `ingestPerformance(fixtures)→content_performance` verdicts; `diagnose()→diagnoses` (uses T1.diagnoseFailure); `autoImprove(diagnosis)`: regenerate only failed link, queue A/B `campaign_item`, emit `learning_signal` back to brain. | T0.2, T1 (interface) | `lib/diagnosis/**`, `lib/performance/**` + tests | L | closes the loop: diagnosis→regenerate→signal→atoms update |
| **T6 WhatsApp (InforU)** adapter + send API + templates. Mock InforU client; live gated on creds C2. | T0.2 | `lib/whatsapp/**`, `app/api/whatsapp/**` | M | decision engine picks WA for BOFU/retention; messages grounded in objection/desire atoms |
| **T7 Owner Command Center** (read + controls). Campaigns list, spend, performance, **the decision rationale + grounded insights per item**, diagnoses, pause/approve. | T0.2 | `app/(dashboard)/command-center/**`, `app/api/command-center/**` | L | surfaces the WHY (grounded_in) behind every decision — "see and control all of it" |

### WAVE 2 — live integration (serial, orchestrator; needs H4 + gates)
| Task | Dep | Owns | Eff | Gate |
|---|---|---|---|---|
| **T8 Meta H4 wiring** — OAuth env + redirect URIs (incl. `/api/meta/connect/callback`), permission scopes, connection health endpoint. | T3,T4 + **H4 creds** | env, `lib/meta-config.ts`, `app/api/meta/health/**` | M | **H4 (user)** |
| **T9 Go-live publish path** — runner → live organic + live paid (created **PAUSED**); spend caps. | T2,T3,T4,T8 | integration in `lib/campaigns/runner` | M | **money gate (user)** for unpausing paid |
| **T10 Live performance ingestion** — `lib/meta-insights.ts` extend → per-ad `content_performance` keyed to artifacts via `ad_id`. | T5,T8 | `lib/performance/ingest-live.ts` | M | needs live ads |
| **T11 Closed-loop E2E** — Playwright + script: create client→brief→brain→decision→campaign(dry/sandbox)→(mock)perf→diagnosis→auto-improve→signal→atom update. Self-verified before report. | all | `tests/e2e/ai-marketer/**`, `scripts/e2e-ai-marketer.mjs` | M | — |

---

## 3. Disjoint-folder map (the collision-avoidance contract)
```
lib/decision-engine/**   → T1   (only T1)
lib/campaigns/**         → T2
app/api/campaigns/**     → T2
lib/meta-ads/**          → T3
lib/meta-publish/**      → T4
lib/diagnosis/**         → T5
lib/performance/**       → T5  (T10 adds ingest-live.ts later, serial)
lib/whatsapp/**          → T6
app/api/whatsapp/**      → T6
app/(dashboard)/command-center/** → T7
app/api/command-center/** → T7
supabase/migrations/030* → orchestrator only (Wave 0)
lib/meta-config.ts, lib/ai-context.ts, lib/meta-insights.ts → orchestrator only (Wave 2, serial)
```
Every Wave-1 agent creates a **new** folder → zero overlap. Shared/existing files are edited only by the orchestrator, serially, in Wave 2. Agents needing a not-yet-shared type define it locally and flag it for integration rather than editing a shared file.

---

## 4. Human gates & capability blockers (surfaced, not pausing)
| ID | What | Needed for | Owner |
|---|---|---|---|
| **H4** | Meta App ID + Secret (live), redirect URIs registered, permission scopes, App Review | T8/T9 live OAuth + publish | user — see EXECUTION-STATUS "Meta H4 ask" |
| **MONEY** | Confirm before unpausing any paid campaign with real budget | T9 paid live | user |
| **C1** | DDL channel: direct Postgres connection string OR paste 030 into SQL editor | apply migration 030 (additive) | user (or provide conn string) |
| **C2** | InforU (Geula Mode) API creds + endpoint reference | T6 WhatsApp live | user |
| **DESTRUCTIVE** | M4 drop legacy `meta_clients` columns/table — SQL shown first | cleanup (deferred) | user |

Everything not behind a gate proceeds in parallel now.

---

## 5. Execution waves (timeline)
1. **Wave 0** (now, serial): commit records + author migration 030. 
2. **Wave 1** (now, parallel, 7 agents, disjoint folders, dry-run/fixtures): T1–T7 → each self-verifies (tsc + own tests) → integrate serially → branch green.
3. **Wave 2** (on H4): T8–T11 live wiring + closed-loop E2E, money gate respected.

This document is the long-term vision SoT; `docs/EXECUTION-STATUS.md` tracks live task state.
