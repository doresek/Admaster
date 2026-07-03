# Marketing Capabilities — build-ready specs (VISION-DEEP §8 → dispatchable tasks)

> **Purpose.** Build-ready specifications for the superhuman capabilities in `AI-MARKETER-VISION-DEEP.md` §8, written so each can be dispatched to a parallel agent on a **disjoint folder** the moment the security session's work merges. Spec only — no product code, no migrations applied by this doc.
>
> **Conventions.** Every capability states: what it does · exact mechanism · additive schema (if any) · how the atom graph drives it · dependencies (NOW = buildable on current stack, dry-run/fixtures · META = needs live Meta (H4) · FLEET = needs ≥N clients · SALES = needs client outcome data) · effort S/M/L · owned files (disjoint). All schema is **additive**, RLS owner-only, FK→`clients`, following 028/030 conventions. Migration integers are assigned at dispatch (032 = security hardening; next free coordinated then — placeholders written `03x`).
>
> **Shared-file law (collision avoidance, same as masterplan §3):** capabilities NEVER edit shared files (`lib/ai-context.ts`, `lib/decision-engine/**`, `lib/campaigns/**`…). Each exposes a typed module in its own folder; the orchestrator wires integration points serially afterward. Integration points are listed per capability as **[wire-in]** notes.

---

## 0. Summary table (dispatch view)

| # | Capability | Deps | Effort | Owns (disjoint) | New tables |
|---|---|---|---|---|---|
| C-01 | Pre-registration + kill rules (hypothesis ledger) | NOW | S–M | `lib/hypotheses/**` | `hypotheses` |
| C-02 | Episodic memory retrieval | NOW | M | `lib/episodic/**` | `episode_embeddings` (pgvector) |
| C-03 | Calibration tracking | NOW (data: C-01) | S | `lib/calibration/**` | — (view over `hypotheses`) |
| C-04 | Exogenous-shock detection | NOW code · FLEET data (≥8–10) | S | `lib/fleet/shock/**` | `fleet_daily_factors` |
| C-05 | Reflex tier + comment watch | META (poll needs live) | M | `lib/reflex/**` | `metric_snapshots`, `reflex_rules`(seed), `ad_comments` |
| C-06 | Attention scheduler | NOW | S | `lib/attention/**` | — (scores computed) |
| C-07 | Brand-voice lint | NOW | M | `lib/brand-lint/**` | — (atoms + artifact field) |
| C-08 | VoC ingestion | NOW (comments part: META) | M | `lib/voc/**` | `voc_documents`, `voc_quotes` |
| C-09 | Competitor watch | NOW (Ad Library public) | M | `lib/competitor-watch/**` | `competitor_entities`, `competitor_ads` |
| C-10 | Messaging architecture + funnel-as-object | NOW | M | `lib/strategy-objects/**` | `message_architectures`, `funnels` |
| C-11 | Experiment portfolio manager | NOW dry-run · META live | L | `lib/experiments/**` | — (extends `hypotheses` usage) |
| C-12 | Live vertical benchmarks | META + FLEET (≥10) | M | `lib/fleet/benchmarks/**` | `vertical_benchmarks` |
| C-13 | LTV loop | SALES (owner marks / CRM) | M | `lib/ltv/**` | `lead_outcomes` |
| C-14 | Partnership discovery | FLEET (≥15) + consent | M | `lib/partnerships/**` | `partnership_candidates` |

Recommended dispatch waves: **W-α (NOW, parallel):** C-01, C-02, C-03, C-06, C-07, C-08, C-10 (+C-04 code with fixtures). **W-β (META):** C-05, C-09 live pull, C-11 live. **W-γ (FLEET/SALES):** C-12, C-13, C-14.

---

## C-01 Pre-registration + kill rules — the hypothesis ledger

**What.** Every material decision/test becomes a falsifiable, pre-registered hypothesis; verdicts are computed against criteria frozen at launch; kill rules execute on evidence only. Deletes confirmation bias and sunk cost mechanically (VISION-DEEP §3.1, §8.2.6). Craft source: `creative-testing-discipline` skill §1, §4.

