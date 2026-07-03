# Client Intelligence — living knowledge + closed-loop learning (architecture)

> **The core IP.** A per-client knowledge base that **accumulates** (never silently forgets), **grounds every generation**, and **learns** from what worked/failed — diagnosing *which link* in the chain failed and auto-improving that link.
> **Sits on top of `client-model-v2`** (`clients` identity · `client_strategy` synthesized snapshot · `meta_connections` Meta asset). Build this only after v2's tables land.
> **Design.** **Phase-A brain tables APPLIED 2026-06-30** as migration `028_client_intelligence_phase_a` (F3): `client_insights`, `content_artifacts` (canonical tagged store), `learning_signals`, `insight_events` — all FK'd to `clients`, RLS owner-only, empty (filled as Phase-A code ships). Phase-B tables (`content_performance`, `diagnoses`) remain deferred until Meta (H4). Phase-A brain CODE is built next per §8.

---

## 0. The closed loop (what we're building)
```
   deep client KNOWLEDGE  ──grounds──►  CREATION (tagged artifacts)
          ▲                                      │
          │                                      ▼
   knowledge UPDATES                       MEASURE (user signals + Meta performance)
   (accumulate / supersede)                      │
          ▲                                      ▼
   AUTO-IMPROVE the link  ◄──diagnose──  WHICH LINK failed? (hook/avatar/creative/funnel/offer)
```
The accumulating **knowledge** is the moat; the **diagnosis** ("a human marketer can't put their finger on which link failed") is the differentiator.

---

## 1. LIVING CLIENT KNOWLEDGE — `client_insights` (the atomic, accumulating layer)

