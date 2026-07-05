# ORGANIC-TASKS — single source of truth for the organic track

> **WORKING RULE (binding):** before ANY organic task — read `docs/ORGANIC-MARKETING-SPEC.md` + this file. Work ONLY from this file. Update the Status column immediately on completion. No re-discovering context from the repo.
> Status: `todo` · `doing` · `done` · `blocked-on-X`. Effort: S (<½ day agent) / M (½–1 day) / L (multi-unit).
> **Nothing here is in the build queue until the owner promotes it.** All statuses start `todo` (or `blocked-…`).
> Folder ownership is DISJOINT by design — tasks in different folders can run as parallel agents. Shared-file wire-ins (marked ⚠) are orchestrator-serial.

---

## GATE-0 — Meta App Review (paperwork track — start FIRST, runs in parallel)

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| G0-1 | Business Verification | Owner submits business docs in Meta Business Suite → Security Center | — (OWNER action) | none (external) | S (owner) | NOW | todo |
| G0-2 | Privacy-policy + data-deletion URLs | Two public pages served by the app; set URLs in the Meta app console | — | `app/(public)/privacy/page.tsx`, `app/(public)/data-deletion/page.tsx` | S | NOW | todo |
| G0-3 | App → Live mode + Login-for-Business use case | Console config: switch Live, add the use case, attach permissions | G0-1, G0-2 | none (external) | S (owner) | NOW | todo |
| G0-4 | Review screencast + test instructions | Record the connect→compose→post-to-test-page flow; write reviewer steps + test login | P1-4 (demo flow must work) | `docs/app-review-submission.md` | S | after P1-4 | todo |
| G0-5 | Submit Advanced Access request | `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` (keep 5 paid) | G0-1..G0-4 | none (external) | S | gated on G0-1..4 | todo |
| G0-6 | Re-add organic scopes (revert PR #53) | One-line scope list change + users re-consent via existing connect flow | G0-5 approved | ⚠ `lib/meta-config.ts` | S | blocked-on-app-review | todo |

---

## PILLAR 1 — Facebook page management

| ID | Task | What it does | Depends on | Files/owned | Effort | NOW/gated | Status |
|---|---|---|---|---|---|---|---|
| P1-1 | Scheduling v2 (schema) | Additive mig: `scheduled_posts` + `client_id_v2 → clients`, `campaign_item_id`, photo-vs-link kind; or new `organic_schedule` table (decide in design step) | — | `supabase/migrations/0XX_organic_schedule.sql` | S | NOW | todo |
| P1-2 | Content-calendar generator | Atoms + strategy + IL calendar → 2–4-week plan {date, post_type, topic, angle, grounded_in}; plan recorded as `campaigns(meta_organic)` + per-slot decision rows | — | `lib/organic-calendar/` (new) | M | NOW | todo |
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
