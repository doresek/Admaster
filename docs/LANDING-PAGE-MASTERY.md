# LANDING PAGE MASTERY — conversion science + the brain-grounded LP engine

> **What this is.** Deep research (web-verified 2026-07, cited) + the full plan to make AdMaster's landing pages best-in-class. The LP is the funnel's highest-leverage square meter: all paid + organic traffic lands there. Companions: `WEBSITE-BUILDER-SPEC.md` (sites), `ORGANIC-DEEP-RESEARCH.md` (SEO/GEO). Existing foundation: the `/lp` stack — `landing_pages` (7 templates, views/conversions counters, leads), grounded AI generation, public renderer, editor, plus already-existing `variants` + `refine` API endpoints.
>
> **Thesis:** an LP that (1) is generated from the client's atoms, (2) continues the exact ad that drove the click, and (3) learns from every conversion into the same brain — is a page no LP tool can produce. The research confirms all three levers are unoccupied (§7).

---

## 1. Conversion science — the numbers that set the rules (all cited)

| Finding | Number | Source |
|---|---|---|
| Median LP conversion (57M conversions) | **6.6%** (3.8–12.3% by industry) — honest benchmark for client expectations | [Unbounce CBR](https://unbounce.com/conversion-benchmark-report/) |
| FB/IG traffic converts well | FB 13%, IG 17.9% (email 19.3%) | [SEJ/Unbounce](https://www.searchenginejournal.com/new-report-reveals-an-8-mobile-landing-page-conversion-gap/557513/) |
| **Simple copy is the strongest measured copy factor** | 5th–7th-grade reading level: 11.1% CVR, **+56%** vs 8th–9th | [Unbounce CBR](https://unbounce.com/conversion-benchmark-report/) |
| Message match (ad↔LP) | **+31.4%** signups from matching the query's verb in the H1 | [ConversionLab](https://conversionlab.no/see-how-dynamic-text-on-a-landing-page-helped-increase-conversions-by-31-4/) |
| …and it cuts media cost | Quality Score 6 vs 4 ≈ **16–25% cheaper CPC**; Meta Conversion-Rate Ranking weighs post-click experience | [Google](https://support.google.com/google-ads/answer/6167118?hl=en), [Meta](https://www.facebook.com/business/help/403110480493160) |
| Above the fold | 57% of viewing time; 84% above/below attention gap | [NN/g](https://www.nngroup.com/articles/scrolling-and-attention/) |
| Single CTA | 13.5% vs 10.5% (5+ CTAs); repeat the SAME goal, never compete | [Flint](https://www.flint.com/blog/landing-page-cta-button-performance-statistics) |
| Forms | each extra field ≈ −4.1% CVR; multi-step 13.85% vs 4.53% for LONG asks; easy questions first, phone last | [WPForms](https://wpforms.com/research-based-tips-to-improve-contact-form-conversions/), [Numinam](https://www.numinam.com/en/blog/multi-step-vs-single-page-forms-which-really-generates-more-leads-complete-guide-2026) |
| Social proof | +34% avg; placement near the CTA (+68% below-CTA case); **video testimonials +80–86% vs written** | [Flint](https://www.tryflint.com/blog/landing-page-social-proof-element-performance-statistics), [Say About Us](https://sayabout.us/blog/the-best-places-to-feature-testimonials-on-landing-pages) |
| Urgency | real timers +8–14%; **>60% of users refresh-test timers** — fake ones create distrust + legal exposure | [Growth Suite](https://www.growthsuite.net/blog/real-urgency-vs-fake-urgency-why-your-countdown-timers-are-not-working) |
| Speed | 0.1s faster mobile ≈ **+8.4%** conversions; 1s vs 3s ≈ +32% | Deloitte/Google via [MigrateLab](https://migratelab.com/resources/page-speed-affects-conversion-rates-research), [Portent](https://portent.com/blog/analytics/research-site-speed-hurting-everyones-revenue.htm) |
| Length | paid traffic +38% on SHORT pages; length = f(awareness, price, risk) | [CXL](https://cxl.com/blog/long-form-or-short-form/) |
| Mobile | 83% of visits, converts 8% worse than desktop — the design target IS the 390px viewport | [SEJ/Unbounce](https://www.searchenginejournal.com/new-report-reveals-an-8-mobile-landing-page-conversion-gap/557513/) |
| IL: calls & WhatsApp | inbound calls convert **10–15×** web forms; CTWA ~3× engagement vs site redirects; ~66% of WA conversations → purchase (vendor data) | [Retreaver](https://retreaver.com/blog/5-reasons-phone-calls-are-more-valuable-than-form-leads), [Waliner](https://waliner.io/click-to-whatsapp-ads-in-israel/) |
| IL: trust | Israelis trust third-party reviews (Google/Zap) most, on-page testimonials LEAST | [ishivuk survey](https://www.ishivuk.co.il/survey/) |

**Framework mapping (encoded, not vibes):** PAS for problem-aware cold traffic (problem hero → agitation → solution+proof→CTA) · AIDA as universal fallback · StoryBrand for service/brand pages · **most-aware = short page: offer, price, deadline, button**. Awareness level selects the template — the same Schwartz discipline as `copywriting-craft` §2.

---

## 2. BRAIN→LP — atoms mapped to sections (the differentiator)

Every section of the generated page is a projection of specific atoms — engineered for THIS audience's psychology, not a template with adjectives:

| LP section | Atom source | Rule |
|---|---|---|
| **H1 + subhead** | the campaign's `angle` atom + the ad's exact promise (§3) | mirror the ad; simple Hebrew (כיתה ה'–ז'); the `unspoken_want` said out loud is the highest-stopping-power H1 when the angle calls for it |
| **Hero media** | `desire`/`aspiration` atoms → the OUTCOME state | show the after, not the clinic hallway |
| **Pain/agitation block** (cold traffic only) | `pain` atoms in VoC verbatim language | quote-bank first — customers' own words |
| **Offer block** | `core_offer` + offer-stack; price honesty per brand | one offer per page, named |
| **Objection strip** | top 2–3 `objection` atoms, pre-answered | the objection PRE-EMPTED before the CTA ("וכן — אפשר לפרוס לתשלומים"); this is the marketing-strategy §3 coverage matrix rendered as UI |
| **Proof wall** | `proof` atoms + **embedded Google reviews** (third-party only — IL trust research) | placed adjacent to the CTA; video testimonial slot when available |
| **CTA (single, repeated)** | objective + IL channel reality | service SMBs: **sticky mobile bar with WhatsApp ("שלח הודעה ב-WhatsApp") + click-to-call**, 44px+ thumb-zone targets |
| **Form** | qualification needs from `sub_audience`/lead-quality atoms | 3–5 fields; multi-step when qualification matters (easy-first, phone-last); consents per §6 |
| **Urgency element** | ONLY from a real, attested deadline (cohort/capacity from offer atoms) | no server-side truth → no timer rendered. Hard rule |
| **FAQ** | `objection` + VoC question quotes | doubles as GEO answer-chunks (`ORGANIC-DEEP-RESEARCH` §3.1) |

**Page length/structure selection:** the campaign's `funnel_stage` + awareness (from the decision engine) select the skeleton — cold Meta traffic → PAS medium page; retargeting/most-aware → short offer-price-CTA page (paid traffic converts +38% on short pages). The 7 existing templates map onto this as awareness-level presets rather than aesthetic choices.

---

## 3. MESSAGE MATCH — the LP generated FROM the ad (the unoccupied lever)

Research verdict: Unbounce DTR is string substitution; Instapage AdMap maps ads→pre-built pages (Google-first); Fibr personalizes existing pages. **Nobody generates the page from the ad creative itself.** We can, because the ad and the LP come from the same decision:

1. **The scent contract:** every paid `campaign_item` already carries its angle, hook, creative text, image, audience, funnel_stage, and `grounded_in`. LP generation takes the campaign item as input and produces a page whose H1 mirrors the hook's promise, whose hero echoes the creative's visual concept, whose body continues the SAME atoms — ad→LP as one continuous argument. (This also directly closes the #1 funnel break the diagnosis skill names: "angle-switch ad→landing".)
2. **Per-ad variants at scale:** a campaign with 3 angle arms gets 3 scent-matched LP variants automatically — each arm lands on ITS page. `utm_content={item_id}` keys attribution.
3. **Two-sided ROI:** +31.4%-class CVR lift AND cheaper traffic (Google QS, Meta Conversion-Rate Ranking weigh post-click experience).
4. **Runner wire-in (build-time):** `runCampaign` optionally requests a matched LP per assembled ad; the item's `link` points at `/lp/{slug}?utm_content={item}`; the whole thing traced as decisions like everything else.

**Scroll-stop → conversion continuity (§4 of the ask):** the hero applies the same "arresting" judgment as creative (master-studio's scroll_stop dimension) — the visitor who stopped for the hook must land on its visual+verbal continuation within 57%-of-attention territory (above the fold, 390px viewport), then hierarchy walks them: promise → proof → objection pre-empt → CTA.

---

## 4. TESTING + LEARNING — bandits, not A/B; verdicts into the brain

**The low-traffic truth (encoded):** classic A/B needs ~8,200 users/variant for a 30%-lift detection at typical rates — ~41 weeks at SMB traffic ([CraftUp](https://craftuplearn.com/blog/ab-testing-low-traffic-sequential-testing-smart-baselines)). So:
1. **Variant strategy:** 2–3 *fundamentally different* pages (angle/offer-framing/awareness skeleton — never button colors), generated as C-01 pre-registered hypotheses with honest floors (`creative-testing-discipline` §3: CVR-grade = 100 clicks/arm; below floor → `inconclusive`, no atom moves).
2. **Bandit routing** (Smart-Traffic-style, ours): deterministic seeded Thompson allocation ALREADY EXISTS (`lib/experiments/allocate.ts`) — route visitors across LP variants from ~50 visits, floors-first. Below viability: iterate, don't test (the planner refuses unresolvable tests — also already built).
3. **Diagnosis on the funnel node:** LP metrics land in `content_performance`; the C-10 funnel object localizes the failing edge (ad→view OK but view→lead broken = page problem; which section = scroll-depth + form-start vs form-complete events). The diagnosis engine's scent-check (ad angle ≠ LP angle) becomes mechanical because both artifacts carry angle tags.
4. **Learning compounds:** verdicts move the SAME atoms (an objection-handling block that lifts CVR corroborates the objection atom; feeds the episodic memory as precedents for the next page — "עמוד עם טיפול בהתנגדות המחיר מעל הטופס ניצח פעמיים").

---

## 5. TECHNICAL — the sub-second, lead-capturing page
- **Speed budget:** static/ISR render, zero client JS beyond form+analytics, image discipline (`ORGANIC-DEEP-RESEARCH` CWV budgets) — target <1s mobile (every 0.1s ≈ ±8%; beats ClickFunnels' measured 5–9s pages by default).
- **Lead flow → retention engine:** form/WhatsApp/call-click → `leads` (existing) → the client's contact list → WhatsApp sequences (T+0 instant acknowledgment — speed-beats-copy SLA from `whatsapp-marketing` §1) → lead-quality marks feed C-13. The LP is the retention engine's intake, not a dead end.
- **Thank-you/next-step page:** sets expectations ("חוזרים אליך תוך X דקות"), offers the WhatsApp jump, carries the conversion pixel event.
- **Analytics:** Meta Pixel + CAPI events (view/lead), scroll-depth + form-start beacons for section-level diagnosis, `utm_content` per ad item, GA4.
- Existing `variants` + `refine` endpoints become the variant-arm + chat-refine surfaces of this engine.

## 6. LEGAL (⚠️ attorney-review before real use)
Per the research (`תיקון 13` in force since Aug 2025 applies to ANY lead form; ספאם 30א requires explicit opt-in for marketing follow-up):
- Every generated form ships: Hebrew privacy-policy link + consent statement · **separate, unchecked marketing-consent checkbox** ("אני מאשר/ת קבלת תוכן שיווקי ב-וואטסאפ/SMS/מייל") — never pre-checked, never bundled · data-minimization defaults (3–5 fields).
- WhatsApp follow-up sequences may only target leads whose marketing consent is recorded; the consent state is stored on the lead row (feeds the retention engine's suppression logic).
- Templates parameterized per client; flagged for attorney review alongside the site legal pack (`WEBSITE-BUILDER-SPEC` §4).

## 7. Where we win (tool benchmark digest)
Unbounce (Trustpilot ~2.0, 120–415% price hikes, RTL via CSS hacks) · Instapage ($79–159/mo, RTL breaks forms, AdMap is Google-first mapping) · Leadpages (no comparable ad-match) · ClickFunnels (5–9s loads) · Framer/Webflow (design tools, no CRO substance) · Fibr (personalizes existing pages, doesn't generate). **None** has: (a) persistent business-brain generation, (b) LP generated from the Meta ad's creative, (c) a closed loop where LP results improve the next page AND the ad targeting. All three are ours structurally, plus native Hebrew/RTL + IL CTAs (WhatsApp/call) + built-in תיקון-13 compliance — zero direct competition in the IL segment.

## 8. Build roadmap (on the existing /lp foundation)
| Stage | What | Builds on | Effort |
|---|---|---|---|
| LP-1 | **Atom→section generation v2**: awareness-selected skeletons, objection strip, VoC quotes, IL CTA bar (WhatsApp/call sticky), Google-review embeds, simple-Hebrew constraint, real-urgency rule | existing generate route + templates | M |
| LP-2 | **Scent engine**: generate-from-campaign-item (hook/creative/angle inputs), per-arm variants, `utm_content` keying, runner wire-in | campaigns runner, existing variants endpoint | M |
| LP-3 | **Consent + speed pass**: the two-consent form block, static/ISR budget, pixel/CAPI + scroll/form beacons, thank-you flow | existing lead route | M |
| LP-4 | **Learning loop**: LP hypotheses (C-01) + bandit routing (C-11 allocateArms) + funnel-edge diagnosis (C-10) + verdicts→atoms; digest reporting | all built capability libs | M-L |
| LP-5 | Lead→retention wiring: consent-aware WhatsApp T+0 ack + sequence enrollment | whatsapp lib (C2-gated live) | S-M |
**Order:** LP-1 → LP-2 (the differentiator) → LP-3 → LP-4 → LP-5. Everything dry-run/traced/autonomy-routed per the standing invariants; LP-2 is the highest-leverage single build in the entire organic track (it improves PAID performance immediately).

*Research + plan only — no code. Promotion via ORGANIC-TASKS.md.*
