# CLIENT-UX-PLAN — the client-centric command center

**Status:** DESIGN ONLY. No product code in this pass. This document is the blueprint we build from in parallel waves after review.
**Repo:** `/Users/eliranisrael/admaster-db` · branch at authoring: `feat/nano-banana-image`
**Thesis:** the engine (decision-engine, living insights, diagnosis, autonomy gate) is strong. What is missing is a place where the owner opens **one client** and sees **everything about that client** — its knowledge, its campaigns grouped by where they are in the trust ladder, the *why* behind each one, and what worked / failed / and why. Today that place does not exist: the client page shows only the "brain," campaigns live in an unlinked orphan route, and the owner's actual campaign path never records a decision trace.

---

## 0. Ground truth — what exists today (read before designing)

### 0.1 The client page shows no campaigns
`app/(dashboard)/clients/[id]/page.tsx` is a server component that renders **only client intelligence**: identity header → brief/Meta-connect cards → `KnowledgeWall` (`components/intelligence/KnowledgeWall.tsx`) → `StrategySnapshot` (`components/intelligence/StrategySnapshot.tsx`), with a `BuildingBrain` fallback while atoms are synthesizing. It fetches `getClient`, `getClientStrategy`, `listActiveInsights`. **It renders zero campaigns, zero performance, zero diagnosis, and does not link to the command center.**

