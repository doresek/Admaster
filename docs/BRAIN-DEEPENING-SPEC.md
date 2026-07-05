# BRAIN DEEPENING — 8 upgrades to the heart of the system

> **What this is.** Design spec (no code) for deepening the living brain — `client_insights` (3 layers, ~25 atoms/client today, confidence + lifecycle + `insight_events`), the highest-leverage investment in the system: every generator, decision, page, and message derives from it. Part of the Perfect-Marketer body: `PERFECT-MARKETER-ROADMAP.md` (master map) · `MARKET-INTELLIGENCE-SPEC.md` (the outward eye) · `MARKETING-TECHNIQUE-SYSTEM.md` (technique selection reads the brain).
>
> **Current state (honest):** the brain LIVES already — lifecycle engine (corroborate/weaken/supersede, never delete), signals from users/VoC/hypothesis verdicts/competitor watch, episodic memory, synthesis to strategy. What's shallow: evidence is untyped (a guess and a sale weigh alike per unit), atoms are a FLAT LIST (no relationships), one implicit customer (not personas), no self-awareness of gaps, no temporality, uneven generation grounding, no distilled thesis.

**Priority order:** U1 living-coverage + U2 evidence-chains (critical, first) → U8 big-idea + U6 temporality (cheap, high leverage) → U7 grounding-maximization → U3 graph → U4 personas → U5 known-unknowns.

---

## U1. LIVING — full signal coverage + honest decay (priority 1a, effort M)
**Gap:** the update machinery exists but coverage is partial. Today atoms move on: brief re-analysis, user ✓/✗, VoC quotes, hypothesis verdicts (0.4/0.3 weights), competitor findings. NOT yet moving atoms: organic post performance, LP conversion outcomes, WhatsApp reply/no-reply patterns, sales/lead-quality outcomes (C-13 unbuilt), site analytics.
**Spec:**
1. **Signal coverage matrix** (the deliverable): every outcome-producing surface × the signal it must emit × the atom kinds it may move × its weight band. Weights follow the established discipline — single-observation ≈0.2, cross-source ≈0.4, owner-explicit ≈0.8, sales-verified ≈0.6–0.7 — all below decisive unless repeated (`creative-testing-discipline` weight rules).
2. **Confidence decay** (designed in client-intelligence.md §1.3, never implemented): slow decay for `active` atoms with no evidence in N days (e.g. −0.02/30d, floor 0.4 for brief-sourced), so the brain favors fresh corroborated knowledge. Decay pauses for `durable` atoms (U6). Heartbeat monthly applies it; every decay is an `insight_events` row (audit stays complete).
3. **Update SLO:** every heartbeat weekly tick reports "atoms moved this week: N" in the digest — a visibly living brain is also the product (client-intelligence-ui already designed the surface).
**Generation effect:** copy stops leaning on stale beliefs; the same client regenerated in month 6 is measurably different from month 1 — and the diff is explainable from the event log.

## U2. EVIDENCE CHAINS — confidence is earned, not asserted (priority 1b, effort M)
**Gap:** `insight_events` gives a full audit trail, but evidence is *ungraded* — 3 corroborations from AI synthesis look like 3 corroborations from sales data.
**Spec:**
1. **Typed evidence grades** on every signal/event: `E0 model-inference` · `E1 brief-claim` (owner says) · `E2 voc-quote` (customer said) · `E3 behavior` (clicked/converted once) · `E4 verdict` (pre-registered test resolved) · `E5 sales-outcome` (money moved). Additive columns on `learning_signals`/`insight_events` (`evidence_grade`), backfilled from `source`/`signal_type` mappings.
2. **Confidence ceilings by best grade** (the core rule): an atom whose best evidence is E0/E1 caps at 0.6 no matter how many corroborations; E2 caps 0.75; E3 0.85; E4/E5 → 0.95+. Pure function in the lifecycle (`ceilingFor(bestGrade)`), enforced in `reduceSignal`'s clamp. Guesses can never masquerade as knowledge.
3. **Evidence chain rendering:** per atom, the UI/context can state: "מאמינים ש-X (0.82) כי: הופיע בבריף → צוטט ב-4 ביקורות → אושש בניסוי #12" — provenance as product (extends client-intelligence-ui §3).
4. **Prompt-visible grades:** `buildAiContext` labels atoms `[מאומת בניסוי]` vs `[השערה]` — generators hedge or commit accordingly; the decision engine prefers high-grade atoms for big budget bets (ties into C-03 calibration: prediction confidence inherits evidence grade).
**Generation effect:** claims in copy match the evidence behind them (a proof atom at E5 becomes a bold claim; an E0 hunch becomes a question to test, not a headline) — the honesty that E-E-A-T and תיקון-13-era trust demand.

