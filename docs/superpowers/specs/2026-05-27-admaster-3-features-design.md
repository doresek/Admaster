# admaster — 3 Features Design Spec

**Date:** 2026-05-27
**Author:** Claude (Opus 4.7) with Eliran
**Status:** Draft — pending user review before plan generation

## Context

admaster is a Next.js 14 + Supabase + Anthropic Claude + Meta Graph API Hebrew-language AI social media platform for Israeli marketing agencies. The codebase has ~30 dashboard modules, with strong moats in Master Studio (12 marketers × 8 frameworks × Brand DNA × avatar analysis), Landing design intelligence (70K-token skill corpus), and end-to-end Meta integration.

A competitive market survey (4 parallel research streams + targeted Playwright/WebFetch deep-scans of three tools) identified the highest-leverage gaps relative to Anyword, Motion App, Foreplay, MagicBrief, and others. The user approved the following three features for first-wave implementation:

1. **Predictive Performance Score** (Anyword-style, Hebrew-native)
2. **AI Creative Tagging** (Motion-style, with 4 categories × variable sub-tags)
3. **Hebrew Swipe File + Chrome Extension** (Foreplay/MagicBrief-style, Hebrew-first)

The three features are designed to build on each other. The Tagger from (2) is reused by both (1) — to tag the score-emitting copy with hook/theme — and (3) — to tag saved swipe-file ads at ingest. The Score from (1) appears on every generated variant including remixes from (3).

## Decisions & Non-goals

**In scope (this spec):**
- All three features as integrated subsystems
- Hebrew-first UX with English/Arabic locale fallback (existing i18n)
- Reuse of existing credit system, Brand DNA, Master Studio, Supabase RLS
- Chrome Extension MV3, targeting Meta Ad Library + TikTok Creative Center + LinkedIn Ads

**Out of scope (deferred):**
- Fine-tuned Hebrew scoring model (we ship with Claude as the scorer; corpus collection starts now for a future fine-tune)
- Video → scene-breakdown / storyboard (MagicBrief MagicAI) — deferred to phase 2
- Brand profile sync to creator submission aggregation — deferred
- Smart Traffic bandit routing for landing pages — separate spec
- Compound rule engine for Meta ads — separate spec
- White-label client reports — separate spec

**Architectural decisions:**
1. **One tagger, three callers.** A single `/api/ai/tag` endpoint handles all tagging (generated content, scored variants, saved ads). Same taxonomy, same model call. This is the load-bearing decision that keeps the three features coherent.
2. **Score as a separate Claude call from generation.** Don't inline scoring into create/variations generation. Reasons: (a) lets us refresh score on edit without regenerating, (b) lets us re-score historical posts, (c) keeps the scoring prompt small + cacheable.
3. **Embeddings live in pgvector.** Supabase already has the `vector` extension available. Avoid Pinecone/Weaviate.
4. **Chrome Extension uses Supabase Auth via shared session token.** No separate auth flow. Extension reads from a cookie set by an opt-in pairing page in the dashboard.
5. **No new design system.** Build new UI components inside existing Tailwind + lucide-react palette.

## Feature A — Predictive Performance Score

### Goals
- Every generated variant in `create`, `variations`, `refine` gets a 0–100 score within 2 seconds. (`analyze` deferred to Phase 1.5.)
- User sees the score panel (demographics + emotions + extracts + policy flags) on hover/click.
- "Boost" rewrites the lowest-scoring variant and re-scores up to twice; stops on plateau.
- Hebrew copy is scored using Hebrew-specific prompt context (RTL, locale, hag/seasonality flags).
- A "Top 5" mode in `variations` filters and ranks.

### User flow (master studio post creation)
1. User clicks "Generate" with brand, marketer, framework selected.
2. Master Studio returns the post (existing flow, no change to its prompt).
3. Client kicks off `POST /api/ai/score` with `{ copy, channel, audience_segment, brand_id, locale }`.
4. Score panel renders alongside the post: large color-coded number, histogram, emotion chips, extract bullets, policy badges.
5. If score < 70, "✨ Boost" button appears. Click → server re-prompts Claude with score + critique, re-scores, replaces the variant.
6. Up to 2 boost iterations; UI shows a small "Boost 1/2" counter.

### Data model (Supabase migrations)

