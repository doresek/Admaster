# MARKET INTELLIGENCE — the outward eye (research + spec)

> **What this is.** Design spec (no code) for the Market Intelligence layer — the honest gap it closes: the system reads the BUSINESS and the CUSTOMER (inward) deeply, but barely reads the MARKET (outward). A master marketer lives on market-reading. Research basis: a dedicated data-source accessibility sweep (web-verified 2026-07, cited) — what's technically AND legally reachable for Israeli SMBs. Part of the Perfect-Marketer body: `PERFECT-MARKETER-ROADMAP.md` · `BRAIN-DEEPENING-SPEC.md` (market atoms enter the same brain with the same evidence grades/temporality) · `MARKETING-TECHNIQUE-SYSTEM.md` §3 (this layer IS its current-tactics feed).
>
> **The prime directive:** every front below must CHANGE DECISIONS — an intel item that can't move an atom, a plan, or a budget is a report, and we don't build reports. Mechanically: market findings land as atoms/signals (with evidence grades, mostly E2–E3; `temporality: ephemeral/seasonal` where apt) and as strategic flags the weekly planner consumes.

---

## 0. The two structural facts (set expectations)
1. **Meta's official Ad Library API does NOT return Israeli commercial ads** — political/issue only for IL; the all-ads API is EU/UK-only under DSA Art. 39 ([Meta docs](https://developers.facebook.com/docs/graph-api/reference/ads_archive/), [DSA Art. 39](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_39.html)). The web UI shows ALL active IL ads; post-*Meta v. Bright Data* (N.D. Cal. 2024, Meta dropped the suit), **logged-off scraping of public data does not breach Meta's ToS** ([Farella](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/)) — third-party processors (Apify actors, ~$1–3.40/1K ads, 99.8% success) are the sanctioned-by-caselaw route.
2. **No pricing feed exists for local services** — anywhere. Manual-assisted extraction is the honest design (§4), not a temporary hack.

**Legal guardrails (architecture-level):** logged-off public collection only, via third-party processors (SerpApi-class vendors carry indemnity); never scrape logged-in; never resell raw data; strip reviewer PII at ingestion (חוק הגנת הפרטיות תיקון 13, in force 8/2025); revisit Meta API scope annually.

---

## 1. FRONT 1 — COMPETITOR INTEL (extends C-09, which is BUILT)
**Have:** `lib/competitor-watch` — entities, longevity method (56d veteran = market-validated), angle-coverage map, manual-paste fetcher, audited atom emission. Its `LiveAdLibraryFetcher` stub is exactly what this front fills.
**Source & method:** per-client list of 3–10 IL competitor pages → **daily Apify Ad Library actor pull** (creative, start date, active/inactive, platforms; no spend for non-political) → the existing C-09 pipeline (upsert → decode → map → atoms). ~$5–20/client/mo. **Highest signal-per-shekel in the stack.**
**Feeds decisions:** new competitor offer detected → counter-creative proposal in the weekly plan · ad crossing 60d → decode as validated tactic → `technique_library` trial candidate (`TECHNIQUE-SYSTEM` §3.2) · open-lane/saturated flags already steer angle selection (C-09 built) · offers/prices seen in ads → `alternative` atom `structured.offer` updates (grade E3, temporality ephemeral).
**Status: buildable NOW** (fetcher adapter + scheduling; everything downstream exists).