`client_strategy` (v2) holds the **synthesized snapshot** (the current StrategyAnalysis #32 + Avatar #30). Beneath it sits the **living atoms**: every discrete insight, with provenance and lifecycle. The snapshot is a *projection* of the active insights.

### 1.1 Three depth layers (the `layer` + `kind` taxonomy)
| layer | what it captures | `kind` values |
|---|---|---|
| **business** | the *real* answer, deeper than stated | `real_solution`, `usp`, `pain_solved`, `true_value`, `proof` |
| **customers** | who they really are & want (incl. unspoken) | `pain`, `desire`, `aspiration`, `dream`, `unspoken_want`, `objection`, `awareness_level`, `sub_audience` |
| **bridge** | translate business value → customer want | `translation`, `angle`, `hook`, `message`, `funnel_fit` |

### 1.2 `client_insights` (data model)
```
client_insights
  id                uuid pk
  client_id         uuid → clients(id) cascade
  owner_user_id     uuid → users(id) cascade          -- direct RLS
  layer             text  (business | customers | bridge)
  kind              text  (see §1.1)
  content           text                              -- the insight, stated plainly
  structured        jsonb                             -- optional payload (e.g. {pain, intensity, segment})
  -- provenance
  source            text  (brief | user_signal | content_performance | ai_synthesis)
  source_ref        jsonb                             -- {brief_id|artifact_id|signal_id|performance_id}
  -- lifecycle / accumulation
  confidence        numeric(3,2)  (0..1)              -- current belief strength
  evidence_count    int default 0                     -- corroborations seen
  status            text  (active | superseded | refuted)   -- NEVER deleted
  superseded_by     uuid → client_insights(id)        -- the insight that replaced it
  superseded_reason text                              -- WHY (recoverable audit)
  first_seen_at     timestamptz
  updated_at        timestamptz
```
- **Accumulates:** new corroboration → `evidence_count++`, `confidence` rises (bounded). Knowledge grows over the client's lifetime.
- **Marked, not deleted:** a contradiction sets `status='superseded'|'refuted'` + `superseded_reason` (+ `superseded_by` when a corrected insight replaces it). Fully **recoverable** (flip status back if later evidence supports it).
- **RLS:** owner-only via `owner_user_id`.
- **Index:** `(client_id, layer, status)`, `(client_id, kind, status)`.

### 1.3 How an insight accumulates / supersedes (the lifecycle engine)
A pure, testable `reduceSignal(insight, signal) → action` policy:
- **Corroboration** (positive signal pointing at the insight): `evidence_count++`; `confidence = min(0.99, confidence + k·weight)`; stays `active`.
- **Weak contradiction** (single negative, low weight): `confidence = max(0.05, confidence − k·weight)`. No status change yet.
- **Decisive contradiction** (explicit user "this is wrong", or repeated performance losses attributable to it): create a **new** corrected insight (`source`, higher confidence), set old `status='superseded'`, `superseded_by=new.id`, `superseded_reason=<evidence>`.
- **Refuted**: contradiction with strong evidence and no replacement yet → `status='refuted'` + reason (still recoverable).
- **Re-activation**: if a refuted/superseded insight later gets corroborating evidence above threshold → `status='active'` again (history preserved in an append-only `insight_events` audit, §1.4).
- **Confidence floors/ceilings + decay**: optional slow decay for stale `active` insights with no recent evidence, so the model favors fresh, corroborated knowledge.

### 1.4 `insight_events` (append-only audit — provenance over time)
```
insight_events
  id, insight_id → client_insights, client_id,
  event  (created | corroborated | weakened | superseded | refuted | reactivated),
  delta_confidence numeric, signal_id uuid, reason text, created_at
```
Every change to an insight is logged → full recoverability + explainability ("why does the system believe this?").

### 1.5 Snapshot projection → `client_strategy`
A `synthesizeStrategy(client)` step reads the **active, high-confidence** insights and (re)builds `client_strategy.business_analysis` (StrategyAnalysis #32: strategic_summary/sub_audience/platform_funnel/offer_stack) + `client_strategy.avatar`. So:
- **`client_insights`** = living atoms (truth, with lifecycle).
- **`client_strategy`** = current best synthesized snapshot (what generators read today via `buildAiContext`).
- Re-synthesized when knowledge changes materially (new brief, decisive signal, batch of performance). Keeps the existing #32 / `buildAiContext` path intact — this layer feeds it.

---

## 2. CONTENT TAGGING — `content_artifacts` (so failure can be isolated to a link)

Every generated artifact is stored with the tags needed to attribute success/failure to a specific link.
```
content_artifacts
  id              uuid pk
  client_id       uuid → clients(id) cascade
  owner_user_id   uuid → users(id) cascade
  type            text  (hook | post | creative_image | ad | campaign | message | landing)
  parent_id       uuid → content_artifacts(id)   -- composition: ad = hook+post+creative; campaign → ads
  content         jsonb                           -- headline/body/image_url/script/etc.
  -- TAGS (the isolation keys)
  avatar_ref      jsonb                           -- which sub-audience/avatar (insight id or strategy snapshot ref)
  framework       text                            -- AIDA | PAS | BAB | Story | Us-vs-Them | Direct | ...
  angle           text                            -- the specific angle/hook angle
  funnel_stage    text                            -- TOFU | MOFU | BOFU  (or awareness level)
  hook_ref        uuid → content_artifacts(id)    -- which hook this ad used
  -- PROVENANCE forward-link (which knowledge produced this)
  insight_ids     uuid[]                          -- the client_insights that grounded this artifact
  generated_from  jsonb                           -- prompt/context snapshot (model, framework, ctx hash)
  status          text  (draft | approved | rejected | published)
  created_at, updated_at
```
**Why `insight_ids` matters:** when an artifact fails, we trace *back* to the avatar/USP/angle insight that produced it → diagnosis can blame (and improve) the right knowledge atom, not just the copy.
> Relationship to existing tables: `content_artifacts` is the **canonical learning-loop store**. `generated_content`/`generated_images` (legacy) can be backfilled/forwarded into it; new generation writes here with tags. (Decide at build: extend vs. replace — recommend write-through to `content_artifacts` as source of truth for the loop.)

---

## 3. LEARNING INPUTS — `learning_signals` (both kinds)

```
learning_signals
  id              uuid pk
  client_id       uuid → clients(id) cascade
  owner_user_id   uuid → users(id) cascade
  artifact_id     uuid → content_artifacts(id)   -- nullable (signal may target an insight directly)
  insight_id      uuid → client_insights(id)     -- nullable
  signal_type     text  (user_worked | user_wrong | performance_win | performance_loss)
  polarity        text  (positive | negative)
  weight          numeric(3,2)                    -- explicit user = high (~0.8); single ad perf = low (~0.2) until corroborated
  detail          text                            -- user note OR the metric that triggered
  metrics         jsonb                           -- for performance signals (ctr/cpa/roas/…)
  processed       boolean default false           -- consumed by the lifecycle engine (§1.3)?
  created_at
```
- **User signals (Phase A):** thumbs "✓ עבד" / "✗ לא נכון" on any artifact or insight → a `learning_signals` row → the lifecycle engine updates the linked insights (and their tags' implied insights).
- **Performance signals (Phase B):** derived from Meta data (§5) → win/loss rows.
- A **knowledge-update worker** drains unprocessed signals → applies §1.3 → writes `insight_events`.

---

## 4. DIAGNOSIS + AUTO-IMPROVEMENT (the differentiator)

### 4.1 `diagnoses`
```
diagnoses
  id, client_id, owner_user_id,
  scope_artifact_id  uuid → content_artifacts(id)   -- the ad/campaign analyzed
  failed_link        text (hook | avatar | creative | funnel | offer | none)
  rationale          text                            -- the explanation
  evidence           jsonb                           -- metrics + cohort comparison that point to the link
  target_insight_ids uuid[]                          -- which knowledge atoms to adjust
  recommended_action jsonb                           -- what to change in that link
  applied            boolean default false
  applied_artifact_id uuid → content_artifacts(id)   -- the improved artifact
  created_at
```

### 4.2 How the failed link is isolated (uses the §2 tags + §5 metrics)
Cohort comparison across tagged artifacts makes the link identifiable where a human "can't put their finger on it":
- **High impressions + low CTR** → **hook/creative** failed (didn't stop the scroll).
- **Good CTR + low conversion** → **funnel/offer** failed (landing/offer didn't convert).
- **Poor delivery/relevance + weak reach** → **avatar/targeting** mismatch.
- **One avatar underperforms across many hooks** → the **avatar** (customer insight) is wrong → weaken/supersede that `customers` insight.
- **One angle/framework underperforms across avatars** → the **bridge** (translation/angle) is wrong → weaken that `bridge` insight.
- **Offer-level objections recur** → **offer** insight gap → spawn a `business`/`bridge` insight.

### 4.3 Auto-improvement
Given `failed_link` + `target_insight_ids`, regenerate **only that link** (new hook variants, or re-derive the avatar, or new offer framing, or a funnel/landing change), tagged + grounded in the *updated* knowledge, and queue it as a new `content_artifacts` row (A/B against the original). Result feeds back as new performance → new signals → knowledge updates. Loop closed.

---

## 5. CRITICAL DEPENDENCY — Phase A (now) vs Phase B (needs Meta, H4)

| Capability | Tables | Needs Meta? | Phase |
|---|---|---|---|
| Living knowledge atoms + lifecycle | `client_insights`, `insight_events` | No | **A** |
| Deep 3-layer analysis prompt → insights → snapshot | (uses above + `client_strategy`) | No | **A** |
| Content tagging | `content_artifacts` | No | **A** |
| Learning from **user signals** | `learning_signals` (user_*) | No | **A** |
| Per-artifact **performance** ingestion | `content_performance` (+ `ad_id` linkage) | **Yes** | **B** |
| Learning from **performance** | `learning_signals` (performance_*) | **Yes** | **B** |
| **Diagnosis** (which link failed) | `diagnoses` | **Yes** (needs real metrics) | **B** |
| **Auto-improvement** of the failed link | (regeneration) | **Yes** | **B** |

### 5.1 `content_performance` (Phase B)
```
content_performance
  id, artifact_id → content_artifacts(id), client_id,
  source (meta | manual), ad_id text,             -- ad-level linkage (the deferred ad_id decision, now required)
  metrics jsonb (impressions, clicks, ctr, reach, conversions, cpa, roas, spend, thumbstop, hold_rate),
  period_start date, period_end date,
  verdict text (worked | underperformed | failed),   -- computed vs client/portfolio baselines
  created_at
```
> Phase B requires Meta connected (H4) + **per-ad `ad_id`** linkage (the modeling we deferred in the reporting work). Until then, the loop runs on **user signals only** — which is already a complete, valuable closed loop.

---

## 6. How it sits on `client-model-v2`
```
clients (identity)
  ├─ client_insights (living atoms) ──synthesize──► client_strategy (snapshot read by buildAiContext)
  │     └─ insight_events (audit)
  ├─ content_artifacts (tagged outputs, grounded in insight_ids)
  │     └─ content_performance (Phase B, per-ad metrics)
  ├─ learning_signals (user + performance) ──► lifecycle engine ──► updates client_insights
  ├─ diagnoses (Phase B) ──► auto-improve link ──► new content_artifacts
  └─ meta_connections (optional Meta asset; gates Phase B)
```
- `buildAiContext` extends to read **top active insights** (per layer) + the `client_strategy` snapshot — so every generator is grounded in living knowledge.
- The StrategyAnalysis (#32) prompt **evolves** into the §7 deep-analysis prompt; its 4 sections become the synthesized projection of the insight atoms.
- No change to the v2 separation (identity/strategy/connection) — this is additive on top.

---

## 7. Deep-analysis prompt design (Phase A — "deeper than what they say")
**Input:** `briefs.values` (the 5-section questionnaire) + any existing `active` insights (so it refines, not restarts).
**Instruction (Hebrew, senior strategist):** go *beneath* the stated answers — infer the **real** solution, the **unspoken** wants, the **true** value — and emit discrete, falsifiable insights across the three layers, each with a confidence and a one-line rationale.
**Output (parsed into `client_insights` rows):**
```jsonc
{
  "business":  [ { "kind":"real_solution","content":"…","confidence":0.7,"rationale":"…" }, … ],
  "customers": [ { "kind":"pain","content":"…","confidence":0.8 }, { "kind":"unspoken_want","content":"…","confidence":0.5 }, … ],
  "bridge":    [ { "kind":"translation","content":"business value X → customer want Y","confidence":0.6 },
                 { "kind":"angle","content":"…","confidence":0.6 }, … ]
}
```
- Each item becomes/updates a `client_insights` row (`source='brief'` or `'ai_synthesis'`; confidence from the model). Re-runs **reconcile** against existing atoms (corroborate / supersede via §1.3), never blind-overwrite.
- `synthesizeStrategy` then projects active atoms into `client_strategy` (StrategyAnalysis #32 shape) for `buildAiContext`.

---

## 8. Phased build order (each migration SQL-gated; code as green PRs)

### PHASE A — buildable NOW (no Meta)
1. **Migrations A** (SQL-review): `client_insights`, `insight_events`, `content_artifacts`, `learning_signals` (on top of v2). *(numbered after v2's migrations; integers coordinated at apply.)*
2. **Deep-analysis prompt + extractor** → populate `client_insights` from brief (evolves the #32 prompt); `synthesizeStrategy` → `client_strategy`.
3. **Lifecycle engine** `reduceSignal` + knowledge-update worker (accumulate/supersede/audit) — pure + unit-tested.
4. **buildAiContext** reads top active insights + snapshot.
5. **Tag generation** → every generator writes `content_artifacts` (avatar/framework/angle/funnel/hook + `insight_ids`).
6. **User-signal UI** (✓ עבד / ✗ לא נכון on artifacts + insights) → `learning_signals` → engine. **Closed loop on user signals — shippable.**

### PHASE B — after Meta live (H4)
7. **Migrations B** (SQL-review): `content_performance`, `diagnoses`; add `ad_id` linkage.
8. **Performance ingestion** (Meta ad-level insights → `content_performance`) → `learning_signals` (win/loss).
9. **Diagnosis engine** (§4.2 cohort isolation) → `diagnoses`.
10. **Auto-improvement** — regenerate the failed link, grounded in updated knowledge; A/B; loop.

**Dependency chain:** `client-model-v2` core (M1→M4) **→** Phase A (1→6) **→** Meta H4 **→** Phase B (7→10).

---

## 9. Open decisions for your review
1. `content_artifacts` as the new source-of-truth vs. extending `generated_content` — recommend write-through to `content_artifacts`.
2. Confidence math constants (k, floors, decay) — tune after first real data.
3. Whether `client_strategy` is fully derived from insights (recompute) or also hand-editable (then edits become high-confidence `user_signal` insights). Recommend: editable → captured as insights.
4. `ad_id` granularity (Phase B) — confirm we model per-ad performance (required for diagnosis) when Meta lands.

*Architecture only. No code, no DB changes. On your review we build Phase A in the §8 order (migrations SQL-gated).*