**Mechanism.**
- `registerHypothesis(input) → Hypothesis` — validates completeness (claim, insight_ids, prediction{metric, comparator, min_effect}, floor, horizon, verdict_map, kill_rules). Rejects registration if projected sample < floor at planned budget ("don't launch unresolvable tests").
- `resolveHypothesis(id, evidence) → Verdict` — pure function; compares observed vs pre-registered prediction; floor unmet → `inconclusive` (no atom movement); emits `learning_signals` per the frozen `verdict_map` (which atoms move, how much) → existing lifecycle engine applies them.
- `checkKillRules(id, metrics) → KillAction|null` — mercy rule (≥2× floor & <50% of leader), catastrophic rule (≥3× expected CPA, zero results), horizon force-resolution. Pure + unit-testable; the campaign runner (wire-in) polls it.
- Immutability: registration row is append-only; edits create a superseding row with `superseded_by` (same pattern as insights).

**Schema (additive).**
```
hypotheses: id, client_id, owner_user_id, insight_ids uuid[], claim text,
  prediction jsonb, floor jsonb, horizon jsonb, verdict_map jsonb, kill_rules jsonb,
  test_refs jsonb (campaign_item ids/arms), status text (open|supported|refuted|inconclusive|killed),
  resolution jsonb, registered_at, resolved_at, superseded_by uuid
idx (client_id, status)
```

**Atom graph.** `insight_ids` binds each hypothesis to the atoms it tests; resolution flows through `learning_signals` → lifecycle → `insight_events` (full audit). Dedup guard: before registering, query resolved hypotheses on the same atoms — "already tried" memory.

**Deps/effort/owns.** NOW · **S–M** · `lib/hypotheses/**` + tests + `app/api/hypotheses/**` (list/detail read API for command center). Migration `03x_hypotheses`. **[wire-in later]:** decision engine calls register at decision time; runner polls kill rules; diagnosis reads open hypotheses.

---

## C-02 Episodic memory retrieval — precedent at decision time

