# MARKETING TECHNIQUE SYSTEM — encoding the legends, honestly

> **What this is.** Design spec (no code) answering: can we encode the best marketers' techniques into the system — and what are the limits? Three honest parts: (1) what's ENCODABLE from knowledge, (2) the JUDGMENT knowledge can't give and how our data builds it, (3) staying CURRENT past any model's cutoff. Part of the Perfect-Marketer body: `PERFECT-MARKETER-ROADMAP.md` · `BRAIN-DEEPENING-SPEC.md` (evidence grades the judgment loop rides on) · `MARKET-INTELLIGENCE-SPEC.md` (the current-tactics feed).
>
> **What already exists (don't rebuild):** nine marketing-craft skills in `.claude/skills/` (strategy, copywriting, diagnosis, testing, VoC, competitor, buying, WhatsApp, IL-timing) — the codified judgment layer; `lib/frameworks.ts` + master-studio's multi-marketer→judge pipeline (personas already channel distinct marketing philosophies); the decision engine's angle selection; C-01/C-03 (verdicts + calibration); C-02 (episodic precedents). This spec ORGANIZES that into a selectable library and closes the loop that turns principles into judgment.

---

## 1. ENCODABLE — the structured technique library

### 1.1 What the legends actually give us (and their expiry status)
| Source | The durable core | What's dated (honesty) |
|---|---|---|
| Hopkins (*Scientific Advertising*) | test everything, one variable, measure — literally our C-01 pre-registration doctrine | coupon-era mechanics |
| Ogilvy | research before copy; the Big Idea (→ `BRAIN-DEEPENING` U8); headline = 80% of the money (→ hook discipline); specifics over superlatives | long-copy-always dogma predates feed scrolling |
| Schwartz (*Breakthrough Advertising*) | **awareness levels** — already load-bearing across our stack (decision engine funnel_stage, copywriting-craft §2, LP skeletons); channel EXISTING desire, never create it | media examples; the levels themselves aged perfectly |
| Halbert | the starving-crowd principle (market > offer > copy — ties to MARKET-INTELLIGENCE); A-pile/B-pile = the scroll-stop principle | direct-mail mechanics |
| Kennedy | deadline/offer discipline, "message-market-media" triangle, follow-up sequences (→ our WhatsApp retention) | pressure tactics that damage IL trust (see copywriting-craft §5 — Israeli skepticism) |
| Brunson | value-ladder/funnel architecture (→ C-10 funnel-as-object), hook-story-offer | funnel-hacking culture; over-claiming style backfires in IL |
| Frameworks (AIDA/PAS/BAB/4U/JTBD/StoryBrand/PASTOR) | section-order skeletons per awareness — encoded in copywriting-craft + LP-MASTERY §1 | none — but they're COMMODITY; selection is the edge |

### 1.2 The library schema (curated, not dumped)
A reviewed data asset (`technique_library` — versioned content, not a prompt dump):
```
technique      id, name, lineage (who/where), category (hook|structure|offer|proof|
               urgency|funnel|retention|pricing|targeting)
when_to_use    awareness levels, funnel stages, verticals, personas (atom-typed:
               matches the brain's vocabulary so selection is mechanical)
when_NOT      contraindications — the half most collections omit (e.g. urgency ×
               trust-poor brands; long-form × most-aware; scarcity × IL skepticism)
requires       what the brain must supply (e.g. PAS needs a pain atom ≥E2 grade;
               big-promise hooks need proof atoms; deadline techniques need a REAL
               deadline — the LP-MASTERY §2 urgency rule)
examples       2-3 annotated Hebrew examples
evidence       provenance: legend-principle | research-2026 (cited) | OUR data
               (win-rate, sample n) — the BRAIN-DEEPENING U2 grades applied to
               techniques themselves
status         active | deprecated (with reason) | trial
```
~60–100 entries at launch (curated from the nine skills + the legends' cores + the research docs' cited findings), each reviewed. **Selection, not generation, is the product**: given a decision (angle, awareness, persona, funnel stage, available atoms), a pure `selectTechniques()` filters by `when_to_use` minus `when_NOT` minus unmet `requires` → ranked by evidence → injected into the generation context as named constraints ("use PAS; pre-empt objection via risk-reversal; NO countdown — no attested deadline"). Master-studio's judge scores against the SELECTED techniques, closing generation to the choice.

### 1.3 Why a library beats "the model knows Ogilvy"
The model knows everything and applies it inconsistently. The library makes technique choice (a) **explicit** — traced in `campaign_decisions` like every choice ("נבחר PAS כי קהל מודע-בעיה + אטום כאב E2"), (b) **testable** — a technique is a taggable dimension on artifacts, so verdicts accrue to it, (c) **governable** — deprecating a technique that keeps losing is one row, not a prompt archaeology dig.

---

## 2. JUDGMENT — what knowledge can't give, and how our data builds it

**The honest gap:** knowing WHAT Schwartz said ≠ knowing whether emotional-safety beats price *for this clinic's anxious-adult persona on cold Meta traffic in Holon*. No corpus contains that. Judgment = calibrated priors over YOUR distribution — and that's exactly the machinery we built:

1. **Technique win-rates from verdicts (the creative genome, formalized):** every artifact already carries framework/angle tags; add `technique_ids`. C-01 verdicts then accrue per technique × vertical × awareness × persona → the library's `evidence: OUR-data` field fills itself. Floors apply (no "PAS is winning" off n=2 — `creative-testing-discipline` §3); pooling across clients per vertical via the fleet machinery (k-anonymous, like C-12 benchmarks).
2. **Calibration as the judgment meter (C-03, built):** the system's technique-choice confidence gets Brier-scored per domain. When "angle-technique picks" run overconfident, selection confidence is discounted — the system literally knows how good its judgment is, which no human marketer does (VISION-DEEP §8.2.6).
3. **Episodic precedents (C-02, built):** before selecting, recall "similar situation, what did we choose, what happened" — case-based judgment on top of rule-based selection.
4. **Exploration guarantees learning:** the experiments layer (C-11) reserves explore budget; technique selection uses it deliberately — contested techniques (mid win-rate, wide uncertainty) get tested where cheap, per the info-value math. Judgment compounds because testing is structural, not occasional.
5. **The trajectory, honestly:** month 1 = legends' priors + research citations (decent, generic-ish). Month 6 = per-vertical win-rates at real floors. Month 18 = per-persona × per-technique priors nobody in the Israeli market has, because nobody else runs pre-registered tests at fleet scale. **Judgment is the data moat's second derivative.**

**Hard limits (stated, not hidden):** SMB sample sizes mean vertical-level pooling, not per-client certainty, for a long time · win-rates are correlational unless the arm was a registered test (we mark which) · taste/lateral creative leaps remain human-plus-machine (VISION-DEEP §8.4 — wild-variant slots + owner idea injection, judged fairly) · a technique library can ossify: `status: trial` rotation + the §3 feed are the anti-sclerosis.

---

## 3. CURRENT — staying past the cutoff

**The honest problem:** model knowledge ages; 2026 tactics (AI-answer optimization, CTWA patterns, Advantage+ behavior shifts) move quarterly. Mechanism, not vibes:
1. **Quarterly research sweeps** — the exact process that produced this doc body (parallel web-research agents, cited findings, CONSENSUS-vs-CONTESTED separation) run on a calendar: paid-tactics sweep, organic/GEO sweep, IL-market sweep. Output = library deltas (`evidence: research-2026 + citation`, `status: trial` until our data confirms) + doc updates. Cost: a few agent-hours/quarter.
2. **Competitor watch as a live tactics feed (C-09, built):** veteran ads = market-validated tactics *in this vertical right now*; decoded angles/offer patterns propose library candidates automatically ("3 competitors running price-anchoring carousels ≥8 weeks" → trial entry).
3. **Performance data as the referee:** trial techniques graduate to `active` only on our verdicts (§2.1) — research suggests, the market hints, OUR data decides.
4. **Freshness discipline on the library itself:** every entry carries `last_validated`; entries stale >12 months without wins get flagged for the next sweep — the same freshness honesty we apply to content (`ORGANIC-DEEP-RESEARCH` §4.3).

---

## 4. Build shape (spec-level)
| Wave | What | Rides on |
|---|---|---|
| T1 | Library schema + initial curation (~60–100 entries from the 9 skills + legends + the July-2026 research docs) + `selectTechniques()` pure core | skills, frameworks.ts |
| T2 | Selection wired into generation contexts + technique tags on artifacts + decision-trace rows | master-studio, campaigns |
| T3 | Win-rate accrual from verdicts + calibration hook + library governance UI | C-01/C-03 |
| T4 | Quarterly sweep runbook + C-09 candidate feed + trial/graduation flow | C-09, research process |
**Honest bottom line:** we can encode the legends' *principles* completely, their *judgment* not at all — but we can BUILD judgment faster than any human accumulates it, because ours is pre-registered, calibrated, pooled, and never forgets. The limits that remain (taste, lateral leaps, tiny samples) are managed, not solved.

*Design only — no code.*
