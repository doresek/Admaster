# WEBSITE BUILDER — 0→100, better than Lovable/v0 (research + spec)

> **What this is.** Deep market research (web-verified 2026-07, cited) + the full-lifecycle spec for AdMaster's website offering — Pillar 2 of `docs/ORGANIC-MARKETING-SPEC.md`, upgraded. Companion: `ORGANIC-DEEP-RESEARCH.md` (the SEO/GEO layer every site ships with) · `LANDING-PAGE-MASTERY.md` (the conversion layer).
>
> **The one-line thesis:** the market is saturated at *generation* and empty at *grounding* and *operation*. Every AI builder starts from a prompt and abandons the site at launch. Ours starts from the client's living brain and never stops working on it — the site is a **surface of an ongoing marketing engine**, not a deliverable.

---

## 0. Market research digest (July 2026, full capsules + matrix in research annex §7)

**The three lanes and their leaders:** design-first (Framer, Webflow) · all-in-one SMB (Wix, Squarespace, Durable, 10Web, Hostinger) · code-first full-stack (Lovable, v0, Bolt, Replit, Base44). Lovable is the giant ($400M ARR, 25M+ projects, [TechCrunch](https://techcrunch.com/2026/06/03/lovable-signs-multi-year-deal-with-google-cloud-to-up-usage-5x-source-says/)); v0 has the best-looking output; Wix has the broadest SMB tooling; Durable is the only one even *claiming* post-launch autopilot.

**The eight cross-cutting gaps (each cited in the annex):**
1. **No persistent business brain** — every product is prompt-seeded per session. The only data-grounded generation found is one-shot Google-Business-Profile import (Brizy/Localo class) — a snapshot, not a living profile.
2. **Day-1 tools, day-30 orphans** — the market's own vocabulary: Lovable "gets you 70% of the way" ([Superblocks](https://www.superblocks.com/blog/lovable-dev-review)), Webflow AI "a starting point, not a finished business site" ([appsrow](https://www.appsrow.com/blog/webflow-ai-site-builder-in-2026-what-it-actually-builds-and-where-it-falls-short)). Durable's autopilot claims are reviewed as shallow with visibility complaints.
3. **Generic content** — filler copy everywhere; regulated verticals (health!) get text needing full rewrites.
4. **Structurally weak SEO** — Lovable ships a client-side-rendered empty HTML shell (~9× slower indexing; prerender only for whitelisted bots on their hosting — [prerender.io](https://prerender.io/blog/how-to-make-lovable-websites-seo-friendly/)); **Framer has no JSON-LD schema and no hreflang** ([letaiworkforme](https://letaiworkforme.com/blog/framer-limitations-complete-guide)); Wix ~56 mobile PageSpeed.
5. **Iteration cost creep + quality drift** — Lovable's "credit trap" (fix loops that repeat the same bug, ~$65–75/mo realistic), v0's Feb-2026 usage pricing (cost unknown until it runs) + documented quality regressions, Bolt at Trustpilot 1.4.
6. **Compliance theater** — cookie banners with no consent infrastructure; generic privacy policies; **zero IS 5568 (תקן נגישות) awareness anywhere**; only Wix has an accessibility wizard.
7. **RTL/Hebrew broken in the AI-native lane** — v0 output "does not align with RTL standards"; Lovable's own editor needs a browser extension for Hebrew; only Framer (native RTL, Oct 2025) and Wix Multilingual do RTL properly — and neither generates Israeli-context Hebrew marketing content.
8. **Agency economics unsolved** — Framer $30/site with no volume pricing; Durable has no export/ownership; agencies stitch together builder + SEO tools + legal tools.

**Occupied by no one:** profile-grounded generation + autonomous post-launch loop + Hebrew/RTL-native + IS 5568/consent compliance + flat pricing. That intersection is this spec.

---

## 1. The product: an OPERATED site, generated from the brain

### 1.1 What the client experiences
1. Brief → brain builds (existing flow) → **"בנה לי אתר"** → a complete multi-page Hebrew site (home / services / about / proof / contact / blog + legal pages) generated from THEIR atoms — their real offer, their customers' language (VoC quotes), their objections pre-answered, their photos — in minutes.
2. The site is live on `{client}.admaster.site` immediately; custom domain connectable in one flow.
3. **And then it never goes stale:** the content engine posts to the blog, the freshness engine re-injects new prices/reviews/cases quarterly-or-faster, SEO/GEO monitoring runs in the heartbeat, and the weekly digest reports it — the same one-brain-one-trace loop as everything else.
4. Editing = chat ("תבליט יותר את עניין התשלומים") grounded in the brain + a section-level visual editor. No 70% wall, because edits mutate a structured spec, not generated code (§2.2).

### 1.2 Why this beats Lovable/v0 — the concrete case
| Their weakness (cited §0) | Our answer |
|---|---|
| Prompt-from-zero every time; generic copy | Generation reads `client_insights` + strategy + VoC quote bank — the hero speaks to the unspoken_want, services pre-answer the actual objection atoms, proof is their real reviews. Regenerating next quarter uses the *smarter* brain |
| 70% wall: edits break code, credit-burning fix loops | **No generated code.** The site is a versioned structured spec (design tokens + section schemas + copy) rendered by OUR tested React renderer — the proven landing-pages pattern (`ORGANIC-MARKETING-SPEC` §2.1). Edits are spec mutations: safe, diffable, reversible |
| CSR empty shell / no schema / weak SEO | SSG/ISR multi-page architecture, LocalBusiness JSON-LD (narrowest subtype, Shabbat hours), question-H2 answer-first content, bot allowlist (OAI-SearchBot/PerplexityBot/Claude-SearchBot…), Bing registration, CWV budgets enforced at the renderer level — the FULL `ORGANIC-DEEP-RESEARCH` §3 layer, by default |
| Site abandoned at launch | The heartbeat operates it: blog cadence, ≤13-week freshness cycles with real content deltas, GSC decay detection, review-fed proof updates. **The moat: ~50% of AI citations go to content <13 weeks old — an always-fresh site out-cites hand-maintained competitors permanently** |
| RTL broken / English-first | Hebrew/RTL-native renderer (logical CSS properties, RTL grids, Hebrew typography) — we already render Hebrew LPs in production |
| Compliance theater; zero IS 5568 | Per-client legal pages generated + maintained (§4), incl. הצהרת נגישות and WCAG-2.0-AA-oriented structure — a legal fear converted into a purchase trigger |
| Credit anxiety (Lovable/v0/Bolt) | Flat subscription: "האתר והשיווק שלך רצים" — no per-edit metering |
| Site is an island | The site is wired to the funnel: LPs match ad scent, leads flow to the contact list → WhatsApp retention, analytics feed the same `content_performance`→diagnosis loop as campaigns. **No competitor owns site+SEO+social+paid+retention on one brain** |

**Positioning note:** we don't compete with Lovable/v0 for "build me an app" (their lane, code output). We compete for **"give my business a web presence that works"** — Durable/Wix's lane, executed with Lovable-class generation quality and an operation loop nobody has.

---

## 2. GENERATION — architecture

### 2.1 The site model (extends the landing-pages pattern, mig-numbered at build)
```
sites            id, client_id, owner_user_id, status(draft|published|archived),
                 subdomain unique, custom_domain unique nullable, domain_status,
                 theme jsonb (tokens: palette from brand atoms, type scale, spacing),
                 nav jsonb, seo_defaults jsonb, locale 'he', created/updated
site_pages       id, site_id, client_id, owner_user_id, path unique-per-site,
                 kind (home|service|about|proof|contact|blog_index|blog_post|
                       legal_privacy|legal_terms|legal_accessibility|landing),
                 title, sections jsonb (ordered section specs), seo jsonb
                 (title/meta/JSON-LD block), grounded_in uuid[], version int,
                 status(draft|published), published_at
site_versions    append-only page-spec snapshots (rollback = repoint)
```
- **Sections are typed schemas** (hero, services-grid, proof-wall, FAQ, team/authors, CTA-band, article-body…), each with a section renderer in our component library. The LLM fills schemas; it never emits arbitrary HTML/JS — that single decision eliminates the 70% wall, XSS surface, and design drift at once.
- RLS owner-only; public read for published pages via the same pattern as `landing_pages` public-SELECT.

### 2.2 The generation pipeline (multi-call, like articles — single-shot degrades)
1. **Site plan call**: atoms + strategy → sitemap (which service pages, which city pages per `ORGANIC-DEEP-RESEARCH` §1.2 clusters), nav, theme tokens (from brand_voice atoms; palette/typography presets tuned for IL verticals).
2. **Per-page calls**: each page = one grounded generation (buildAiContext + the page's atom set + the GEO content rules encoded as constraints: answer-first opening, question-H2s, ≥3 information-gain facts, simple Hebrew).
3. **Brand-lint + SEO-lint pass** (C-07 + a new deterministic SEO linter: title lengths, single H1, alt texts, schema completeness, internal links present).
4. **Assembly**: pages + JSON-LD + sitemap.xml + robots.txt (bot allowlist) + legal pages (§4).
5. Every page `grounded_in` + artifact-recorded + decision-traced (spec §4 invariants) — the Command Center sees the whole site build as decisions.

### 2.3 Serving (recommendation, decided at build)
**Multi-tenant serving from our Next app** (like `/lp/[slug]`): a catch-all host-based router resolves `{client}.admaster.site` and custom domains → renders published specs SSG/ISR (revalidate on publish). Custom domains via the **Vercel Domains API** (add domain to project + instruct client's DNS; SSL automatic). Per-client Vercel *projects* are rejected: cost, ops sprawl, and slower iteration — one renderer, one deploy, all sites versioned. Static export to client-owned hosting = later "ownership" tier option.

---

## 3. CONTENT + SEO/GEO — the operated layer
- Blog = the P3 content engine writing INTO `site_pages(kind=blog_post)` — topics from atoms, pillar/cluster internal linking auto-maintained, every article emitting its GBP/FB/WhatsApp derivatives.
- The **freshness engine** (`ORGANIC-DEEP-RESEARCH` §4.3) runs on site pages: refresh queue from GSC decay + positions 5–30, regeneration with real ≥20–30% deltas from NEW atoms (this quarter's reviews/prices/cases), heartbeat-scheduled, digest-reported.
- **E-E-A-T module**: authors/practitioner entities (owner + staff bios with credentials) rendered site-wide, linked to GBP/professional registries.
- Site analytics: pageviews/leads per page → `content_performance` → the same diagnose→improve loop; GA4 "AI Traffic" channel + AI-crawler log monitoring per `ORGANIC-DEEP-RESEARCH` §3.4.

---

## 4. LEGAL PAGES — per-client, generated, maintained (⚠️ attorney-review before real use)
Every generated site ships with the CLIENT's own legal surface (distinct from AdMaster's own policies — both tracks need attorney review):
1. **מדיניות פרטיות** — per-client privacy policy: what the site collects (lead forms, analytics, pixel), processor list (AdMaster, Meta, Google), retention, contact. Parameterized template per חוק הגנת הפרטיות + Amendment 13; GDPR addendum only when the client actually serves EU users.
2. **תנאי שימוש** — parameterized terms.
3. **הצהרת נגישות (IS 5568)** — the research's sharpest legal finding: ת"י 5568 (WCAG 2.0 AA) is mandatory for service-business sites above ~₪100K avg revenue, **liability sits on the site owner, overlays don't satisfy it, and no AI builder addresses it** ([vee.co.il](https://vee.co.il/web-accessibility-5568/), [isoc.org.il](https://www.isoc.org.il/freedom-of-internet/accessibility/all-about-accessibility)). Our renderer is accessibility-oriented by construction (semantic sections, contrast-checked tokens, alt-text enforcement in the SEO-lint) + a generated statement page with the required contents (accessibility coordinator contact, measures taken, known gaps). Marketed as "אתר מוכן לתקן 5568" — with the honest caveat that full conformance is process, not just markup.
4. **Consent that actually works**: lead-form marketing-consent checkbox (spam-law compliant, unchecked by default), privacy-policy link at every form, cookie/consent banner ONLY when non-essential trackers exist — real script-gating, not banner theater ([iubenda critique](https://www.iubenda.com/en/blog/ai-can-build-your-website-cant-manage-consent/)).
5. All four are versioned `site_pages` regenerated when client facts change (new tracker added → policy updates + is dated) — maintenance no competitor does.

---

## 5. EDITING — chat-to-edit without the 70% wall
- **Chat edits**: instruction + current page spec + brain context → spec mutation proposal → diff preview → apply (new version). Grounded: "תוסיף משהו על מבצעים" pulls the actual offer atoms; brand-lint runs on every mutation.
- **Visual editing**: section-level controls (reorder, swap variant, edit text inline, replace image) — spec fields, not free-form design; the theme system keeps every edit on-brand.
- **Versioning**: every publish snapshots to `site_versions`; one-click rollback; the digest reports site changes like any action ("עודכן עמוד השירותים — נוספה תשובה להתנגדות המחיר").
- Autonomy-routed: site edits by the system (freshness engine) are `publish_organic`-class actions — draft_only clients approve via digest.

---

## 6. BUILD ROADMAP (feeds ORGANIC-TASKS as P2 upgrades)
| Stage | What | Builds on | Effort |
|---|---|---|---|
| P2-A | Site model migrations + multi-tenant host router + section component library v1 (10–12 sections, RTL-native, CWV-budgeted) | `/lp` renderer + landing_pages pattern | L |
| P2-B | Generation pipeline (site plan → per-page → lints → assembly) + JSON-LD/robots/sitemap layer (P2-SEO-1) | landing generate route pattern, buildAiContext, C-07 | L |
| P2-C | Legal-pages generator (4 docs, parameterized; attorney-review gate before any real client) | — | M |
| P2-D | Subdomain serving → Vercel Domains API custom-domain flow (add/verify/SSL status UI) | Vercel platform | M |
| P2-E | Chat-to-edit + visual section editor + versions/rollback | landing edit UI pattern | L |
| P2-F | Operated layer: blog wiring (P3), freshness engine on site pages, GSC per-site property, analytics→performance loop, heartbeat + digest wire-ins | heartbeat, content engine | M-L |
**Order:** A→B (a generated site you can see) → D (it's really theirs) → C (it's legal) → E (they can shape it) → F (it's ALIVE — the differentiator; parts land earlier where trivial). Dry-run doctrine throughout; nothing publishes without the autonomy route.

## 7. Risks + open questions
- **Design ceiling vs Framer/v0**: schema-constrained rendering trades some visual wildness for reliability/brand-consistency. Mitigation: invest in the section library's craft (variants per section, strong art direction in theme presets); revisit periodically. This is the right trade for SMB service sites — their bar is "professional and converting," not "award-winning."
- **IS 5568 / legal claims**: never market "compliant," market "מוכן לתקן" + statement + structure; attorney review is a hard gate (both for client-site templates and our own marketing of the feature).
- **Custom-domain support load**: DNS hand-holding is real; the flow must be excellent (detection, instructions per registrar, status polling).
- **Wix/Durable could copy the loop** — but their architecture (generic AI, no brain, no trace) makes the copy skin-deep; our moat is the compounding brain, same as everywhere else.
- Research annex: the full per-product capsules + feature×product matrix live in the research agent report (2026-07-06); key claims cited inline above.

*Research + spec only — no code. Promotion into the build queue happens via ORGANIC-TASKS.md.*
