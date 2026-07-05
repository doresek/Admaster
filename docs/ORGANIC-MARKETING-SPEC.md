# ORGANIC-MARKETING-SPEC — the full organic marketer

> **Vision:** the system is the business's COMPLETE organic marketer, not just paid — it runs the Facebook page, builds and maintains a professional website, and feeds an ongoing content engine (articles/blog/video scripts) — all driven by the client's living brain (atoms), all recorded in the ONE decision trace paid already uses. **Organic + paid = one marketer, one brain, one trace.**
>
> **Status:** PLAN. Nothing in this doc is in the build queue until the owner promotes tasks from `docs/ORGANIC-TASKS.md`.
> **Working rule:** before ANY organic task — read this spec + `docs/ORGANIC-TASKS.md`, work only from the task file, update its status on completion. No re-discovering context.
> Inventory basis: read-only codebase audit 2026-07-05 (post-S5: Next 15 / React 19). File references verified at that commit.

---

## 0. The unifying architecture — one marketer, one brain, one trace

Everything organic plugs into machinery that ALREADY exists:

| Layer | Existing asset | How organic uses it |
|---|---|---|
| **Brain** | `client_insights` atoms (mig 028) — layers `business/customers/bridge`; customers kinds `pain, desire, aspiration, dream, unspoken_want, objection, awareness, persona` (`lib/intelligence/types.ts:105-109`); VoC quote bank (`lib/voc`) | Topics, angles, hooks, and article subjects are SEEDED from customer pains/questions/objections. Every organic artifact is `grounded_in` atom ids. |
| **Grounding** | `buildAiContext()` (`lib/ai-context.ts`) — client identity + strategy + brief as a system-prompt block | Every organic generator (posts, articles, site copy) prepends it, same as create/quick-campaign/landing. |
| **Trace** | mig 030: `campaigns` (`channel` check already includes **`meta_organic`**), `campaign_items` (`item_type` includes **`post`**), `campaign_decisions`, `content_performance`, `diagnoses` | An organic post/series = a `campaigns(channel='meta_organic')` row + `post` items + grounded decisions. Performance verdicts + `diagnoseFailure` then work on organic exactly like paid. Quick-campaign already writes this trace (PR #64). |
| **Autonomy** | `lib/autonomy/policy.ts` — action kind **`publish_organic` already exists** and routes as no-money → `execute` in `propose_approve`/`act_within_caps`, `propose` in `draft_only`; rate-limited `MAX_ACTIONS_PER_DAY=20` | Organic publishing is a "free action": auto-executes at the default mode, still audited + rate-capped + grounded-or-blocked. Money gate untouched. |
| **Heartbeat** | `lib/heartbeat` daily/weekly/monthly ticks (tested engine; crons NOT wired — owner's flip) | The weekly tick is the natural producer of the weekly organic posting plan (today it emits only `create_paid_paused`; `publish_organic` is routed but never emitted). |
| **Generation** | `lib/master-studio` (strategist→creators→judge→editor, scroll_stop-weighted), quick-campaign one-shot, landing generate (design-spec pipeline w/ cached skill context) | Post generation reuses master-studio as-is; long-form needs a new article schema + section prompts but the same pipeline shape and grounding. |

**Doctrine carried over:** dry-run/PAUSED by default · every action grounded + rationaled (Hebrew) · additive migrations only · autonomy modes decide who clicks · `runtime='nodejs'; maxDuration=300` on long LLM routes.

---

## 1. PILLAR 1 — Facebook Page management

**Goal:** the system fills and runs the client's Facebook page — regular organic posts from the brain (tips, stories, offers, engagement posts), a content calendar, a posting cadence.

### 1.1 What already exists
- **`lib/meta-publish/`** — complete, typed, dry-run-first Graph client. `publishPagePost` (`/feed`: text+link), `publishPagePhoto` (`/photos`: url+caption), IG two-step (`createMediaContainer` + `publishMedia`). `dryRun` defaults `true`; live mode sends the token in a Bearer header only. **No live caller exists** — it is tested infrastructure waiting for scopes + a worker.
- **`app/api/schedule/route.ts` + `scheduled_posts` (mig 002)** — a real scheduling route using **Meta-native scheduling** (`published:false` + `scheduled_publish_time`). Known debts: FK → legacy `meta_clients` (not v2 `clients`); `imageUrl` is sent as `link` (link-post, not a photo post).
- **Calendar/series UI** — `app/(dashboard)/calendar` (holiday generator), `message_series` (drip primitive). No generator that produces an N-post plan from strategy.
- **Heartbeat + autonomy** — `publish_organic` routing exists (§0); no tick emits it yet.
- **Token plumbing** — `getDecryptedMetaToken` (`lib/meta`), health check verifies granted scopes via `debug_token` (`lib/meta-health.ts:193-216`).

### 1.2 What's blocked and on what — **THE APP REVIEW GATE**
Organic publishing needs scopes that were reverted (PR #49 → #53): **`pages_manage_posts`**, and for IG **`instagram_basic` + `instagram_content_publish`**. Facebook rejects them as *Invalid Scopes* until the app passes Meta App Review. Evidence: `lib/meta-config.ts:23-35` (current 5 paid/read scopes + the revert comment).

**App Review submission checklist (START THIS CLOCK NOW — it runs in parallel to all building):**
1. **Business Verification** (Meta Business Suite → Security Center): legal business docs (company registration / עוסק docs), domain/email verification. *Days→weeks; the long pole.*
2. **App to Live mode** (dev mode caps everything to app-role users) + required URLs set: **privacy policy URL** + **data-deletion instructions URL** (both must be live pages; we can serve them from the marketing site).
3. **Add the "Facebook Login for Business" use case** in the app console and attach the requested permissions to it.
4. **Request Advanced Access** for: `pages_manage_posts`, `pages_read_engagement` (already have), `instagram_basic`, `instagram_content_publish` (+ keep the 5 existing paid scopes).
5. **Per-permission usage justification + screencast**: a recorded demo showing the real product flow — connect a Page → system composes a post → post appears on the Page. *Implication:* the demo flow must WORK against a test page before submission → build the dry-run→test-page path first (tasks P1-1..P1-4 are review-prerequisites, not just features).
6. **Test instructions for the reviewer**: a test login + a connected test Page, steps to trigger a post.
7. After approval: re-add the 3 scopes to `META_OAUTH_SCOPES` (revert of PR #53 — one-line change, `lib/meta-config.ts`), users re-consent via the existing connect flow.

**Timeline reality (verified 2026-07, Meta docs + practitioner reports):** Advanced-Access review for `instagram_content_publish`-class permissions runs **2–6 weeks, with multiple submission rounds likely**; Business Verification is mandatory for ALL Advanced Access requests. This is the longest external clock in the whole organic track — which is why G0-1..G0-3 (owner actions) start immediately, in parallel to all building.

*(IG publishing additionally requires the IG account to be Business/Creator and linked to the FB Page — a per-client onboarding step, not an app gate.)*

### 1.3 What to build (→ tasks P1-x in ORGANIC-TASKS.md)
1. **Content-calendar generator** (`lib/organic-calendar/`): atoms + strategy + Israeli calendar → a 2–4-week posting plan: per slot {date, post_type (tip/story/offer/engagement/holiday), topic (from `pain`/`objection`/`desire` atoms), angle, grounded_in}. Deterministic planner + LLM topic expansion; plan itself recorded as a `campaigns(channel='meta_organic')` row ("סדרת תוכן שבועית") with one decision row per slot choice.
2. **Organic post generator** (thin layer over master-studio): per slot → full post + image prompt, linted (C-07), artifact-recorded, item row `status='draft'|'assembled'`.
3. **Scheduling v2**: modernize `scheduled_posts` (additive mig: `client_id_v2 uuid REFERENCES clients`, `campaign_item_id uuid`) or new `organic_schedule` table; fix photo-vs-link posting; wire to Meta-native `scheduled_publish_time` (no cron needed for delivery — Meta holds the queue).
4. **Publishing worker** (`lib/organic-publish/`): item → autonomy `routeAndLog('publish_organic')` → `lib/meta-publish` (dryRun until scopes) → item `status='published'` + `meta_object_id`. Zero money; still rate-capped + audited.
5. **Heartbeat weekly wire-in**: weekly tick also emits the organic plan (≤N posts/week per client setting) alongside its ≤1 paid dry-run campaign; digest lists the week's planned posts for the `draft_only` approval lane.
6. **Organic performance ingestion**: page-post metrics (reach/reactions/comments/shares via `pages_read_engagement` — already granted) → `content_performance` rows → verdicts → `diagnoses`. This closes the organic learning loop and feeds calibration.
7. **UI**: the calendar page becomes the client's real content calendar (plan review/edit/approve per autonomy mode).

**Effort:** M-L overall; every piece buildable NOW in dry-run; only the final "live post appears on the page" is App-Review-gated.

---

## 2. PILLAR 2 — Professional website creation

**Goal:** the system builds the client a professional, mobile-ready website generated from the brain (brand, offer, audience) — hosted, domain-mapped, editable.

### 2.1 What already exists (strong foundation)
- **Landing-page builder** — the closest asset, and it's good:
  - `landing_pages` table (mig 004, repointed to v2 clients in 029): slug-unique, 7 templates (`squeeze|local_service|vsl|launch|application|webinar|custom`), `content jsonb`, status, views/conversions, leads table, public-SELECT RLS for published pages.
  - **AI generation** (`app/api/landing/generate/route.ts`): one Claude call producing a full design spec + Hebrew copy JSON, grounded via `buildAiContext`, with a ~65K-token design-skill system block under `cache_control: ephemeral`, optional Ideogram bg image, credit-gated, artifact-recorded with grounding ids.
  - **Serving**: `/lp/[slug]` public renderer (7 hero variants, lead form, sanitized embeds, RTL Hebrew).
  - **Editing**: `app/(dashboard)/landing-pages` list + `edit/[id]` editor. URL sanitization (`lib/safe-url`) at persist time.
- **Anthropic pipeline pattern**: generate a STRUCTURED design+copy spec rendered by our own React renderer (not raw HTML) — safer, editable, consistent. This is the pattern to extend, not replace.

### 2.2 What's missing
- **Multi-page model**: no site→pages relationship, no nav, no cross-page consistency (one brand system across home/about/services/contact/blog).
- **Custom domains / per-client deploy**: nothing touches the Vercel API; everything serves from the app's own domain at `/lp/[slug]`.
- **SEO plumbing**: no per-page metadata generation, sitemap.xml, robots, OG images, JSON-LD.

### 2.3 What to build (→ tasks P2-x)
1. **Site model** (additive mig): `sites` (client_id, slug, domain?, design_spec jsonb, nav jsonb, status) + `site_pages` (site_id, path, kind `home|about|services|contact|blog_index|article|custom`, content jsonb, seo jsonb, status). The existing `landing_pages` stays as-is (campaign LPs ≠ the site).
2. **Site generator** (`lib/sites/`): one orchestrated flow — brain → site architecture decision (which pages, what nav, what proof) → per-page copy+design generation (reuse the landing generate pattern + cached skill block) → one coherent `design_spec` shared by all pages. Every page artifact-recorded + grounded; the site build itself is a traced decision set.
3. **Serving**: public route `app/site/[siteSlug]/[[...path]]` rendering `site_pages` with shared nav/footer + per-page SEO meta + sitemap. Mobile-first; same renderer-component philosophy as `/lp/[slug]`.
4. **Editor**: extend the landing editor to site scope (page list, per-section edit, regenerate-section via refine pattern).
5. **Custom domains** (gated on domain ownership): Vercel API — add domain to the project, per-domain routing (host-header → site lookup middleware), DNS instructions to the owner. Phase 2; until then every site is live at `admaster…/site/{slug}`.
6. **SEO layer**: per-page `seo jsonb` (title/description/OG/JSON-LD) generated with the copy; `sitemap.xml`/`robots.txt` per site.

**Effort:** L overall. §1–4 buildable NOW (no external gate). §5 gated on domains (small once needed).

---

## 3. PILLAR 3 — Content engine (SEO / articles / blog / video scripts)

**Goal:** an ongoing content machine: articles, blog posts, video scripts — topics from customer pains/questions (atoms + VoC), SEO keywords, a publishing schedule, and distribution (FB page, WhatsApp, later more).

### 3.1 What already exists
- **Topic fuel**: the customers layer (`pain, desire, objection, unspoken_want, awareness, persona`) + VoC quote bank (real customer language, anti-fabrication-gated) — exactly what seeds article topics and H2s. `client_strategy` gives pillars.
- **Generation machinery**: master-studio's multi-stage pipeline shape + `buildAiContext` grounding + C-07 brand-lint + artifact recording. All reusable; the missing piece is a long-form article schema (H1/sections/FAQ/meta) and section-aware prompts.
- **Distribution**: `lib/whatsapp` (`sendWhatsApp`, InforU adapter, dry-run default, grounded rows) + `message_series` (drip) + Pillar-1 page posting.
- **NO existing SEO/article/blog code**: the public `/blog` is a hardcoded 4-post marketing page for AdMaster itself. Greenfield — but the env has SEO skills (`hebrew-seo-geo-toolkit`, `programmatic-seo`) to inform prompts.

### 3.2 What to build (→ tasks P3-x)
1. **Article model** (additive mig): `articles` (client_id, site_id?, slug, title, outline jsonb, body_md, seo jsonb, keywords text[], status `idea|outline|draft|review|published`, grounded_in, published_at). Rendered as `site_pages(kind='article')` when a Pillar-2 site exists; exportable as text otherwise.
2. **Topic engine** (`lib/articles/topics.ts`): atoms + VoC questions → scored topic backlog (which pain, which awareness stage, which keyword intent). Hebrew-first SEO: query phrasing from VoC quotes; each topic is a grounded decision row.
3. **Article generator** (`lib/articles/generate.ts`): outline → sections → assembly pipeline (long-form needs multi-call: outline call, per-section calls, edit pass; single-shot degrades quality + hits token limits). Brand-lint pass; FAQ + JSON-LD from objection atoms; internal links to the client's site pages.
4. **Video-script generator**: same topics → 30–60s script format (hook/beats/CTA) — reuses master-studio's scroll-stop judging dimension.
5. **Publishing schedule**: articles join the Pillar-1 calendar (one plan, both kinds); heartbeat weekly proposes the week's article; monthly reviews topic-backlog health.
6. **Distribution hooks**: on publish → derived FB post (Pillar 1) + WhatsApp broadcast to opted-in list (existing send path) — each a traced item under the article's campaign.
7. **Performance loop**: article views (site analytics) + derived-post metrics → `content_performance` → topic-level learning ("what does this audience actually read"), feeding back into the topic engine.

**Effort:** M-L. Everything buildable NOW (distribution to FB gated with Pillar 1; WhatsApp live-send gated on InforU creds C2 — dry-run until then).

---

## 4. Integration invariants (apply to every organic task)
1. **One trace:** every organic deliverable (post plan, post, site build, article) writes `campaigns`/`campaign_items`/`campaign_decisions` rows with `grounded_in` + Hebrew rationale. No side-channel content that the Command Center can't see.
2. **Autonomy-routed actions:** any outward action (post now, schedule, publish article) goes through `routeAndLog` — `publish_organic` for no-money actions. `draft_only` clients get proposals in the digest.
3. **Dry-run default:** `lib/meta-publish` stays `dryRun:true` until scopes land AND the owner flips live per client. WhatsApp stays mock until InforU creds.
4. **Money gate untouched:** organic never touches budgets/adsets. The 5 paid gates stay as-is. Self-campaign stays PAUSED.
5. **Client context:** all organic UI reads `useActiveClient()` (no pickers), all APIs accept `client_id` with cookie fallback.
6. **Additive migrations only**, numbered after the current max; prod-apply + verify per the house rule.

## 5. Effort + gating summary

| Pillar | Buildable NOW (dry-run) | Externally gated | Overall effort |
|---|---|---|---|
| 1 — FB page | calendar generator, post generator, scheduling v2, worker (dry-run), heartbeat wire-in, perf ingestion (read scopes exist) | **live posting → Meta App Review** (checklist §1.2, start now) | **M-L** |
| 2 — Website | site model, generator, serving, editor, SEO layer | custom domains (owner buys/points DNS) | **L** |
| 3 — Content | topic engine, article/video generators, schedule, perf loop | FB distribution (=Pillar-1 gate), WhatsApp live (InforU C2) | **M-L** |

**Recommended build order** (dependency-driven): P1-scheduling-v2 + P1-calendar → P1-generator+worker (dry-run, becomes the App-Review demo) ∥ App-Review paperwork ∥ P3-topic-engine → P3-articles → P2-site-model → P2-generator+serving → domains last.