### 0.2 Campaigns live in an orphan route with a mismatched status model
- `app/(dashboard)/command-center/page.tsx` + `command-center/components.tsx` render `CampaignCard` / `WhyPanel` / `DiagnosesSection` — but the route is **not in the sidebar** (`components/layout/Sidebar.tsx`) and is **not client-scoped** (it lists all of an owner's campaigns).
- **Status-vocabulary conflict (must resolve):** the command-center UI + its PATCH route (`app/api/command-center/campaigns/[id]/route.ts`, `ACTION_STATUS = { pause:'paused', resume:'active', approve:'approved' }`) use `active` / `approved` / `proposed` / `pending`. The **real DB CHECK** on `campaigns.status` (migration `030_ai_marketer.sql`) allows **only** `draft, planned, generating, assembled, scheduled, publishing, live, paused, completed, failed`. So `resume`/`approve` would violate the constraint against the migrated schema. `lib/campaigns/state.ts` is the honest source of truth (10 states, lifecycle transitions).

### 0.3 There are three campaign-creation paths and they disagree on what they persist
| Path | Route | Writes `campaigns`? | Writes `campaign_decisions`? | Writes artifact | Owner-facing? |
|---|---|---|---|---|---|
| **Quick campaign** | `app/api/quick-campaign/route.ts` (sidebar "קמפיין מהיר", 15⚡) | **No** | **No** | `content_artifacts` + `generated_content` + `generated_images` | **Yes — this is the live path owners actually use** |
| **Runner (dry-run)** | `app/api/campaigns/route.ts` → `runCampaign()` → `lib/campaigns/runner.ts` | Yes | **Yes — rich** | via `lib/campaigns/generate.ts` | Only via orphan command-center |
| **Autopilot** | `app/api/autopilot/*` → cockpit | via runner | via runner | via generate | Cockpit only |

**The decision trace already exists — on the wrong path.** `lib/campaigns/runner.ts::buildDecisionLog()` writes **seven** grounded `campaign_decisions` rows per campaign — `channel, angle, audience (sub_audience + targeting_spec), platform, objective, funnel, budget` — each with `grounded_in[]` (atom ids) and a plain-language `rationale`. `GET /api/campaigns/[id]` already returns `{ campaign, items, decisions }`. But the **owner's live path (`/quick-campaign`) writes none of it**, and **no client-scoped screen reads it**. That is the real "the why isn't real per-campaign" gap: it is captured only on the dry-run path and surfaced only in an unlinked screen.

### 0.4 The image "creative" is usually a prompt, not a picture
`lib/campaigns/generate.ts` stores `content_artifacts.content.image = the IMAGE_PROMPT` and only sets `content.image_url` **when an image provider is configured** (`generateAndStoreCreativeImage` returns `null` otherwise). In dry-run / no-provider, the "creative" is text. Any creative preview must degrade gracefully: real image → prompt-as-caption → placeholder.

### 0.5 Autonomy is a per-client mode, enforced by one gate
- `client_autonomy.mode` (migration `044_autonomy_modes.sql`): **`draft_only` · `propose_approve` (default) · `act_within_caps`**.
- `lib/autonomy/policy.ts` is the single gate; it returns `route ∈ block | propose | execute`:
  - `draft_only` → everything is **proposed** (system publishes nothing).
  - `propose_approve` → no-money actions **execute**; every money move is **proposed** (one-tap approval).
  - `act_within_caps` → money moves **execute within caps** (daily/monthly/delta), else **propose**.
- Mode is **per client**, not per campaign — it sets the *default lane a new campaign lands in* and who has to click.

### 0.6 Diagnosis is real and grounded, but under-visualized
- `diagnoses` table (migration 030): `failed_link ∈ hook | avatar | creative | funnel | offer | audience | none`, `rationale`, `evidence jsonb`, `target_insight_ids uuid[]`, `recommended_action jsonb`, `applied`, `applied_item_id`.
- Reasoning lives in `lib/decision-engine/diagnose.ts::diagnoseFailure()` — metric patterns **interpreted through living atoms** (e.g. dead conversions + an active `customers/objection` atom ⇒ `offer`, not `creative`). Thresholds in `DIAGNOSIS_THRESHOLDS`.
- Round-trip: atom → decision `grounded_in` → shipped artifact → `content_performance` (`verdict ∈ worked | underperformed | failed`) → `diagnoseFailure` names the culpable atom (`target_insight_ids`) → `lib/diagnosis/auto-improve.ts` regenerates only the failed link + queues an A/B challenger (`campaign_items.ab_parent_id`) + emits a `learning_signal`.
- Current UI: `DiagnosesSection` renders `failed_link` as a **raw English token** (no Hebrew label map), no funnel visualization, no metrics chart. `analyze-weak/page.tsx` is a *separate* LLM "performance doctor" unrelated to this table — flag the naming overlap.

### 0.7 Design-system vocabulary (build within it)
Dark, Hebrew-first RTL. Single primitives barrel `components/ui/index.tsx`: `Btn` (variants `primary|violet|green|amber|gold|ghost|outline|red`), `Card`, `CardLabel`, `Chip`, `Alert` (`blue|green|amber|red`), `PageHeader`, `StatCard`, `Tabs`, `CostBadge`. **No** Badge / Modal / Drawer / Table / chart primitive exists yet. Tailwind tokens (`tailwind.config.ts`): bg `#070A0E`, surfaces `s1 #111A24`→`s3 #1D2D3E`, borders `b1/b2`, brand `blue #0A7AFF`, `violet #6D28D9`, `green #059669`, `amber #D97706`, `red #DC2626`, `gold #B8953A`; text `t1 #D9E8F5 / t2 #6B8FA8 / t3`. Fonts: `Noto Sans Hebrew` body, `DM Serif Display` logotype, `DM Mono` for numbers.

---

## 1. Client-centric Information Architecture

**`/clients/[id]` becomes the client command center.** One page, one client, everything about it. The existing "brain" stays — we add the campaign world beneath it.

### 1.1 Page skeleton (top → bottom)

```
┌─ Client header ─────────────────────────────────────────────┐
│  ← back   לקוח                                   [ Autonomy ] │
│  {Client name}                                   [ mode pill ]│
│  company · email · phone · {n} תובנות · ביטחון {x}%          │
├─ Client stat rail (4 tiles) ────────────────────────────────┤
│  קמפיינים  |  פעילים  |  תקציב יומי פעיל ₪  |  ממתין לאישור  │
├─ 🧠 הידע החי  (KnowledgeWall — UNCHANGED) ──────────────────┤
│  🎯 תמונת אסטרטגיה  (StrategySnapshot — UNCHANGED)          │
├─ 🚀 הקמפיינים  (NEW — status lanes) ────────────────────────┤
│  [ Draft ]  [ Pending my approval ]  [ Active ]  [ Completed ]│
│   card       card                      card        card       │
│   card                                 card                    │
├─ 🩺 אבחון וביצועים  (NEW — DiagnosisBoard) ─────────────────┤
│  failed-link funnel + what worked / failed / why             │
└─────────────────────────────────────────────────────────────┘
```

The brain is the *thesis at the top* (who this client is), the lanes are *the work in flight*, diagnosis is *what we learned*. Reading top-to-bottom answers: **who → what → how's it going**.

### 1.2 The four lanes, mapped to real data

Lanes are the owner's mental model, not raw enum values. A single resolver (`lib/campaigns/status.ts`, Wave 0) maps every real `campaigns.status` into one of four buckets and supplies the Hebrew label — **this resolver is where the §0.2 vocab conflict dies.** We map from the DB-true 10 states (`lib/campaigns/state.ts`), never from the command-center's invented ones.

| Lane (owner-facing) | `campaigns.status` (DB CHECK) | Autonomy tie-in | What the owner does here |
|---|---|---|---|
| **Draft** (טיוטה) | `draft`, `planned`, `generating`, `assembled` | `draft_only` clients land everything here; the system prepares, owner ships | Review, edit, promote to launch |
| **Pending my approval** (ממתין לאישור) | `assembled`/`scheduled` **that the gate routed to `propose`** (+ open `approvals` rows, + `content_artifacts.status='draft'`) | `propose_approve` money moves; any `draft_only` action | **One-tap approve / request changes / reject** |
| **Active** (פעיל) | `scheduled`, `publishing`, `live`, `paused` | `act_within_caps` executes into this lane within caps | Pause / resume, watch performance |
| **Completed** (הסתיים) | `completed`, `failed` | — | Read the diagnosis, clone the winner |

Notes:
- **"Pending my approval" is a union, not a status** — it is (campaigns whose next action the gate returned `route:'propose'` for) ∪ (open `approvals` requests) ∪ (unapproved `content_artifacts`). The resolver computes it; the lane is where autonomy becomes visible and actionable.
- The **autonomy mode pill** in the header (`AutonomyModeControl`, Wave 2) shows the current mode and lets the owner change it (writes via `app/api/autonomy` → `lib/autonomy/store.setMode`). Changing mode re-labels the lanes' *default* behavior in place (e.g. switching to `act_within_caps` tells the owner future money moves will land straight in **Active**).
- Empty lanes render an inviting empty state, never a blank column (`components/client/states.tsx`).

### 1.3 Data flow

```
/clients/[id]/page.tsx (server)
   └─ GET /api/clients/[id]/campaigns   (NEW, Wave 1)
        └─ lib/campaigns/client-view.ts  (NEW, Wave 1)
             ├─ campaigns            WHERE client_id  (+ status→lane bucket)
             ├─ campaign_items       WHERE client_id  (join creatives)
             ├─ campaign_decisions   WHERE client_id  (the WHY, grouped by campaign)
             ├─ content_performance  WHERE client_id  (latest verdict per item)
             └─ approvals / content_artifacts.status  (pending union)
```

One request returns a `ClientCampaignView` grouped by lane, each campaign already carrying its decisions, creative, and latest verdict — so the lanes render without N+1 fetches.

---

## 2. Per-campaign card & detail — make the "why" real

### 2.1 The card (`CampaignCard`, Wave 3) — glanceable

```
┌───────────────────────────────────────────────┐
│ [creative thumb] {name}            [status pill]│
│                   angle: "{angle}"   🧪 dry-run │
│                   👥 {sub_audience}   ₪{budget} │
│ ─────────────────────────────────────────────  │
│ verdict: ✅ worked / ⚠︎ underperformed / ✕ failed│
│ ⓘ למה?  (expand → DecisionTrace)                │
└───────────────────────────────────────────────┘
```

Fields, all from real columns:
- **creative thumb** — `content_artifacts.content.image_url` → else the `image` prompt as caption → else placeholder (§0.4).
- **angle** — `content_artifacts.angle` / `campaign_decisions[type=angle].decision.angle`.
- **audience** — `campaign_decisions[type=audience].decision.sub_audience` + `targeting_spec`.
- **status pill** — bucketed via `lib/campaigns/status.ts`; `dry_run` badge from `campaigns.dry_run`.
- **budget** — `campaigns.daily_budget`.
- **verdict** — latest `content_performance.verdict` for the campaign's items.

### 2.2 The detail (`CampaignDetail` + route `/clients/[id]/campaigns/[campaignId]`, Wave 3)
Reuses the existing `GET /api/campaigns/[id]` (`{ campaign, items, decisions }`). Four panels:
1. **Creative** (`CreativePreview`) — image + `content.post` + `hashtags` + `whatsapp`; brand-lint stamp from `generated_from.lint`.
2. **Angle & audience** — the `angle`, `sub_audience`, `platform`, `placement`, `funnel_stage`, `objective` decisions.
3. **Decision trace** (`DecisionTrace`) — the seven `campaign_decisions` rows as a vertical timeline: each `decision_type` → chosen value → `rationale` → the resolved `grounded_in` atoms (content + confidence, via `attachGrounded` in `app/api/command-center/shared.ts`). This is the "why the system chose this," grounded in atoms.
4. **Performance** — `content_performance.metrics` (impressions/ctr/conversions/cpa/roas/spend/frequency) + verdict, feeding into the diagnosis board.

### 2.3 THE GAP TO CLOSE (call it out loudly)

**Problem:** the owner's live path (`/quick-campaign`) writes an artifact but **no `campaigns` / `campaign_decisions` / `campaign_items` rows**, so for the campaigns owners actually run there is **no per-campaign angle/audience/rationale/grounded_in to show** — the structured "why" only exists on the dry-run runner path and in `client_strategy.business_analysis` + the atoms, not per campaign. Even where it exists, the `campaigns` row itself carries only a single `rationale` string + `grounded_in[]`; the structured breakdown lives in the `campaign_decisions` rows.

**Fix (Wave 1, additive, no behavior change to the engine):**
1. **Capture on the live path.** Add `lib/campaigns/decision-capture.ts` — a thin, dry-run-safe writer that, when `/quick-campaign` produces an artifact, also inserts a lightweight `campaigns` row (`status='draft'`, `dry_run=true`) + its `campaign_decisions` rows for `angle`, `audience`, `funnel`, `budget`, each with `grounded_in` (the artifact's `insight_ids`) and a `rationale`. Reuse the exact shape of `runner.ts::buildDecisionLog()` so both paths write identical traces. `/quick-campaign/route.ts` gains one best-effort call (Wave 1 edit).
2. **Denormalized summary for cheap lane cards.** Migration `051` (additive/reversible) adds `campaigns.decision_summary jsonb` = `{ angle, sub_audience, primary_rationale, verdict }`, populated by `decision-capture.ts` and the runner. Lane cards read this one column instead of joining `campaign_decisions` for every card; the detail view still reads the full rows. Fully additive — no column dropped/altered, matches the 030 "additive only" doctrine.
3. **Creative honesty.** `CreativePreview` degrades image_url → prompt → placeholder, and always shows the prompt in the detail so a dry-run creative is never a blank box.

---

## 3. Richer analysis / diagnosis view

Keep what the owner likes (the failed-link idea) and make it *legible and visual*. Client-scoped, mounted on the client page as `🩺 אבחון וביצועים`.

### 3.1 Failed-link funnel (`FailedLinkFunnel`, Wave 4)
Render the marketing chain as a left-to-right (RTL: right-to-left) funnel and **highlight the broken link**, grounded in `diagnoses.failed_link`:

```
audience → avatar → hook → creative → offer → funnel
   ✓        ✓       ✕‼      ✓          ✓        ✓
                    └─ "CTR 0.6% על 12k חשיפות — הזווית לא עוצרת"
```

- The seven links map to Hebrew via `lib/diagnosis/labels.ts` (Wave 0) — **today `failed_link` renders as a raw English token; this is the first fix.** Suggested map: `hook`→וו, `avatar`→פרסונה, `creative`→קריאייטיב, `funnel`→משפך, `offer`→הצעה, `audience`→קהל, `none`→תקין.
- The broken link is the one thing that's loud (brand `red`/`amber`); healthy links stay quiet (`t2`/`green`). One accent, per the design doctrine.

### 3.2 What worked / failed / why (`DiagnosisCard`, Wave 4)
Per diagnosis: verdict chip (from `content_performance.verdict`) → the broken link → the `rationale` → the culpable **atoms** (`target_insight_ids` resolved to content + confidence) → `recommended_action` → applied state (`applied` + link to the A/B challenger `applied_item_id`). This makes the atom-grounded reasoning visible: *"conversions died and the atom `customers/objection: 'too expensive'` is still active → it's the OFFER, not the creative."*

### 3.3 Performance panel (`PerformancePanel`, Wave 4)
The only "chart" today is a fill bar; add a small metrics panel over `content_performance.metrics` — impressions, CTR, conversions, CPA, ROAS, frequency, spend — with the verdict threshold context from `PERFORMANCE_THRESHOLDS` (e.g. mark CTR against `HEALTHY_CTR 1%`, frequency against `FREQUENCY_CEILING 3.5`). Uses a new lightweight `MetricBar` primitive (Wave 0), not a chart library.

### 3.4 Data
`GET /api/clients/[id]/diagnoses` (NEW, Wave 1) — mirrors `app/api/command-center/diagnoses/route.ts` but client-scoped, resolving `target_insight_ids` → content+confidence, joining the latest `content_performance` for evidence. Read-only, missing-relation-safe (030 may be unapplied → empty state).

---

## 4. Operational + visual polish

- **Navigation.** Add a client-scoped entry; **retire the orphan `/command-center`** by redirecting it into the per-client view (or a "select a client" chooser). The living command center is *inside* a client, not a global list. (Wave 5 owns `Sidebar.tsx` + the redirect.)
- **Hierarchy.** Brain (identity) → Lanes (work) → Diagnosis (learning). The lanes are the visual center of gravity; the header stat rail (`ClientHeaderStats`, Wave 5) gives the one-glance summary (campaigns / active / active daily budget / pending approval).
- **States.** Every lane and board has three states — loading (skeleton cards), empty (an *invitation*: "אין קמפיינים עדיין — צור קמפיין ראשון" with a CTA), and populated. 030-absent and no-Meta-connection both degrade to friendly empties, never errors (`components/client/states.tsx`, Wave 2).
- **Status pills & one accent.** Status is quiet color-coding; the *broken link* and the *pending-approval count* are the only loud elements — they are where the owner must act.
- **Living-knowledge wall integration.** `KnowledgeWall` stays exactly where it is (top of the client page). The new pieces *reference the same atoms* it displays: a decision-trace atom chip and a diagnosis target-atom chip both link back up to their card in the wall (shared atom id → anchor). The wall is the vocabulary; campaigns and diagnoses are sentences built from it.
- **RTL / a11y floor.** Hebrew-first, logical properties, visible keyboard focus, `prefers-reduced-motion` respected, lane columns scroll internally on mobile (no body horizontal scroll).

---

## 5. File / component map + PARALLEL WAVE PLAN

Ownership is **disjoint** — each file is edited by exactly one wave. Cross-wave *imports* are fine (contracts are shared types); cross-wave *edits* are not. New files unless marked **[EDIT]**.

### Dependency graph
```
Wave 0 (foundation)  ──►  Wave 1 (data/read-model + live capture)  ──►  ┌ Wave 2 (client shell + lanes)
                                                                        ├ Wave 3 (campaign card + detail + why)
                                                                        └ Wave 4 (diagnosis + performance)
                                                                                       │
                                                                        Wave 5 (nav + polish + retire orphan)
```
Waves 2, 3, 4 run **in parallel** once 0+1 land. Wave 5 closes out.

### Wave 0 — Foundation (sequential, unblocks all) · ~0.5 day
**Delivers:** the shared status resolver, Hebrew label maps, additive persistence column, and the missing UI primitives.
**Owns:**
- `supabase/migrations/051_campaign_decision_capture.sql` (+ `.down`) — additive `campaigns.decision_summary jsonb` (nullable, default `'{}'`); reversible.
- `lib/campaigns/status.ts` — `statusToLane(status) → 'draft'|'pending'|'active'|'completed'` + Hebrew labels; the single reconciliation of the §0.2 vocab conflict.
- `lib/diagnosis/labels.ts` — `failed_link` → Hebrew map (§3.1).
- `components/ui/index.tsx` **[EDIT]** — add `StatusBadge`, `Drawer`, `MetricBar`, `Skeleton` primitives.
**Deps:** none. **Blocks:** everything.

### Wave 1 — Data & read-model + live-path capture · ~1 day
**Delivers:** one client-scoped read model, the live-path decision capture that makes the "why" real, and the two client APIs.
**Owns:**
- `lib/campaigns/decision-capture.ts` — dry-run-safe writer mirroring `runner.ts::buildDecisionLog()` (§2.3).
- `lib/campaigns/client-view.ts` — `ClientCampaignView` grouped by lane (§1.3).
- `app/api/clients/[id]/campaigns/route.ts` — GET grouped campaigns + creatives + decisions + verdict.
- `app/api/clients/[id]/diagnoses/route.ts` — GET client-scoped diagnoses (§3.4).
- `app/api/quick-campaign/route.ts` **[EDIT]** — one best-effort `decision-capture` call.
**Deps:** Wave 0 (`status.ts`, migration). **Blocks:** 2, 3, 4.
**Note:** `GET /api/campaigns/[id]` already returns `{campaign,items,decisions}` — reused as-is, not owned here.

### Wave 2 — Client command-center shell + lanes + autonomy · ~1.5 days
**Delivers:** the client page becomes the command center; the four lanes; the autonomy mode control; empty/loading states.
**Owns:**
- `app/(dashboard)/clients/[id]/page.tsx` **[EDIT]** — mount stat rail + `<CommandLanes/>` + reserved `<DiagnosisBoard/>` slot below the existing brain (KnowledgeWall/StrategySnapshot untouched).
- `components/client/CommandLanes.tsx`, `components/client/CampaignLane.tsx`
- `components/client/AutonomyModeControl.tsx` (writes via `app/api/autonomy`)
- `components/client/states.tsx` (lane skeleton + empty states)
**Deps:** Wave 0 + Wave 1 API. **Imports** Wave 3's `CampaignCard` (contract = `ClientCampaignView` types from Wave 1).

### Wave 3 — Per-campaign card + detail + WHY · ~1.5 days
**Delivers:** the glanceable card, the detail route, the grounded decision trace, the honest creative preview.
**Owns:**
- `components/client/CampaignCard.tsx`, `components/client/CampaignDetail.tsx`
- `components/client/CreativePreview.tsx`, `components/client/DecisionTrace.tsx`
- `app/(dashboard)/clients/[id]/campaigns/[campaignId]/page.tsx` (reuses `GET /api/campaigns/[id]`)
**Deps:** Wave 0 + Wave 1. **Consumed by** Wave 2 lanes.

### Wave 4 — Diagnosis + performance view · ~1.5 days
**Delivers:** the failed-link funnel, the worked/failed/why cards, the metrics panel, mounted as the client-scoped board.
**Owns:**
- `components/diagnosis/FailedLinkFunnel.tsx`, `components/diagnosis/DiagnosisCard.tsx`
- `components/diagnosis/PerformancePanel.tsx`, `components/diagnosis/DiagnosisBoard.tsx`
**Deps:** Wave 0 (`labels.ts`, `MetricBar`) + Wave 1 (diagnoses API). **Mounted** into the slot Wave 2 reserves in `page.tsx` (Wave 4 delivers the component; Wave 2 owns the page edit → no double-edit).

### Wave 5 — Nav + polish + retire orphan · ~0.5 day
**Delivers:** navigation into the client command center, retirement of the orphan route, header stat tiles, final visual pass.
**Owns:**
- `components/layout/Sidebar.tsx` **[EDIT]** — client-scoped entry; remove dead links.
- `app/(dashboard)/command-center/*` **[EDIT/redirect]** — fold into per-client view (§4).
- `components/client/ClientHeaderStats.tsx` — the 4 stat tiles.
**Deps:** Waves 1–4 complete.

### Ownership matrix (no file appears twice)
| File / folder | Wave |
|---|---|
| `supabase/migrations/051_*` | 0 |
| `lib/campaigns/status.ts`, `lib/diagnosis/labels.ts` | 0 |
| `components/ui/index.tsx` **[EDIT]** | 0 |
| `lib/campaigns/decision-capture.ts`, `lib/campaigns/client-view.ts` | 1 |
| `app/api/clients/[id]/campaigns/*`, `app/api/clients/[id]/diagnoses/*` | 1 |
| `app/api/quick-campaign/route.ts` **[EDIT]** | 1 |
| `app/(dashboard)/clients/[id]/page.tsx` **[EDIT]** | 2 |
| `components/client/CommandLanes|CampaignLane|AutonomyModeControl|states` | 2 |
| `components/client/CampaignCard|CampaignDetail|CreativePreview|DecisionTrace` | 3 |
| `app/(dashboard)/clients/[id]/campaigns/[campaignId]/page.tsx` | 3 |
| `components/diagnosis/*` | 4 |
| `components/layout/Sidebar.tsx` **[EDIT]**, `app/(dashboard)/command-center/*` **[EDIT]**, `components/client/ClientHeaderStats.tsx` | 5 |

### Additive schema/persistence summary
- **Migration 051 (additive, reversible):** `campaigns.decision_summary jsonb` — denormalized `{angle, sub_audience, primary_rationale, verdict}` for cheap lane cards. No existing column altered/dropped; consistent with the 030 additive doctrine. Down migration drops the column only.
- **No new tables required** — `campaign_decisions` (rich), `content_performance`, `diagnoses` all already exist in migration 030. The work is to **write them on the live path** and **read them client-centrically**, not to redesign the schema.

---

## Note

This is a design document only — no product code was written or changed in this pass. We build it in the parallel waves above **after review**: Wave 0 → Wave 1 → Waves 2/3/4 in parallel → Wave 5, mirroring the audit-fix wave cadence. Before starting, confirm two decisions flagged here: (a) migration 030 application state in prod (every read path degrades to empty until then), and (b) whether to fold `/command-center` into the client view or keep it as a global fallback.