```sql
-- New
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  source_kind text not null check (source_kind in ('master_post','variation','refine','manual','saved_ad')),
  source_id uuid,                 -- FK varies by source_kind, soft ref
  copy_text text not null,
  channel text not null,          -- 'meta_feed','meta_story','meta_reel','google_search','google_display','email','sms','landing','tiktok'
  audience_segment jsonb,         -- {age_range?, gender?, interests?, custom_label?}
  locale text not null default 'he',
  score int not null check (score between 0 and 100),
  demographics jsonb not null,    -- {age: {...buckets}, gender: {...}}
  emotions text[] not null,       -- ['urgency','social_proof',...]
  extracts jsonb not null,        -- {offerings:[], features:[], pains:[], benefits:[], ctas:[]}
  policy_flags jsonb default '[]',
  predicted_hook text,
  model_version text not null default 'claude-opus-4-7-v1',
  prompt_tokens int,
  output_tokens int,
  boost_iteration int default 0,  -- 0 = original, 1..n = boosted
  created_at timestamptz default now()
);
create index scores_user_brand_created on public.scores(user_id, brand_id, created_at desc);
create index scores_source on public.scores(source_kind, source_id);
alter table public.scores enable row level security;
create policy scores_owner on public.scores for all using (user_id = auth.uid());
```

### API contract

`POST /api/ai/score` — request:
```ts
{
  copy: string;
  channel: 'meta_feed'|'meta_story'|'meta_reel'|'google_search'|'google_display'|'email'|'sms'|'landing'|'tiktok';
  audience_segment?: { age_range?: string; gender?: 'm'|'f'|'all'; interests?: string[]; custom_label?: string };
  brand_id?: string;
  locale?: 'he'|'en'|'ar';      // default he
  source?: { kind: string; id?: string };  // for persistence
  persist?: boolean;             // default true
}
```

Response (typed `ScoreResult`):
```ts
{
  ok: true;
  score_id?: string;
  score: number;                 // 0..100
  band: 'low'|'mid'|'high';      // <40 / 40-69 / 70+
  demographics: {
    age: Record<'18-24'|'25-34'|'35-44'|'45-54'|'55+', number>;  // sums to 1
    gender: { m: number; f: number };
  };
  emotions: string[];            // ordered by salience
  extracts: {
    offerings: string[]; features: string[]; pains: string[];
    benefits: string[]; ctas: string[];
  };
  policy_flags: Array<{ type: string; severity: 'info'|'warn'|'block'; issue: string }>;
  predicted_hook: 'question'|'callout'|'contrarian'|'stat'|'story'|'curiosity'|'urgency'|'social_proof'|'other';
  model_version: string;
}
| { ok: false; error: string; status: number }
```

`POST /api/ai/score/boost` — request `{ copy, prior_score_id }`. Response: same shape as score, plus the new copy text.

### Scoring prompt skeleton (`lib/scoring.ts`)
- System prompt anchors Claude as a "Hebrew-native performance copywriter who has graded 250,000 Israeli ads."
- Includes brand DNA snippet if `brand_id` provided.
- Specifies the JSON schema and forbids markdown.
- Includes a policy rules block per channel (Meta ad policy bullets, Google ads policy bullets — bundled in `lib/policy-rules/{meta,google}.he.ts`).
- Strict temperature 0.2 for stability; uses prompt caching on the system block (Anthropic ephemeral cache).

### UI components
- `<ScoreBadge value={score} band={band} />` — small inline pill.
- `<ScorePanel result={ScoreResult} />` — popover triggered by clicking the badge: histograms, emotion chips, extracts list, policy flags.
- `<BoostButton onClick={...} iteration={0..2} />` — appears when band !== 'high' and iteration < 2.
- `<TopFiveFilter />` — toggle in `variations` page that sorts by score desc and hides past index 4.

### Edge cases
- Empty copy → return `{ok:false, error:'empty', status:400}`.
- Copy >2000 chars → truncate to 2000 for scoring (warn user via response field `truncated:true`).
- Claude returns malformed JSON → retry once with a stricter prompt; on second failure, return `{ok:false, error:'parse', status:502}` and refund any credit (consistent with existing `lib/credits.ts` discriminated-union pattern).
- Policy `block` flag → UI prevents publish + schedule actions (hook into existing publish/schedule code).
- Locale mismatch (copy is Hebrew but locale='en') → detect via simple unicode-range heuristic and use the detected locale.