## U3. RELATIONSHIPS — from list to graph (effort M-L)
**Gap:** atoms are flat; the connections live implicitly in prose and in scattered `structured` fields.
**Spec:** additive `insight_edges` table: `(from_insight, to_insight, type, confidence, source_ref)` with a small typed vocabulary: `translates` (business→customers: the bridge's actual bridges) · `answers` (offer-component/proof → objection) · `targets` (angle → persona) · `supports` / `contradicts` (atom↔atom) · `derived_from` (synthesis provenance). Edges are created by the analyzer (extraction prompt emits relations), by reconciliation (VoC quote corroborating atom A while contradicting B), and mechanically (coverage-matrix links).
**What it unlocks:** the offer↔objection **coverage matrix becomes a query** (`marketing-strategy` §3 mechanized — uncovered objections are just objection atoms with no incoming `answers` edge); **cascade integrity** (weakening a persona atom flags every angle that `targets` it for review); richer synthesis (the strategy snapshot walks the graph, not a kind-sorted list); C-02 episodic recall can follow edges ("what happened to things targeting THIS persona").
**Generation effect:** section-level grounding gets precise — the objection strip on an LP pulls the objections WITH their answering atoms, not two independent lists.

## U4. MULTIPLE PERSONAS — first-class audience clusters (effort M)
**Gap:** `sub_audience`/`persona` kinds exist, but pains/desires/objections float unattached — one implicit "the customer."
**Spec:** persona = a persona atom + `targets`-edges from its pains/desires/objections/awareness (U3 dependency); the analyzer clusters at extraction time; **segmentation discovery** (already envisioned in VISION-DEEP §2.3) creates new personas from performance splits (CPA divergence between segments → propose a split, owner confirms). Per-persona: decision engine picks the persona per campaign (it already picks sub_audience — this grounds it in a cluster, not a string), LP scent per persona-arm, WhatsApp sequences tone-matched, digest reports per-persona results. Cap ~3–5 active personas (SMB reality; more is noise).
**Generation effect:** "הקהל" stops being an average. A dental clinic's anxious-adult persona and parent-of-teen persona get different heroes, different objections, different proof — from the same brain.

## U5. KNOWN-UNKNOWNS — the brain knows what it doesn't know (effort M)
**Gap:** the brain only accumulates what arrives; nothing asks what's MISSING.
**Spec:** a pure `detectGaps(atoms, edges)` audit run by the heartbeat monthly: missing load-bearing kinds per layer (no `objection` atoms? no `proof`? no `alternative`—competitor unknown?), low-confidence atoms carrying high-stakes decisions (an 0.45 atom grounding the main campaign), objections without `answers` edges, personas with <3 attached atoms, E0/E1-only atoms in load-bearing positions (U2 synergy). Each gap emits a **research action**, routed like everything else: a question in the owner WhatsApp check-in ("לקוחות מתלוננים על מחיר — או שזה בכלל אמון?"), a VoC-mining target (competitor reviews for the missing alternative atom), or a **pre-registered hypothesis** (the cheapest test that resolves the unknown — C-01/C-11 machinery as the brain's active-learning arm).
**Generation effect:** indirect but compounding — the brain steers its own filling; month-3 brains stop having the month-1 holes. This is `attention scheduler` food too (staleness/gap score).

## U6. STABLE vs EPHEMERAL — temporality (effort S)
**Gap:** "מבצע עד סוף החודש" and "הלקוחות קונים ביטחון" live in identical rows; nothing expires.
**Spec:** additive `temporality` on `client_insights`: `durable` (default for business/customers truths; decay-exempt per U1) · `seasonal` (window in `structured` — the israeli-market-timing atoms formalized) · `ephemeral` (+`valid_until`; auto-`superseded` at expiry with reason "expired", by the heartbeat). Analyzer classifies at extraction; offers/promos default ephemeral. `buildAiContext` and all generators filter by temporal validity; seasonal atoms surface only in-window (with decision_lag lead time).
**Generation effect:** kills the "פסח promo in a July post" class of error mechanically; seasonal knowledge returns exactly when it should.

## U7. BRAIN→GENERATION MAXIMIZATION — a deep brain that idles is wasted (effort M)
**Gap:** grounding exists everywhere but unevenly — surfaces differ in which kinds they pull, how many, and whether they check staleness.
**Spec:**
1. **Grounding audit + per-surface policy:** a declared policy per generator (ads, posts, articles, LP sections, site pages, WhatsApp, digest): which layers/kinds, how many atoms, awareness rules, evidence-grade minimums (U2) — one reviewed table instead of N ad-hoc prompt choices.
2. **Grounding completeness metric:** per client, % of active high-confidence atoms referenced by ≥1 live artifact in 60 days; unused load-bearing atoms ("ammunition never fired") reported in the digest — the U5 mirror image.
3. **Stale-grounding detection:** artifacts whose `grounded_in` atoms got superseded/expired → regeneration queue (the freshness engine's brain-side twin; `ORGANIC-DEEP-RESEARCH` §4.3 supplies the SEO-side one).
4. **Atom-selection ranking** at generation time: confidence × evidence grade × temporal validity × freshness × (persona match) — one shared pure function replacing per-generator improvisation.
**Generation effect:** the whole point — quality scales WITH brain depth instead of plateauing at "top 5 atoms in the context."

## U8. THE BIG IDEA — the distilled thesis (effort S, disproportionate leverage)
**Gap:** the brain has atoms and a strategy snapshot, but no ONE LINE that everything serves — what a great strategist gives a brand.
**Spec:** a `big_idea` atom (bridge layer, singleton kind): synthesized from the graph's strongest translation path ("אתה לא מוכר וילות — אתה מוכר שקט נפשי למשפחה חרדית"), with its evidence chain (U2) and the edges it rests on (U3). Re-derived only on material drift (same trigger discipline as strategy synthesis); owner-editable — an owner's edit is an E1→E4-grade signal (they know their business). Rendered at the TOP of `buildAiContext` (`═══ הרעיון הגדול ═══`), first input to angle selection, the message architecture's core-promise anchor (C-10), and the first line of the client's strategy screen.
**Generation effect:** coherence. Every post, page, and ad orbits one idea instead of orbiting whichever atoms ranked that day — the difference between content and a campaign.

---

## Rollout (spec-level; migrations additive, numbered at build)
| Wave | Upgrades | Schema (additive) |
|---|---|---|
| B1 | U1 coverage + decay · U2 grades + ceilings | `evidence_grade` cols; decay constants in code |
| B2 | U8 big idea · U6 temporality | `temporality`, `valid_until` cols |
| B3 | U7 grounding policy + metrics | none (code + one jsonb) |
| B4 | U3 edges → U4 personas → U5 gaps | `insight_edges` table |
Every wave: pure-core + deep tests + the standing invariants (audited events for every mutation; atoms never deleted; additive only). Cross-doc: U2 grades feed C-03 calibration; U5 gaps feed the attention scheduler; U6 formalizes israeli-market-timing atoms; U7's regeneration queue merges with the freshness engine; `MARKET-INTELLIGENCE-SPEC` writes INTO this brain (outward atoms get the same grades/edges/temporality).

*Design only — no code.*
