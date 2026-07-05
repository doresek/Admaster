# ORGANIC-TASKS — single source of truth for the organic track

> **WORKING RULE (binding):** before ANY organic task — read `docs/ORGANIC-MARKETING-SPEC.md` + this file. Work ONLY from this file. Update the Status column immediately on completion. No re-discovering context from the repo.
> Status: `todo` · `doing` · `done` · `blocked-on-X`. Effort: S (<½ day agent) / M (½–1 day) / L (multi-unit).
> **Nothing here is in the build queue until the owner promotes it.** All statuses start `todo` (or `blocked-…`).
> Folder ownership is DISJOINT by design — tasks in different folders can run as parallel agents. Shared-file wire-ins (marked ⚠) are orchestrator-serial.

---

## GATE-0 — Meta App Review (paperwork track — start FIRST, runs in parallel)

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| G0-1 | Business Verification | Owner submits business docs in Meta Business Suite → Security Center | — (OWNER action) | none (external) | S (owner) | NOW | doing — owner checklist in docs/app-review-submission.md |
| G0-2 | Privacy-policy + data-deletion URLs | Two public pages served by the app; set URLs in the Meta app console | — | `app/(public)/privacy/page.tsx`, `app/(public)/data-deletion/page.tsx` | S | NOW | done — /privacy + /data-deletion live; set the URLs in the Meta console (see docs/app-review-submission.md §2) |
| G0-3 | App → Live mode + Login-for-Business use case | Console config: switch Live, add the use case, attach permissions | G0-1, G0-2 | none (external) | S (owner) | NOW | doing — steps in docs/app-review-submission.md |
| G0-4 | Review screencast + test instructions | Record the connect→compose→post-to-test-page flow; write reviewer steps + test login | P1-4 (demo flow must work) | `docs/app-review-submission.md` | S | after P1-4 | todo |
| G0-5 | Submit Advanced Access request | `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` (keep 5 paid) | G0-1..G0-4 | none (external) | S | gated on G0-1..4 | todo |
| G0-6 | Re-add organic scopes (revert PR #53) | One-line scope list change + users re-consent via existing connect flow | G0-5 approved | ⚠ `lib/meta-config.ts` | S | blocked-on-app-review | todo |

---

## PILLAR 1 — Facebook page management

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| P1-1 | Scheduling v2 (schema) | Additive mig: `scheduled_posts` + `client_id_v2 → clients`, `campaign_item_id`, photo-vs-link kind; or new `organic_schedule` table (decide in design step) | — | `supabase/migrations/0XX_organic_schedule.sql` | S | NOW | done — mig 051 applied+verified on prod (organic_schedule; new table, legacy scheduled_posts untouched) |
| P1-2 | Content-calendar generator | Atoms + strategy + IL calendar → 2–4-week plan {date, post_type, topic, angle, grounded_in}; plan recorded as `campaigns(meta_organic)` + per-slot decision rows | — | `lib/organic-calendar/` (new) | M | NOW | done — lib/organic-calendar (12 tests): deterministic planner, TopicExpander seam (LLM unwired), holiday-PREP lookahead, records campaign+decisions+organic_schedule |
| P1-3 | Organic post generator | Per plan slot → full post + image prompt via master-studio; C-07 lint; artifact + `campaign_items(post, draft/assembled)` | P1-2 | `lib/organic-posts/` (new; thin over `lib/master-studio`) | M | NOW | todo |
| P1-4 | Publishing worker (dry-run) | Item → `routeAndLog('publish_organic')` → `lib/meta-publish` (dryRun) → item status + meta_object_id; Meta-native `scheduled_publish_time` for future slots. **This is the App-Review demo flow.** | P1-1, P1-3 | `lib/organic-publish/` (new), `app/api/organic/publish/route.ts` | M | NOW (dry-run); live = G0-6 | todo |
| P1-5 | Calendar UI = real content calendar | `app/(dashboard)/calendar` shows the client plan; review/edit/approve per autonomy mode; uses `useActiveClient()` | P1-2, P1-3 | `app/(dashboard)/calendar/` | M | NOW | todo |
| P1-6 | Heartbeat weekly wire-in ⚠ | Weekly tick emits the organic plan (≤N posts/week client setting) + digest lists planned posts | P1-2..P1-4 | ⚠ `lib/heartbeat/ticks/weekly.ts`, `lib/digest` | M | NOW | todo |
| P1-7 | Organic performance ingestion | Page-post metrics (`pages_read_engagement` — already granted) → `content_performance` → verdicts → `diagnoses` | P1-4 (posts exist) | `lib/organic-perf/` (new), `app/api/organic/perf/route.ts` | M | NOW (works on any page posts) | todo |
| P1-8 | IG publishing path | IG container+publish via existing `lib/meta-publish/instagram.ts`; per-client IG-business link check in onboarding | P1-4 | `lib/organic-publish/instagram.ts` | S | blocked-on-app-review | todo |

## PILLAR 2 — Website creation

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| P2-1 | Site model (schema) | Additive mig: `sites` + `site_pages` (paths, kinds, content jsonb, seo jsonb, public-SELECT RLS for published) | — | `supabase/migrations/0XX_sites.sql` | S | NOW | todo |
| P2-2 | Site-architecture decider | Brain → which pages/nav/proof a THIS-business site needs; each choice a grounded decision row | P2-1 | `lib/sites/architecture.ts` (new) | M | NOW | todo |
| P2-3 | Site generator | Per-page copy+design via the landing-generate pattern (cached skill block, `buildAiContext`); ONE shared design_spec across pages; artifacts + grounding | P2-2 | `lib/sites/generate.ts`, `app/api/sites/` (new) | L | NOW | todo |
| P2-4 | Public serving + SEO | `app/site/[siteSlug]/[[...path]]` renderer w/ shared nav/footer, per-page meta/OG/JSON-LD, sitemap.xml, robots | P2-1, P2-3 | `app/site/` (new) | M | NOW | todo |
| P2-5 | Site editor | Extend landing-editor pattern to site scope (page list, section edit, regenerate-section) | P2-3, P2-4 | `app/(dashboard)/sites/` (new) | M | NOW | todo |
| P2-6 | Custom domains | Vercel API add-domain + host-header→site middleware + DNS instructions | P2-4; owner buys domain | `lib/sites/domains.ts`, ⚠ `middleware.ts` | M | blocked-on-domains | todo |

## PILLAR 3 — Content engine

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| P3-1 | Article model (schema) | Additive mig: `articles` (outline/body_md/seo/keywords/status lifecycle, grounded_in) | — | `supabase/migrations/0XX_articles.sql` | S | NOW | todo |
| P3-2 | Topic engine | customers-atoms + VoC questions → scored topic backlog (pain × awareness × keyword intent, Hebrew-first); topics = grounded decisions | P3-1 | `lib/articles/topics.ts` (new) | M | NOW | todo |
| P3-3 | Article generator | Outline → per-section → edit-pass multi-call pipeline; brand-lint; FAQ+JSON-LD from objection atoms; internal links | P3-2 | `lib/articles/generate.ts`, `app/api/articles/` (new) | L | NOW | todo |
| P3-4 | Video-script generator | Topic → 30–60s script (hook/beats/CTA), scroll-stop-judged | P3-2 | `lib/articles/video-script.ts` | S | NOW | todo |
| P3-5 | Blog on the client site | Render published articles as `site_pages(kind='article')` + blog index | P2-4, P3-3 | `app/site/` (blog templates) | S | after P2-4 | todo |
| P3-6 | Unified publishing schedule ⚠ | Articles join the P1 calendar (one plan, posts+articles); heartbeat weekly proposes the week's article | P1-2, P3-2 | ⚠ `lib/organic-calendar/` | S | NOW | todo |
| P3-7 | Distribution hooks | On article publish → derived FB post (P1 path) + WhatsApp broadcast (existing `lib/whatsapp`, dry-run) — traced items under the article's campaign | P3-3, P1-4 | `lib/articles/distribute.ts` | M | dry-run NOW; live gated (App Review / InforU) | todo |
| P3-8 | Content performance loop | Article views + derived-post metrics → `content_performance` → topic-level learning feeding P3-2 | P3-5, P1-7 | `lib/articles/perf.ts` | M | NOW | todo |

## CONTENT PIPELINE, RETENTION & LEARNING — HIGH-PRIORITY cluster, next after the current build (owner-directed 2026-07-06)

> **One flow:** create (batch, background, PERSISTED — never lost) → approve (SEE the full ad, feel it) → publish (from approved) → retain (consent-based win-back, respectful multi-channel) → learn (every choice, approval, edit, and result makes the next generation smarter). Full-lifecycle marketer: acquisition + retention + win-back. Takes precedence over remaining P1/P2/P3 once the current cluster lands.
>
> **THE IRON RULE (enforce before dispatching ANY agent on this cluster):** (1) produce an explicit FILE/FOLDER OWNERSHIP MATRIX — every task → exact files/folders, provably DISJOINT; (2) shared files (types, contracts, shared routes) are ORCHESTRATOR-SERIAL, never given to two parallel agents; (3) verify zero overlap and **confirm the matrix to the owner BEFORE dispatch**; (4) scan recent parallel work for collision damage (duplicated logic, half-applied changes) and fix + re-gate first.

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| CP-1 | **Approval page shows the ACTUAL ad** | The trust moment of Mode 2 — the client must SEE the ad, not click a blind checkbox. Today the approve page + `/approvals` show only "מודעה מ-Autopilot" + buttons. Build: (a) full ad render as it will appear — creative image, complete copy (hook/body/CTA), platform-style FB-post preview, audience in plain words, budget if paid; (b) the grounded WHY — one line from the atoms ("המודעה נבנתה סביב [הכאב/הרצון]"); (c) approvals client-scoped (each tied to its client; list filters by active client via `useActiveClient()`); (d) post-approve clear next-step ("המודעה תפורסם ב… / תמתין להפעלה"); (e) approvals LIST shows preview thumbnail + client per item. | CP-4 (items must persist to render) | `app/(dashboard)/approvals/`, public approve route (locate at task start), `app/api/approvals/*` | M | NOW | queued |
| CP-2 | **Publish page offers APPROVED ads** (close the pipeline) | `/publish` starts from scratch, disconnected from what was created+approved. Fix: (a) publish page lists the active client's APPROVED items with preview thumbnails — one click approved→publish/schedule; (b) "create from scratch" demoted to secondary; (c) status flows approved→published visible in command-center lanes; (d) autonomy tie-in: Mode 2 = approved items wait here; Mode 3 = system publishes within caps. | CP-1 | `app/(dashboard)/publish/`, `app/api/publish/*` | M | NOW | queued |
| CP-3 | **Non-blocking + batch creation** | Generation (60-90s best-of-N — KEEP the quality) currently freezes the UI, one post at a time. Fix: (a) background generation — "צור" queues, notification + post appears in the content list when ready, small progress widget; (b) BATCH — "צור לי X פוסטים" generates multiple in parallel (a week's content: different types/angles from the brain) into the list → approval → publish; (c) progressive results as each completes; (d) batch credit cost shown upfront; (e) client-scoped, atom-grounded, all enter the approval flow. | CP-4 (persistence is the foundation) | `app/(dashboard)/create/`, `app/api/ai/master/` (job/queue seam), possibly new `lib/generation-queue/` | L | NOW | queued |
| CP-4 | **CRITICAL: generated work must never vanish** | Observed: generated post (credits spent, 90s) lost on navigation — result lives only in page client-state. Fix: (a) EVERY generated post/ad persisted to DB the moment generation completes (draft/content item tied to the client) — navigation-safe by construction; (b) Create Post shows recent generations on return; (c) persisted items enter the content pipeline (list → approve → publish); (d) audit ALL other generators for the same bug (quick-campaign, images, landing pages) and persist them too; (e) verify: generate → navigate away → return → it's there. NOTE: master route already inserts `generated_content` server-side — the gap is the UI never reads it back; audit what's truly missing vs just unread. | — (FIRST in the cluster) | `app/(dashboard)/create/`, `app/api/ai/master/`, audit-only elsewhere | M | NOW | queued |
| CP-5 | **The learning loop — answer from code, then wire the gaps** | Why doesn't writing improve post-to-post (scores hover ~87)? Deliver: (a) the judge's EXACT criteria as implemented — dimensions, weights (scroll_stop…), final-score computation, what persona-writers receive (paste from `lib/master-studio/judge.ts`/`index.ts`); (b) per learning mechanism, WIRED vs BUILT-BUT-IDLE vs MISSING: episodic memory at generation? judge verdicts → episodes? judge-preference patterns fed forward into writers' prompts? approve/reject → `learning_signals` retrieved next generation? client EDITS → lessons? performance loop ready-but-waiting?; (c) the 87 question: judge calibration (compressed scale) vs real plateau — check actual score distribution (generated_content/artifacts); (d) the honest map ("how the system improves at writing" today, what closes at live, the 1-3 highest-value wiring gaps) — then WIRE those gaps so writing improves post-to-post before live data. | — (analysis parallel; wiring after CP-4) | analysis: read-only; wiring: `lib/master-studio/`, `lib/intelligence/`, `lib/episodic/` seams | L | NOW | queued |
| CP-6 | **Message series = consent-based retention / win-back engine** | The Series feature (סדרת הודעות, multi-channel SMS/WhatsApp/Email up to 180 days) becomes a smart retention engine operating ONLY on the business's OWN opt-in list (end-customers collected WITH consent) — NOT cold acquisition; goal = repeat purchase / win-back / loyalty ("come back / new offer for you", warm tone). Build: (1) client-scoped, targets the client's consented contacts, grounded in the brain (on-brand win-back messaging); (2) **channel orchestration — "don't nag" (critical):** NEVER the same promo to WhatsApp+Email+SMS at once; vary channel per touch, space sends, per-contact frequency caps, intelligent sequencing — less is more; (3) **COMPLIANCE (non-bypassable, Geula-Mode-grade):** opt-out honored on every send, timing windows (no Shabbat/Yom-Tov, sending hours), frequency caps — consent + opt-out + timing enforced structurally; (4) data model: map what exists per client (contacts, consent flag, last-purchase/last-contact, channel prefs) vs what's needed (likely additive `contacts` migration); (5) autonomy + approval tie-in: series proposals via approval (Mode 2) or within caps (Mode 3). | CP-1 (approval surface), design step first | `app/(dashboard)/series/`, new `lib/retention/` (+ additive contacts migration), `lib/whatsapp` reuse | L | NOW (sends dry-run until InforU/creds) | queued |

## RESEARCH-PROMOTED UPGRADE DELTAS (owner-promoted 2026-07-06 — from PR #73, the Perfect-Marketer docs)

> **Binding build-to-spec references for EXISTING tasks** (build them right the first time, not retrofitted):
> - **P3-2 (topic engine)** → build to `docs/ORGANIC-DEEP-RESEARCH.md` §1.1 (atom→query mapping, Hebrew morphological expansion, commercial-intent-first priority rule).
> - **P3-3 (article generator)** → MUST encode `ORGANIC-DEEP-RESEARCH` §3.1 GEO content rules: answer-first 40–150-word openings, question-form H2s, statistics/quotes injection from atoms/VoC, simple-Hebrew constraint, current-year titles, ≥3 information-gain facts per page (the anti-thin-page gate). FAQ as question-H2s (FAQ rich results are dead — content value only).
> - **P2-4 (public serving + SEO)** → MUST ship the §3.2 technical layer: bot allowlist (OAI-SearchBot, ChatGPT-User, PerplexityBot/-User, Claude-SearchBot/-User, Googlebot, Bingbot), SSR/static-only content, LocalBusiness JSON-LD (narrowest subtype incl. Shabbat hours), CWV budgets (LCP<2.5s/INP<200ms/CLS<0.1), sitemap + **Bing Webmaster registration** (ChatGPT leans Bing). Skip llms.txt (evidenced dead).
> - **P2-2/P2-3 (site architecture/generator)** → topic-cluster architecture from the atom graph per §1.2 (pillar service pages ↔ clusters, /service/city with unique local proof) + E-E-A-T authors module; deep-spec stages beyond P2-1..6 live in `docs/WEBSITE-BUILDER-SPEC.md` (legal pack §4, operated layer §3, section library §2) — P2-1..6 remain the correct first waves.

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| P1-GBP-1 | GBP completeness engine | Audit + drive Google Business Profile to 100% fields; narrowest category; Services tab mirroring site service pages; accurate hours incl. Friday/chagim (top-5 pack factor) — manual-assist mode (prepared changes + deep links) until GBP API allowlist | G0-GBP (below) | `lib/gbp/` (new) | M | NOW (manual-assist) | queued |
| P1-GBP-2 | GBP post variant in calendar | P1-2 calendar emits a GBP post per slot (1–2×/wk + photos; active profiles ≈5× views); joins the repurposing outputs | P1-2 | `lib/organic-calendar/` (extend), `lib/gbp/` | S | NOW (manual-assist) | queued |
| P1-GBP-3 | Policy-safe review engine | Steady, un-gated, non-incentivized review requests via the WhatsApp post-purchase flow + owner response drafts ≤48h. HARD policy rules (Feb–Apr 2026 tightening): no incentives, no gating, no scripts, no bursts | CP-6 (contacts/consent), C2 | `lib/gbp/reviews.ts` | M | gated on C2 + CP-6 | queued |
| P1-GBP-4 | NAP/citations sync checklist | Consistent name/address/phone: site schema = GBP = d.co.il/zap/easy/מידרג/Waze — owner-assisted checklist + tracking (citations = entity confidence for AI answers) | — | `lib/gbp/citations.ts` | S | NOW | queued |
| G0-GBP | GBP API allowlisting application | Business Profile API approval (verified GBP 60+ days, use-case review, WEEKS — start the clock) | — (OWNER action) | none (external) | S (owner) | NOW | queued |
| P3-GEO-2 | City×service×year listicle generator | "X מומלצים ב[עיר] 2026" comparison pages w/ unique local proof; listicles appear in 100% of "best-X" AI answers; anti-thin-page gate enforced | P3-3, P2-4 | `lib/articles/listicles.ts` | M | after P3-3 | queued |
| P3-FRESH-1 | Freshness engine | ≤13-week refresh cycles with REAL ≥20–30% content deltas (new prices/reviews/FAQs from atoms); refresh queue from GSC decay + positions 5–30; heartbeat-wired | P3-3, GSC property per client | `lib/articles/freshness.ts`, ⚠ heartbeat wire-in | M | after P3-3 | queued |
| P3-MEASURE-1 | Hebrew GEO prompt panel | 25–100 local-intent Hebrew prompts/client, weekly across ChatGPT/Gemini/Perplexity → mention rate/citations → content_performance rows + diagnosis loop; + GA4 AI-traffic channel + AI-crawler log monitor | P2-4 live pages | `lib/geo-panel/` (new) | M | after P2-4 | queued |

> Full context: `ORGANIC-DEEP-RESEARCH.md` (SEO/GEO/content) · `WEBSITE-BUILDER-SPEC.md` (site deep spec) · `LANDING-PAGE-MASTERY.md` (LP roadmap LP-1..5 — separate track, /lp folder) · `PERFECT-MARKETER-ROADMAP.md` (the unified W0–W8 order). Doctrine additions (binding, join §Standing constraints): information-gain gate · freshness honesty (dateModified only with real deltas) · review-policy compliance (no incentives/gating/scripts/bursts) · citation-KPI split (informational content measured on AI citations, commercial on clicks/leads).

## UI shell

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| U-1 | Sidebar: "שיווק אורגני" section | Calendar / Site / Articles entries; client-aware | any pillar shipping | ⚠ `components/layout/Sidebar.tsx` | S | with first pillar | todo |
| U-2 | Client command-center organic panel | Client page shows the organic plan + site + articles state (CLIENT-UX-PLAN wave) | P1-5 / P2-5 / P3 | `app/(dashboard)/clients/[id]/` | M | after pillars | todo |

---

## Parallelization map (disjoint folders)
- **Agent lane A:** `lib/organic-calendar/` + `lib/organic-posts/` (P1-2, P1-3)
- **Agent lane B:** `lib/organic-publish/` + `lib/organic-perf/` + `app/api/organic/` (P1-4, P1-7)
- **Agent lane C:** `lib/sites/` + `app/site/` + `app/api/sites/` (P2-2..P2-4)
- **Agent lane D:** `lib/articles/` + `app/api/articles/` (P3-2..P3-4)
- **Orchestrator-serial (⚠ shared):** migrations numbering, `lib/meta-config.ts`, `lib/heartbeat/ticks/weekly.ts`, `lib/digest`, `middleware.ts`, `Sidebar.tsx`, `lib/organic-calendar` after P3-6.

## Standing constraints (from CLAUDE.md — repeated because binding)
Money gate untouched · self-campaign PAUSED · dry-run defaults everywhere · additive migrations only (owner sees destructive first) · every artifact grounded + traced · full gate (tsc+tests+build) at integration points · update THIS file's Status column on every completion.