### Credits
- 1 credit per score (`score`).
- Free for the first 14 days per user as onboarding.
- Boost: 1 credit per iteration (max 2).

## Feature B — AI Creative Tagging

### Goals
- Every generated post and every saved swipe-file ad gets auto-tagged within 30 seconds.
- Existing 90-day history is backfilled on rollout.
- A new `reports/comparative` page lets the user group performance by any tag.
- Users can edit tags per-creative; edits persist and override AI tags.
- Taxonomy lives in code (`lib/tag-taxonomy.ts`) and is versioned; admin can extend in future.

### Taxonomy v1 (Hebrew + English values)

```ts
// lib/tag-taxonomy.ts
export const TAG_TAXONOMY = {
  visual: {
    asset_type: ['ugc','lifestyle','studio','illustrated','meme','screenshot','text_only'],
    visual_format: ['listicle','founder_story','skit','podcast_clip','before_after','tutorial','quote_card','whatsapp_style','reel_native']
  },
  persona: {
    intended_audience: 'free_text'  // extracted by LLM, no closed list
  },
  messaging: {
    messaging_theme: 'free_text',  // also LLM-extracted
    // Keys are stable English slugs; Hebrew display labels live in lib/i18n.ts
    seasonality: ['none','passover','shavuot','rosh_hashana','yom_kippur','sukkot','hanukkah','purim','independence_day','ramadan','black_friday','christmas','back_to_school','end_of_season_sale'],
    offer_type: ['promo','evergreen','always_on','flash_sale','seasonal','launch','lead_magnet']
  },
  hook: {
    hook_tactic: ['question','callout','contrarian','stat','story','curiosity','urgency','social_proof','authority','pain_point','benefit_led','negation']
  }
} as const;
export type TagCategory = keyof typeof TAG_TAXONOMY;
export type Tag = { category: TagCategory; subcategory: string; value: string; confidence: number; source: 'ai'|'user' };
```

### Data model

```sql
create table public.creative_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  creative_id uuid not null,     -- soft FK
  creative_kind text not null check (creative_kind in ('master_post','variation','saved_ad','manual_post','landing_page')),
  category text not null,
  subcategory text not null,
  value text not null,
  confidence numeric(3,2),       -- 0.00..1.00
  source text not null check (source in ('ai','user')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index creative_tags_creative on public.creative_tags(creative_kind, creative_id);
create index creative_tags_user_subcat_value on public.creative_tags(user_id, subcategory, value);
alter table public.creative_tags enable row level security;
create policy creative_tags_owner on public.creative_tags for all using (user_id = auth.uid());
```

### API contract

`POST /api/ai/tag` — request `{ creative_kind, creative_id, copy_text, image_url?, video_transcript? }`. Response:
```ts
{
  ok: true;
  tags: Tag[];           // all categories, all subcategories the model is confident about
  model_version: string;
}
```

`PATCH /api/library/tag` — user edit. Body: `{ creative_kind, creative_id, tag: Tag }`. Server upserts with `source='user'` and that overrides AI for that subcategory.

`GET /api/reports/comparative?group_by=hook_tactic&date_from=...&date_to=...&channel=meta_feed` — aggregates performance metrics (impressions/clicks/conversions from `meta_insights` table + score from `scores` table) grouped by the chosen tag value.

### Tagger prompt skeleton
- System prompt: "You are a creative analyst tagging Hebrew/English/Arabic ad creatives."
- Input: copy + optional image (Claude vision) + optional video transcript.
- Output: strict JSON shape with one entry per known subcategory + free_text fields.
- Closed-list subcategories: model must pick from the list or emit `null`.
- Free-text subcategories: 3-7 word Hebrew phrase preferred.
- Temperature 0.1 for stability.

### Auto-tag hook points
- `lib/master-studio.ts` after successful generation → fire-and-forget call to `/api/ai/tag`.
- `lib/variations.ts` likewise.
- `app/api/library/save-from-extension/route.ts` (new — see Feature C) → after enrichment, call tagger.
- Backfill script `scripts/backfill-tags.ts` — paginates posts in the last 90 days, calls tagger in batches of 10 with throttling.

### UI
- `<TagChips creativeKind creativeId />` — renders tag pills grouped by category; click pencil icon to edit.
- `<TagEditor>` — popover with select inputs for closed-list subcategories, text inputs for free-text.
- New page `app/(dashboard)/reports/comparative/page.tsx`:
  - Filter strip: date range, channel, brand
  - "Group by" dropdown listing all subcategories
  - Bar chart + sortable table; click a bar to drill into the underlying creatives