**What.** Before any material decision, retrieve the k most similar past situations (this client's, and abstracted fleet episodes) with their outcomes — case-based reasoning on top of the atom graph (§8.2.3).

**Mechanism.**
- **Episode = a resolved unit of experience:** a resolved hypothesis, a diagnosis (+confirmation result), or a completed campaign_item with verdict. `composeEpisodeText(episode)` renders a canonical text (situation: vertical, audience descriptor, angle, funnel stage, budget band → action → outcome → lesson).
- `embedEpisode()` on creation (resolution events trigger it); embeddings in pgvector.
- `recallSimilar(context, k, scope) → Episode[]` — scope `client` (verbatim) or `fleet` (only episodes pre-abstracted: no names, no verbatim copy — reuses C-12/playbook abstraction rules). Returns episodes + a one-line "precedent summary" each, ready for prompt injection.
- Cold path backfill: script embeds existing `diagnoses` + completed artifacts (all already in prod schema).

**Schema (additive).** `create extension if not exists vector` (needs Supabase pgvector — available on the project tier). `episode_embeddings: id, client_id, owner_user_id, source_kind text (hypothesis|diagnosis|campaign_item), source_id uuid, episode_text text, abstracted_text text, embedding vector(1536), created_at` + ivfflat index. (Embedding model/dimension pinned at build; dimension is a config constant.)

**Atom graph.** Episodes carry the insight_ids of their source; recall results let the decision prompt say "atom #12 was implicated in 3 similar past failures." Retrieval is *read-only* over the graph — no lifecycle writes.

**Deps/effort/owns.** NOW · **M** · `lib/episodic/**` + tests + backfill script `scripts/backfill-episodes.mjs`. Migration `03x_episodic` (vector ext + table). **[wire-in]:** decision-engine context builder gains a `precedents` block (orchestrator, serial).

---

## C-03 Calibration tracking — the system knows its own hit rate

**What.** Brier-scores every resolved hypothesis prediction and every diagnosis confidence against outcomes; per-domain calibration curves feed back into how much confidence numbers are trusted (§8.2.6).

**Mechanism.**
- `scoreResolution(hypothesis) → brier` on every resolution (prediction confidence vs binary outcome; inconclusive excluded).
- `calibrationReport(scope) → {overall, by_domain}` — domains: angle-tests, audience-tests, offer-tests, diagnoses. Rolling windows (90d).
- `calibrationAdjust(rawConfidence, domain) → adjustedConfidence` — a pure mapping (isotonic/binned) consumers may apply; published as a module constant table, recomputed weekly by the heartbeat (wire-in).
- Surfaced in command center: "המערכת צדקה ב-78% מתחזיות ה-0.8 שלה" — trust as a number.

**Schema.** None — computed views/queries over `hypotheses.resolution` + `diagnoses`. Optional materialized cache table deferred.

**Deps/effort/owns.** NOW (needs C-01 rows to score — ships dormant until data) · **S** · `lib/calibration/**` + tests.

---

## C-04 Exogenous-shock detection — "שוק, לא אתה"

**What.** Detects market-level events (CPM spikes, engagement collapse across many clients at once: chag, war news cycle, platform change) and suppresses/reframes diagnoses during shock windows so atoms aren't falsely weakened (§8.2.5). The single biggest misdiagnosis-killer.

**Mechanism.**
- Daily job computes fleet factors: median + MAD of day-over-day deltas for CPM/CTR/CVR across all active clients (per platform). Shock = |median delta| > threshold with ≥60% of clients moving the same direction (robust to one client's outlier).
- `getShockState(date, platform) → {shocked, factor, direction, note}` — consumed by: diagnosis engine (suppress/annotate — wire-in), verdict computation (normalize vs fleet factor, or exclude window), the national-mood protocol (`israeli-market-timing` skill §3 — a severe negative shock triggers the crisis-switch proposal).
- Calendar overlay: known events (chagim table) pre-annotate expected shocks so they don't even alarm.
- Fixture-tested NOW with synthetic fleets; goes live silently once ≥8–10 clients have `content_performance` rows.

**Schema.** `fleet_daily_factors: id, date, platform, metric, median_delta, mad, sample_n, shocked bool, note` — **no client FK** (aggregate only; contains nothing tenant-identifying).

**Deps/effort/owns.** NOW code, FLEET data · **S** · `lib/fleet/shock/**` + tests. Migration `03x_fleet_factors`.

---

## C-05 Reflex tier + comment watch — the 24/7 nervous system

**What.** Minutes-scale, rule-based (no LLM) watchers over active spend + ad comments; whitelisted protective actions (pause, cap, alert, hide/flag comment) (§8.2.1).

**Mechanism.**
- Poller (cron ~15min) fetches insights for campaigns in `live` state with spend > 0 → appends `metric_snapshots` → `evaluateReflexRules(snapshots, rules) → ReflexAction[]` (pure): EWMA bands per metric per ad; breach types: spend-spike-no-results (catastrophic kill, mirrors C-01 rule), delivery-collapse, CTR-cliff, frequency-breach. Action whitelist at L1/L2: `pause`, `cap`, `notify` only — never scale-up (that's tactical-tier with rationale).
- Every action → `campaign_decisions` row (source `reflex`, rule id as rationale) + owner notification. Idempotent: rule firing keyed on (ad_id, rule, window) — no repeat-fire storms.
- **Comment watch:** poll comments on own active ads → classify rule-based+small-model (question/objection/praise/toxic) → `ad_comments` rows → actions per `voc-mining` skill §5 (draft reply in brand voice → queue or post per autonomy; hide toxic; escalate). Comments also stream to C-08 as VoC documents (one pipeline, two products).
- Dry-run mode: fixture snapshot streams; full loop testable without Meta.

**Schema.** `metric_snapshots: id, client_id, owner_user_id, ad_id text, artifact_id uuid, captured_at, metrics jsonb, ewma jsonb` (idx client_id+ad_id+captured_at) · `ad_comments: id, client_id, owner_user_id, ad_id text, platform_comment_id text unique, author_hash text, text, classified text, action_taken text, created_at` · reflex rules as versioned code constants (not DB) for reviewability.

**Deps/effort/owns.** Code NOW (fixtures), live needs META · **M** · `lib/reflex/**` + tests + `app/api/reflex/**` (cron endpoints). Migration `03x_reflex`. **[wire-in]:** heartbeat cron registration; InforU/notify channel.

---

## C-06 Attention scheduler — rigor allocated by information value

**What.** Ranks clients per tick by where attention buys the most (anomaly score, open-hypothesis value, atom staleness, upcoming calendar windows) — not by spend (§8.2.2).

**Mechanism.** `scoreAttention(clientState) → {score, components}` — pure, over existing ledgers: unresolved reflex flags (C-05) · value of open hypotheses nearing floor (C-01: sample progress × decision-unblocking weight) · staleness (days since last atom event vs cadence) · calendar proximity (seasonality atoms, `israeli-market-timing` §5) · error states (token expiring — from meta health). Heartbeat fan-out consumes the ranking: order + per-tick compute budget (which clients get the frontier-model pass today). Tier caps frequency, never rigor. Scores logged per run for auditability ("why did client X get attention today").

**Schema.** None (computed; logged inside heartbeat run records when heartbeat lands).

**Deps/effort/owns.** NOW · **S** · `lib/attention/**` + tests. **[wire-in]:** heartbeat fan-out (Wave-3 heartbeat build consumes this module).

---

## C-07 Brand-voice lint — 100% brand coverage, mechanically

**What.** Every artifact checked against the client's brand atoms pre-publish; violations block or flag (§8.1). Craft source: `copywriting-craft` §5/§7 + `hebrew-content-writer` register rules.

**Mechanism.**
- Brand voice lives as atoms: `kind: brand_voice` (register, person/gender address policy, emoji policy, taboo words, loaded-word policy, humor stance) — seeded from brief §identity, editable via signals like any atom.
- `lintArtifact(content, brandAtoms) → {score, violations[]}` — two passes: deterministic checks (taboo list, forbidden claims, emoji policy, gender-address consistency — regex/rule) then small-model register check (matches the declared register? policy-risk phrases per Meta rules?). Deterministic failures block; model-pass concerns flag with reason.
- Policy-safety sub-check is included (personal-attribute callouts, health before/after) — protects account standing (media-buying B21).
- Runs in the generation path (wire-in) and batch-audits existing drafts.

**Schema.** None new — `content_artifacts.generated_from` jsonb gains a `lint` sub-object (no migration; jsonb).

**Deps/effort/owns.** NOW · **M** · `lib/brand-lint/**` + tests. **[wire-in]:** master-studio/autopilot generation call-sites (orchestrator, serial).

---

## C-08 VoC ingestion — the customers layer fed by actual customers

**What.** Reviews + ad comments + pasted threads → typed verbatim quotes → atom actions (corroborate/new/contradict) with quote evidence (§8.1). Craft source: `voc-mining` skill (the extraction spec IS that skill's §§1–4).

**Mechanism.**
- Ingest adapters: manual paste/upload (NOW — owner pastes reviews/threads; zero API friction), ad-comments stream from C-05 (META), review-platform fetchers (later; ToS-per-source).
- Pipeline: `ingestDocument(raw, source_meta)` → dedupe (content hash) → extraction prompt (the seven extractables, verbatim quotes, PII-strip) → `voc_quotes` rows → `reconcileQuotes(clientId)` batches quotes into atom actions via existing lifecycle (`learning_signals` with `source: voc`, evidence = quote ids). Confidence math per skill §3 (frequency across independent sources).
- Quote bank read API for generation ("copy ammunition" — hooks pull verbatim pain language).
- Owner surfacings (brief-vs-VoC contradictions, 1–2★ alerts) emitted as command-center items.

**Schema.** `voc_documents: id, client_id, owner_user_id, source text (own_reviews|competitor_reviews|ad_comments|community|sales_thread|manual), source_meta jsonb, raw_hash text unique, ingested_at` · `voc_quotes: id, document_id fk, client_id, owner_user_id, quote text (PII-stripped), extractable text (pain|desire|objection|alternative|trigger|proof|identity), segment_tags jsonb, atom_action jsonb (linked insight_id + action), created_at`.

**Deps/effort/owns.** NOW (manual + fixtures; comments join via C-05) · **M** · `lib/voc/**` + tests + `app/api/voc/**` (ingest + quote-bank read). Migration `03x_voc`.

---

## C-09 Competitor watch — the angle map and the uncontested lane

**What.** Periodic Meta Ad Library pulls per tracked competitor; longevity-as-win-proxy decoding; angle-coverage map; contested/open flags on angle atoms (§8.1). Craft source: `competitor-analysis` skill.

**Mechanism.**
- `competitor_entities` per client (seeded from brief + VoC `alternative` atoms; capped ~5).
- Fetcher: Ad Library (public web; official API where applicable) → normalized `competitor_ads` rows (page, creative text/format, start date, active flag, landing URL). **Fetch layer isolated behind an interface with a fixture mode** — scraping fragility is contained to one adapter file; manual-paste fallback (screenshots/text of a competitor's ads) supported from day one so the capability degrades gracefully.
- Analyzer (monthly + on-demand): veteran detection (age > 8w), churn detection (appeared→vanished), angle decoding (LLM tags each veteran ad with the angle taxonomy), map assembly → outputs: `alternative` atom updates (strengths/weaknesses), angle atoms flagged `structured.contested`, strategic flags for the planner (open lane / saturated warning).
- Everything lands as atoms + a rendered map object in `client_strategy` sidecar (jsonb) — the map is re-derivable; atoms are durable.

**Schema.** `competitor_entities: id, client_id, owner_user_id, name, page_ref, ring text (direct|category|non_consumption), active bool` · `competitor_ads: id, entity_id fk, client_id, owner_user_id, platform_ad_ref text, first_seen date, last_seen date, active bool, creative jsonb, decoded jsonb (angle, awareness, offer), created_at` (unique entity_id+platform_ad_ref).

**Deps/effort/owns.** NOW (fixtures + manual paste; live pull best-effort) · **M** · `lib/competitor-watch/**` + tests + `app/api/competitor-watch/**`. Migration `03x_competitor`.

---

## C-10 Messaging architecture + funnel-as-object

**What.** Two strategy objects projected from atoms: the message architecture (core promise → pillars → proof map) and the funnel (nodes/edges with expected + actual conversion). Makes coverage and funnel health *measurable* (§8.1). Craft source: `marketing-strategy` skill §2/§4.

**Mechanism.**
- `synthesizeArchitecture(clientId)` — projection from active atoms per skill §2 (core promise = top translation atom; pillars = desire/objection clusters; proof assigned). Versioned; re-synth on material atom drift (same trigger discipline as `client_strategy`). Artifacts gain `pillar_ref` tag (jsonb in `content` — no migration) → `coverageReport(clientId, window)` = content-per-pillar over 30d, silent-pillar flags.
- `designFunnel(clientId, decision)` — nodes/edges object per skill §4 procedure; expected rates resolved: client baseline → playbook prior → declared guess (provenance recorded). `funnelHealth(funnelId)` joins actual conversion events per edge → worst actual/expected edge = the diagnosis engine's localization input (wire-in).
- Both objects render in command center (read APIs) — the owner sees the strategy as structure, not prose.

**Schema.** `message_architectures: id, client_id, owner_user_id, version int, core_promise jsonb, pillars jsonb, proof_map jsonb, grounded_in uuid[], created_at` · `funnels: id, client_id, owner_user_id, campaign_id uuid, nodes jsonb, edges jsonb (expected+provenance), status, created_at, updated_at`.

**Deps/effort/owns.** NOW · **M** · `lib/strategy-objects/**` + tests + `app/api/strategy-objects/**`. Migration `03x_strategy_objects`.

---

## C-11 Experiment portfolio manager — information per shekel, fleet-grade

**What.** Sits over C-01: designs the test slate (which hypotheses run now, arm allocation, budgets), enforces power floors pre-launch, early-stops via bandit allocation, pools evidence hierarchically along the atom graph (§8.2.4). Craft source: `creative-testing-discipline` §3/§5.

**Mechanism.**
- `planSlate(clientId, exploreBudget) → TestPlan[]` — ranks open hypothesis candidates by information value (decision-unblocking weight × belief-movement potential ÷ cost-to-floor); fits the slate to the budget's information capacity (CTR-grade vs CVR-grade costs); explore/exploit split modulated by brain maturity (skill §5).
- `allocateArms(test, dailyBudget)` — Thompson-style reallocation across arms at the daily tick within the test's registered structure; respects B6/B8 structure rules (never starves an arm below floor trajectory; mercy/catastrophic kills delegated to C-01 rules).
- **Hierarchical pooling:** `pooledEvidence(atomId)` aggregates arm results across tests/audiences sharing the atom (client scope) and across clients (fleet scope, abstracted) — floors can be met by structure. Pooled resolutions emit the same `learning_signals` path with pooling provenance.
- Dry-run complete with fixture arms; live allocation needs META.

**Schema.** None new — operates on `hypotheses` + `campaign_items` + `content_performance`.

**Deps/effort/owns.** NOW dry-run, META live · **L** · `lib/experiments/**` + tests. **[wire-in]:** weekly heartbeat calls `planSlate`; runner consumes `allocateArms`.

---

## C-12 Live vertical benchmarks

**What.** Continuous fleet-computed benchmarks (CPL/CPM/CTR/CVR by vertical × objective × month, IL market) — verdicts become market-relative; sales copy gets receipts (§8.2.5).

**Mechanism.** Nightly aggregation over fleet `content_performance` → k-anonymous cells only (≥5 clients per cell, else cell suppressed) → `vertical_benchmarks`. `getBenchmark(vertical, objective) → {p25, median, p75, n}` consumed by verdict computation (a third baseline tier: client → benchmark → prior) and the digest ("CPL שלך 27₪ — חציון הענף 41₪"). Abstraction rule: aggregates only, no client-attributable values; same governance as playbook layer.

**Schema.** `vertical_benchmarks: id, vertical, objective, platform, month, metric, p25, median, p75, sample_clients int` — no client FK.

**Deps/effort/owns.** META + FLEET(≥10) · **M** · `lib/fleet/benchmarks/**` + tests (fixture fleets NOW). Migration `03x_benchmarks` (can ride the C-04 migration).

---

## C-13 LTV loop — optimize what the business keeps

**What.** Lead outcomes (relevant / irrelevant / closed / value) captured from the owner → LTV-per-audience atoms → allocator optimizes LTV-weighted, not CPL (§8.1). Craft sources: `whatsapp-marketing` §4 (the check-in is the capture UX), diagnosis link "cheap leads, bad leads".

**Mechanism.**
- Capture surfaces: command-center lead list (one-tap marks) + WhatsApp check-in replies parsed to outcomes (wire-in to whatsapp lib). Each outcome → `lead_outcomes` row → emitted as `learning_signals` against the lead's source artifact AND its audience atom (high weight — owner truth).
- `ltvByAudience(clientId)` rolls outcomes into `structured.ltv_estimate` on sub_audience atoms (median value × close rate, with sample caveats — floors apply here too).
- Allocator input adapter: `valueWeight(subAudienceAtom)` for C-11/budget reallocation (wire-in). Honest fallback: with no value data, relevance-rate alone already catches the cheap-bad-leads failure.

**Schema.** `lead_outcomes: id, client_id, owner_user_id, lead_ref jsonb (lead id/phone hash), artifact_id uuid, outcome text (relevant|irrelevant|closed|no_show), value numeric, marked_via text (ui|whatsapp), created_at`.

**Deps/effort/owns.** SALES (owner participation) — capture UX buildable NOW · **M** · `lib/ltv/**` + tests + `app/api/lead-outcomes/**`. Migration `03x_ltv`.

---

## C-14 Partnership discovery — the network acting together

**What.** Computes audience-overlap between consenting, non-competing clients → proposes cross-promotions to both owners (§8.2.5). Strictly opt-in; no client is visible to another without double consent.

**Mechanism.** Overlap scoring on *abstracted* audience descriptors (sub_audience atom features: demo bands, geo, interest clusters — never raw data). Compatibility filter: non-competing verticals (competitor rings from C-09), geo intersection, brand-register compatibility (brand atoms). Proposal object → both owners get an anonymized teaser ("עסק משלים באזורך עם קהל חופף ~40%") → double opt-in reveals identities → suggested collab formats (mutual WhatsApp feature, bundle offer, co-post). Consent state machine + audit; any rejection permanently suppresses the pair.

**Schema.** `partnership_candidates: id, client_a uuid, client_b uuid, overlap_score, basis jsonb (abstracted features only), state text (proposed|a_ok|b_ok|matched|rejected|suppressed), created_at, updated_at` — RLS: each owner sees only their side until `matched`.

**Deps/effort/owns.** FLEET(≥15) + consent UX · **M** · `lib/partnerships/**` + tests + `app/api/partnerships/**`. Migration `03x_partnerships`.

---

## 15. Cross-cutting notes for the dispatch orchestrator

1. **Migration lock:** 7 capabilities carry migrations (C-01, C-02, C-04(+C-12), C-05, C-08, C-09, C-10, C-13, C-14). Author each in its task's folder-run but assign integers serially at dispatch (orchestrator-owned, per masterplan doctrine; 032 = security). All additive; DDL applies via the C1 channel (`SUPABASE_DB_URL`).
2. **Wire-in queue (orchestrator, serial, after parallel wave):** decision-engine context (C-02 precedents, C-01 registration, C-03 adjust) · diagnosis engine (C-04 suppression, C-10 funnel localization) · runner (C-01 kill polling, C-11 arm allocation) · generation path (C-07 lint, C-08 quote bank) · heartbeat (C-05 cron, C-06 ranking, C-11 slate, C-12 nightly) — each wire-in is a small serial PR touching the shared file once.
3. **Skills ↔ capabilities:** the nine `.claude/skills/` marketing-craft skills are the *judgment layer* these engines encode/prompt with — capability prompts should reference the skill files as canonical craft (single source of truth for heuristics like sample floors and kill thresholds; constants live in code, rationale lives in skills).
4. **Everything dry-run first** (masterplan doctrine): every capability ships fixture-mode green before any live flag; META/FLEET/SALES gates flip data on, not code on.

*Spec only — no product code, no schema applied. Dispatch after the security branch state is confirmed stable.*