## 2. FRONT 2 — DEMAND & TRENDS
**Sources (research-verified):**
- **Google Ads Keyword Planner API — the backbone, free**: `GenerateKeywordIdeas` returns Hebrew keyword volumes + monthly trends, geo=IL, via the client ad accounts we already manage; needs an MCC developer token + **Basic Access application (start now)**; accounts with real spend get exact (non-bucketed) volumes ([docs](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas)).
- **Google Trends**: official API is alpha, application-gated (~public 2027) — **apply now** (our use case fits their stated priority profile); pytrends is dead (archived 4/2025); bridge = SerpApi/Bright Data Trends endpoints ($25–75/mo) for rising-query detection geo=IL ([Google](https://developers.google.com/search/apis/trends), [SerpApi](https://serpapi.com/google-trends-api)).
- **DataForSEO** (~$0.0006–0.002/query) when volumes are needed without touching client accounts.
- **Meta reach estimates** (Marketing API, own accounts, free) for market-sizing snapshots — but don't architect around interest granularity (detailed targeting retired 1/2026).
**Feeds decisions:** seasonality atoms get DATA (search-volume curves replace brief guesses — evidence grade E3 vs E1, per `BRAIN-DEEPENING` U2) · rising queries → topic-engine inputs (`ORGANIC-DEEP-RESEARCH` §1.1 gains a live demand rank) · demand troughs/peaks → budget-shaping proposals in the weekly plan (`israeli-market-timing` §5 with numbers) · keyword-gap vs competitors → content calendar priorities.
**Status: buildable NOW** (Keyword Planner + bridge Trends); official Trends API gated (apply).

## 3. FRONT 3 — WHAT'S WORKING IN THIS INDUSTRY THIS MONTH
**The honest mechanics:** "current live tactics" has no API. It's triangulated from: (a) **C-09 veteran ads across the client's vertical** (what competitors keep paying for = works), (b) **our own fleet's verdicts** (C-12 benchmarks + technique win-rates — the only real-time IL-SMB source in existence; the Varos co-op model, ours by architecture), (c) **annual benchmark tables** (WordStream/LocaliQ per-industry CPC/CTR/CVR — free, US-skewed, ingest as cold-start priors, re-scrape yearly), (d) **quarterly research sweeps** (`TECHNIQUE-SYSTEM` §3.1 — the process that produced these docs, on a calendar).
**Feeds decisions:** all four converge into the technique library's `evidence` field + vertical priors for C-10 funnel expected-rates and C-11 unit-cost assumptions — i.e., "what works now" literally reprices the planner's math.
**Status:** (a)(c)(d) NOW · (b) grows with fleet (k-anonymous cells ≥5 clients, per C-12 governance).

## 4. FRONT 4 — MARKET PRICING (manual-assisted BY DESIGN)
**Reality:** local services rarely publish prices ("צרו קשר להצעת מחיר"); no feed exists. Scraping public pricing pages is low-risk (hiQ line + business, non-personal data).
**Method — the confirm-loop:** automated fetch of competitor pricing pages + GBP attributes + **review price-mentions** ("שילמתי 350₪", "יקר אבל שווה") → LLM extraction with confidence → below-threshold items become one-tap owner confirmations ("המתחרה גובה בערך ₪350?") → confirmed prices land as `alternative` atom `structured.pricing` (grade E1-owner/E2-review, `temporality: ephemeral`, re-verified quarterly).
**Feeds decisions:** the client's price position (premium/parity/cheap) becomes a strategy input — offer engineering (`marketing-strategy` §3 price-anchor component), price-transparency angle detection (competitor-analysis §5: universal price-hiding = our trust lane), and the §2.7 owner advisory ("השוק זז; המחיר שלך כבר לא פרמיום").
**Status: buildable NOW** as designed — the manual-assist IS the design; no vendor does better.

## 5. FRONT 5 — SENTIMENT & EVENTS (C-04 synergy)
**Sources:**
- **Own-client reviews**: GBP Business Profile API (free, full streams, managed locations; **allowlisting takes weeks — start now**).
- **Competitor reviews**: Outscraper/SerpApi Maps (~$0.003–0.015/record, monthly pulls, PII stripped) → the existing VoC pipeline (C-08) with `source: competitor_reviews`.
- **Hebrew sentiment**: solved + free — DictaBERT-sentiment/HeBERT open models, or the LLM calls we already make.
- **IL events**: one news API (NewsData.io/mediastack, country=il, free–$100/mo) + the Israeli calendar we already encode → market-event flags (security situation, regulation, chagim commerce waves).
**Feeds decisions:** event flags join **C-04 shock annotations** (a news-explained CPM spike stops being a mystery AND stops weakening atoms) and the national-mood protocol trigger (`israeli-market-timing` §3) · review-sentiment deltas on competitors → positioning opportunities (their 2–3★ themes = our open wounds list, already specced in competitor-analysis §4 — this front automates the corpus supply) · own-review dips → owner alerts + service-recovery flows (retention engine).
**Status: buildable NOW** (news API + scrapers + models); GBP API gated on allowlisting (weeks).

---

## 6. Architecture notes (spec-level)
- **One ingestion doctrine:** every front lands through existing machinery — C-08 VoC (review corpora), C-09 (ads), atoms with U2 evidence grades + U6 temporality, `learning_signals` where lifecycle applies. Market intel gets NO parallel store; the brain is the store (plus thin source-cache tables for dedup/cost control, additive migrations at build).
- **Cadence & cost:** daily (competitor ads) · weekly (trends/rising queries, prompt panel from `ORGANIC-DEEP-RESEARCH` §3.4) · monthly (reviews, pricing re-verify) · quarterly (sweeps, benchmark refresh). Total external data cost ≈ **$100–300/mo across the fleet** at design scale.
- **Heartbeat-native:** collection jobs are heartbeat/cron work; findings surface as weekly-plan inputs and digest lines ("מתחרה השיק הצעת 199₪ — מוצע קאונטר"), never as a dashboard graveyard.
- **Gated register (start clocks now):** Google Ads API Basic Access · Google Trends alpha application · GBP Business Profile API allowlisting · (permanently closed: TikTok Commercial Content API, DSA Art. 40 — researcher-only).

## 7. Build order
| Wave | What | Gate |
|---|---|---|
| M1 | C-09 live fetcher via Apify + daily scheduling + counter-creative flags | none — highest leverage |
| M2 | Keyword Planner demand backbone + Trends bridge → seasonality/topic feeds | Basic Access application |
| M3 | Review-intelligence pipeline (own via GBP API, competitors via Outscraper) → C-08 | GBP allowlist (weeks) |
| M4 | IL event layer → C-04 annotations + mood protocol | none — trivially cheap |
| M5 | Pricing confirm-loop + price-position advisory | none |
| M6 | Fleet benchmarks (C-12) + technique-library win-rate feed | fleet ≥10 |

*Research + spec only — no code. The inward brain reads the business; this layer gives it eyes on the street.*