### Edge cases
- Tagging fails → don't block the user; skip the insert. The absence of rows for a creative_id means "untagged"; no sentinel row needed. UI shows "Tag now" affordance when no tags exist.
- User edits then deletes → cascade keeps `source='user'` until explicitly cleared.
- Backfill collision with new edits → backfill skips creatives that already have ANY user-sourced tag in the same subcategory.

### Credits
- Auto-tag: 0 credits (built into the cost of the upstream action — included in master_post's 4 credits, variation's 8, etc.).
- Saved-ad enrichment: 1 credit per ad (covers transcript + tag + landing screenshot).

## Feature C — Hebrew Swipe File + Chrome Extension

### Goals
- One-click save from Meta Ad Library, TikTok Creative Center, TikTok Top Ads, LinkedIn Ads → admaster Library.
- Saved ads are auto-enriched: media downloaded to storage, Hebrew transcript for video, AI auto-tag (uses Feature B), landing-page screenshot.
- Boards (folders) with public share links.
- Natural-language search across the user's saved ads using embeddings.
- "Remix" button on every saved ad → opens Master Studio with the ad's copy/transcript pre-loaded as a reference brief.

### Data model

```sql
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  parent_board_id uuid references public.boards(id) on delete cascade,  -- nested boards
  share_token text unique,       -- nullable; presence = public
  created_at timestamptz default now()
);
create index boards_user on public.boards(user_id);

create table public.saved_ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('meta_ad_library','tiktok_creative_center','tiktok_top_ads','linkedin_ads','manual_url')),
  source_url text not null,
  advertiser_name text,
  advertiser_handle text,
  copy_text text,
  primary_text text,
  headline text,
  description text,
  cta_label text,
  media_urls jsonb default '[]',         -- [{type:'image|video', url, storage_key}]
  landing_url text,
  landing_screenshot_desktop_url text,
  landing_screenshot_mobile_url text,
  video_transcript text,
  transcript_locale text,
  ad_start_date date,
  ad_status text,                        -- 'running' | 'stopped' | 'unknown'
  embedding vector(1536),                -- pgvector for NL search
  saved_at timestamptz default now(),
  enriched_at timestamptz
);
create index saved_ads_user_saved on public.saved_ads(user_id, saved_at desc);
create index saved_ads_embedding on public.saved_ads using ivfflat (embedding vector_cosine_ops);

create table public.board_items (
  board_id uuid references public.boards(id) on delete cascade,
  saved_ad_id uuid references public.saved_ads(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (board_id, saved_ad_id)
);

alter table public.boards enable row level security;
alter table public.saved_ads enable row level security;
alter table public.board_items enable row level security;
create policy boards_owner on public.boards for all using (user_id = auth.uid());
create policy saved_ads_owner on public.saved_ads for all using (user_id = auth.uid());
create policy board_items_owner on public.board_items for all using (board_id in (select id from public.boards where user_id = auth.uid()));
-- read-only public access via share_token handled by an RPC function with check
```

### Chrome Extension (Manifest V3)

Layout under `browser-extension/`:
```
browser-extension/
  manifest.json
  background.ts        # session pairing + auth token cache
  content-meta.ts      # injects save button on facebook.com/ads/library/*
  content-tiktok.ts    # injects save button on ads.tiktok.com/business/creativecenter/*
  content-linkedin.ts  # injects save button on linkedin.com/ad-library/*
  popup/index.html     # quick board picker after save
  pairing.html         # one-time auth flow target page
  icons/...
```

Manifest:
- `permissions`: `storage`, `activeTab`, `cookies` for `*.admaster.co.il`
- `host_permissions`: `https://www.facebook.com/ads/library/*`, `https://ads.tiktok.com/*`, `https://www.linkedin.com/ad-library/*`, `https://admaster.co.il/*`
- `content_scripts`: per platform
- `web_accessible_resources`: nothing client-facing

Auth flow:
1. User clicks "Connect Browser Extension" in `app/(dashboard)/settings/extension`.
2. Dashboard generates a one-time pairing token (stored in `extension_pairings` table, TTL 5 min).
3. Page opens `chrome-extension://<id>/pairing.html#token=...` in a new tab.
4. Extension exchanges the token for a long-lived Supabase service-scoped JWT via `POST /api/extension/pair`.
5. JWT stored in `chrome.storage.local`; expires after 90 days; extension prompts re-pair.

Save flow:
1. Content script detects ad cards on Meta Ad Library DOM (selectors: `[data-pagelet*="AdLibraryAdLibraryPage"]` etc — versioned in `lib/extension-selectors.ts`).
2. Injects a small "💾 Save" button on each card.
3. On click: extension scrapes copy, advertiser, media URLs, landing URL → POST to `/api/library/save-from-extension`.
4. Server returns `{ ok: true, ad_id }` immediately (synchronous insert into `saved_ads` with `enriched_at = null`).
5. Server queues async enrichment job (see below).
6. Popup pops in extension showing the ad title + "Add to board: [picker]". User picks → POST to `/api/library/board-add`.

### Enrichment pipeline

Triggered after `save-from-extension`. Runs on Vercel Functions (max 300s by default; we set 60s explicit). Steps:

1. Download media from URLs to Supabase Storage bucket `swipe-ads/`.
2. If video: extract audio, send to Whisper (`whisper-large-v3` via Anthropic-hosted route or Replicate fallback). Detect locale; store transcript.
3. Fetch landing page URL with headless Chromium (Vercel `@sparticuz/chromium`); take desktop+mobile screenshots.
4. Build embedding input string: `copy_text + transcript + advertiser + extracted_landing_h1`.
5. Embed with `voyage-3` (1536 dims) via Voyage API → store in `saved_ads.embedding`.
6. Call `/api/ai/tag` with creative_kind=`saved_ad` and the enriched data.
7. Mark `enriched_at = now()`.

If any step fails, log to `enrichment_errors` and let the user see a "Re-enrich" button on the ad detail page.

### Search

`POST /api/library/search` — request `{ query, board_id?, filters? }`. Server:
1. Embed query with same Voyage model.
2. `select * from saved_ads where user_id = $1 and embedding <=> $2 < 0.7 order by embedding <=> $2 limit 50`.
3. Apply filters (advertiser, source, tag values via join to `creative_tags`).
4. Return results with similarity score.

Filter UI: chips for tags (joined from `creative_tags`), advertiser dropdown, source dropdown, date range.

### Remix flow

On every `saved_ad` card a "🎭 Remix" button. Click → `app/(dashboard)/create/page.tsx?remix=<saved_ad_id>`. The create page pre-fills a "Reference brief" panel with:
- Original copy
- Transcript (truncated)
- Detected hook + theme tags
- Empty "What's the same / what's different" textarea

The Master Studio prompt receives an extra block: "User saw this Hebrew ad work. Apply [selected marketer] + [selected framework] + [brand DNA] to produce a new variant that captures the same hook tactic but is authentically the brand's voice." The marketers system is unchanged.

### Edge cases
- Meta Ad Library DOM changes — selectors versioned, content script has version check; on failure shows a notification "extension needs update" linking to release notes.
- Video too long to transcribe — cap at 5 minutes; longer videos transcribe only first 5 min with a flag.
- Landing page behind cookie wall — extension passes user's cookies for the originating tab to the server via the save request; server uses them for the screenshot fetch. (Privacy note: cookies only used at request time, not stored.)
- Same ad saved twice — dedupe by `(user_id, source_url)` upsert, return existing ad_id.

### Credits
- Save: 0 credits (cheap).
- Enrichment: 1 credit per ad (covers transcript + screenshots + embedding + tag).
- Remix into Master Studio: standard 4 credits (existing pricing).

## Cross-cutting concerns

### Internationalization
- All new UI strings flow through existing `lib/i18n.ts` and `lib/i18n-context.tsx`.
- Hebrew is the default; English + Arabic strings added for new keys.
- Score panel histogram chart uses Hebrew month/age labels per locale.

### Performance
- Score endpoint target: p95 < 2s. Use Claude Haiku 4.5 for scoring (it's fast, structured-output-friendly, and the score doesn't need Opus reasoning depth).
- Tag endpoint: p95 < 3s when image attached, < 1.5s text-only. Same model.
- Enrichment pipeline: 60s soft cap, returns ad to user within 5s of save click (enrichment happens async).
- Embedding writes batched in groups of 5 on backfill to stay under rate limits.

### Security
- Chrome Extension JWT scoped to extension-only endpoints (separate JWT audience).
- Extension-only endpoints: `POST /api/extension/pair`, `POST /api/library/save-from-extension`, `POST /api/library/board-add`.
- Rate-limit extension save: 60/min per user (`lib/rate-limit.ts`).
- All new tables RLS-enforced (`user_id = auth.uid()`); public share via `share_token` uses an explicit RPC.
- Whisper API key + Voyage API key + Chromium fetch — all server-side env vars.

### Telemetry
- New events to existing telemetry: `score_generated`, `score_boosted`, `tag_applied`, `tag_edited_by_user`, `saved_ad_created`, `saved_ad_enriched`, `library_searched`, `remix_started`.
- Daily Supabase materialized view aggregates for the comparative reports page (refresh hourly).

### Testing
- Unit: `lib/scoring.ts`, `lib/tag-taxonomy.ts`, `lib/policy-rules/*.ts`, extension selector matchers.
- Integration: `POST /api/ai/score` (mocked Claude), `POST /api/library/save-from-extension` (mocked Meta DOM JSON fixtures).
- E2E (Playwright): score panel renders + boost loop in `variations`; comparative report group-by; extension save → ad appears in library (extension-side tested with Playwright in headed mode against a local fixture page mimicking Meta Ad Library DOM).
- Manual: real Meta Ad Library save flow once per release; iOS Safari LP screenshots (out of scope for v1).

## Phasing

The three features are independent enough to ship incrementally. Recommended order:

**Phase 1 — Performance Score (1.5–2 weeks)**
Highest user-visible value, smallest surface area, no external dependencies. Lands on `create`, `variations`, `refine`. (`analyze` integration deferred to Phase 1.5 once its backend solidifies — it's currently PARTIAL.)

**Phase 2 — AI Creative Tagging (1–1.5 weeks)**
Shares the same Claude wiring as Phase 1; reuses prompt-caching infrastructure. Lands on `library`, `history`, new `reports/comparative`. Backfill runs once at rollout.

**Phase 3 — Hebrew Swipe File + Chrome Extension (3–4 weeks)**
Biggest surface area. Subphases:
- 3a: server endpoints + DB tables + manual URL-paste UI (no extension yet) — 1 week
- 3b: Chrome Extension MV3 with Meta Ad Library only — 1.5 weeks
- 3c: TikTok + LinkedIn + Remix flow — 1 week

Total: ~6–7 weeks of focused work for all three.

## Risks

- **DOM scraping fragility (extension)** — Meta updates Ad Library markup quarterly. Mitigation: selectors versioned, soft-fail with user-visible "extension needs update" notification, weekly synthetic check job that opens Ad Library and confirms selectors resolve.
- **Hebrew Whisper accuracy on ad voice-overs** — Background music, accents, slang. Mitigation: ship with `whisper-large-v3`; allow user transcript edit; flag low-confidence transcripts.
- **Score gameability** — Users may write to the scorer rather than to humans. Mitigation: don't expose raw policy weights; phrase tips as feedback, not as a checklist; emphasize "predicted not guaranteed."
- **Tag taxonomy drift** — Free-text fields will collect 1000 unique values within a quarter. Mitigation: clustering job that proposes merges to an admin queue (deferred to phase 4).
- **Cost of Claude calls** — Scoring + tagging happens on every generation. Rough math: 4 credits/master_post + 1 credit/score + 0 tag = 5 credits. Existing pricing covers this with margin given prompt caching ~30-50% hit rate.

## Open questions for the user before plan generation

1. Embedding provider: Voyage AI (recommended for Hebrew) vs OpenAI text-embedding-3 vs Cohere multilingual? Default: Voyage `voyage-3`.
2. Whisper hosting: Anthropic doesn't host Whisper. Options: Replicate, AssemblyAI (good Hebrew), Deepgram, Groq. Default: Deepgram (best Hebrew, lowest latency).
3. Extension distribution: Chrome Web Store from day one (1-week review) vs unpacked-load for closed beta with first 5 agencies? Default: unpacked beta first, Web Store after Phase 3c.
4. Score model: Haiku 4.5 (fast, cheap) vs Sonnet 4.6 (better calibration). Default: Haiku 4.5 with Sonnet fallback if quality complaints.
5. Comparative report: ship with hard-coded Meta-only metrics in Phase 2 vs wait for a metric-source abstraction (TikTok/Google later)? Default: Meta-only, abstraction in Phase 4.

