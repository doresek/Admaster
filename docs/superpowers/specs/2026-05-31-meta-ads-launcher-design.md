# Design: Meta Ads Launcher — Phase 1

_Status: approved design, pre-implementation. Date: 2026-05-31._

## Context

AdMaster Pro lets marketers generate ad copy (Master Studio + 12 marketers + 8 frameworks), generate images (the new best-of-N pipeline), get client sign-off (`approvals` flow), and it already has a partial Meta integration: encrypted per-client tokens, page/ad-account selection, a generic Graph API proxy (`/api/meta`), campaign + ad-set creation, direct page publishing, pixel creation, and account-level analytics.

But the loop is broken in the middle: the campaign wizard **stops at the ad-set** and sends the user to Meta Ads Manager to attach a creative and create the actual ad. Nothing turns a client-approved creative into a live (or paused) Facebook ad from inside AdMaster, and there is no AI targeting and no AI analysis of results.

The goal: **run the entire paid-ads loop from inside AdMaster**. The user described the flow precisely:

> Pick an **ad that passed client approval** → choose **budget + targeting** (with an **AI auto-targeting** option) → the app **builds the ad in Facebook and shows a real preview** → user **approves and it's uploaded via AdMaster** (as a paused ad) → later the app **pulls performance data, analyzes it, and gives AI recommendations**.

This is split into two phases. **Phase 1 (this spec)** is the launcher: approved-ad → targeting → preview → launch (PAUSED). **Phase 2** (separate spec) is tracking + AI recommendations.

### Decisions locked with the user
- Source of the creative = **client-approved ads** (`approvals.status = 'approved'`).
- Campaigns launch **PAUSED** for review; a one-click "Activate" is offered after launch.
- **Manual token** stays (no Facebook Login / OAuth in this phase).
- **AI auto-targeting** is offered as a suggestion the user can edit; manual targeting also available.
- Preview uses Meta's **real** `/generatepreviews` render.
- Destination is chosen per-launch (the "תשאול"): **landing page we built / external URL / WhatsApp / lead form**.

## Goals / Non-goals

**Goals (Phase 1)**
- Turn a client-approved creative into a complete, PAUSED Meta ad (campaign → ad set → creative → ad) without leaving AdMaster.
- AI-suggested targeting + budget the user can edit.
- A real Meta ad preview shown before anything is created.
- A record of every launched ad linking Meta IDs ↔ our DB.

**Non-goals (Phase 1)**
- OAuth / Facebook Login (manual token only).
- Performance tracking + AI recommendations (Phase 2).
- Pixel injection into landing pages (separate sub-project C).
- A/B multi-ad-set campaigns, custom audiences, lookalikes (targeting v1 = age/geo/interests/gender).
- Lead-form _creation_ (we let the user pick an existing form id; creating forms is later).

## Existing assets reused (do NOT rebuild)
- `lib/meta.ts` → `getDecryptedMetaToken(supabase, clientId, userId)`.
- `app/api/meta/route.ts` → generic authenticated Graph proxy (`{clientId, path, body}`).
- `meta_clients` → `selected_page_id`, `selected_ad_account_id`, `pages[]`, `ad_accounts[]`, `campaigns_created`.
- `approvals` table → `content {text, image_url, channel?, framework?}`, `status`, `client_id`. Query: approved ads = `approvals WHERE user_id=$ AND status='approved'`.
- `lib/ai-context.ts` → `buildAiContext` (brand/client/brief) for AI targeting + headline/CTA suggestions.
- `app/api/ai/route.ts` Anthropic pattern (`CLAUDE_MODEL`, brand context injection).
- `lib/active-client.ts` → active client resolution.

## Architecture

Thin HTTP routes over two focused server modules; one new table; one new UI flow.

### Module: `lib/meta-ads.ts` (server-only — the Graph ad chain)
All calls go through Graph API using the decrypted client token. Functions:
- `uploadAdImage(token, adAccountId, imageUrl) → { imageHash }` — fetch the (public Supabase) image, base64, `POST /act_{id}/adimages`, return hash. Cache nothing.
- `buildObjectStorySpec({ pageId, headline, primaryText, description?, destination, imageHash }) → spec` — builds `object_story_spec`, branching by `destination.type`:
  - `landing_page` / `external_url`: `link_data { message, name(headline), description, link, image_hash, call_to_action {type, value:{link}} }`.
  - `whatsapp`: `link_data` with `call_to_action.type = 'WHATSAPP_MESSAGE'` (requires the page's WhatsApp; preflight-checked).
  - `lead_form`: `link_data.call_to_action.type='SIGN_UP'` + `lead_gen_form_id`.
- `generatePreview(token, adAccountId, spec, adFormat) → { previewHtml }` — `POST /act_{id}/generatepreviews` (`creative={object_story_spec}`, `ad_format` e.g. `DESKTOP_FEED_STANDARD`/`MOBILE_FEED_STANDARD`); returns the iframe HTML body.
- `launchFullCampaign(token, adAccountId, { campaign, adSet, creativeSpec }) → { campaignId, adSetId, creativeId, adId }` — sequential: `campaigns` (objective, `status:'PAUSED'`, `special_ad_categories:[]`) → `adsets` (budget, billing_event, optimization_goal, targeting, `status:'PAUSED'`) → `adcreatives` (creativeSpec) → `ads` (`adset_id`, `creative:{creative_id}`, `status:'PAUSED'`). On any step failure: **best-effort rollback** — delete the created campaign (cascades ad set/ad) so no orphan PAUSED objects linger. Throws a structured error `{ step, metaError }`.
- `setAdStatus(token, adAccountId, campaignId, status)` — flip `PAUSED`↔`ACTIVE` (the "Activate" button).

### Module: `lib/meta-targeting.ts` (server-only — AI targeting)
- `suggestTargeting(supabase, { userId, clientId, approvedAd }) → TargetingSuggestion` — `buildAiContext` + the approved ad text → Claude returns a **valid Meta targeting spec** plus a budget suggestion and rationale. Interests are returned as `{ name }`; we resolve names → Meta interest IDs via `GET /act_{id}/targetingsearch?q=` (or the Targeting Search Graph endpoint) and drop unresolved ones. Output:
  ```ts
  interface TargetingSuggestion {
    ageMin: number; ageMax: number;
    genders: ('male'|'female'|'all');
    geo: { countries: string[]; cities?: string[] };   // default ['IL']
    interests: { id?: string; name: string }[];        // ids resolved server-side
    dailyBudget: number;                                // suggested, in account currency minor units
    rationale: string;                                  // one paragraph Hebrew
  }
  ```
- `toMetaTargetingSpec(suggestion) → metaSpec` — converts the editable suggestion into the exact `targeting` object Meta expects (`age_min/max`, `genders:[1|2]`, `geo_locations`, `interests:[{id}]`).

### Destination → objective + CTA map (auto-selected, user-overridable)
| destination.type | objective | link source | default CTA |
|---|---|---|---|
| `landing_page` | OUTCOME_TRAFFIC | `${APP_URL}/lp/{slug}` | LEARN_MORE / SIGN_UP |
| `external_url` | OUTCOME_TRAFFIC | user URL | LEARN_MORE |
| `whatsapp` | OUTCOME_ENGAGEMENT | wa link / page WA | WHATSAPP_MESSAGE |
| `lead_form` | OUTCOME_LEADS | `lead_gen_form_id` | SIGN_UP |

### API routes (thin)
- `POST /api/meta/targeting` — `{ clientId, approvalId }` → `suggestTargeting`. Credit: `ai_targeting` (2). Refund on failure.
- `POST /api/meta/preview` — `{ clientId, approvalId, headline, primaryText, cta, destination, targeting }` → upload image + build spec + `generatePreview`. Returns `{ previewHtml, resolvedTargeting }`. No credit (cheap, idempotent-ish).
- `POST /api/meta/launch` — same payload + confirmed targeting/budget → preflight token-scope check → `launchFullCampaign` (PAUSED) → insert `launched_ads` row, increment `meta_clients.campaigns_created`. Credit: `campaign` (15, existing). Full failure → refund + 502 `{error, refunded}`. Returns `{ campaignId, adId, adsManagerUrl, status:'PAUSED' }`.
- `POST /api/meta/ad-status` — `{ clientId, launchedAdId, status }` → `setAdStatus`. No credit.

### Data model: migration `011_launched_ads.sql`
```sql
create table public.launched_ads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  client_id       uuid references public.meta_clients(id) on delete set null,
  approval_id     uuid references public.approvals(id) on delete set null,
  ad_account_id   text not null,
  campaign_id     text,
  adset_id        text,
  creative_id     text,
  ad_id           text,
  destination     jsonb,          -- {type, value, slug?}
  targeting       jsonb,          -- the resolved Meta targeting spec
  budget          int,            -- daily budget, account minor units
  headline        text,
  primary_text    text,
  cta             text,
  image_url       text,
  status          text default 'PAUSED',  -- PAUSED | ACTIVE | failed
  created_at      timestamptz default now()
);
create index idx_launched_ads_user on public.launched_ads(user_id);
alter table public.launched_ads enable row level security;
create policy "launched_ads_own" on public.launched_ads using (auth.uid()=user_id) with check (auth.uid()=user_id);
```
(Phase 2 reads this table to fetch insights by `ad_id`/`campaign_id`.)

### Types (`types/index.ts`)
Add `'ai_targeting'` to `CreditAction` (+ `CREDIT_COSTS.ai_targeting = 2`). `campaign` (15) covers launch. Add interfaces: `Destination`, `TargetingSuggestion`, `LaunchedAd`.

### UI: `app/(dashboard)/ads-launcher/page.tsx` (new screen)
A focused 4-step flow (own screen — closest to the "do it all from one place" vision; reuses the Graph proxy, not the old wizard):
1. **בחר מודעה מאושרת** — list `approvals` (status=approved) for the active client; card shows `content.text` + `content.image_url`. Pick one.
2. **יעד + טרגוט + תקציב** — destination selector (the תשאול) → auto-sets objective; **"🤖 הצע טרגוט עם AI"** fills age/geo/interests/gender + budget (editable); headline + CTA pre-filled from approved text, AI-suggested, editable.
3. **תצוגה מקדימה** — calls `/api/meta/preview`, renders the returned Meta iframe (desktop + mobile toggle). User edits & re-previews freely.
4. **השקה** — `/api/meta/launch` → PAUSED. Success panel: preview thumbnail, Ads Manager deep link, **"הפעל עכשיו"** button (→ `/api/meta/ad-status`).

Plus **"🚀 השק כקמפיין"** entry buttons on the `approvals` page (and later /create, /images) that deep-link into the launcher with the approval preselected.

## Data flow (happy path)
approved ad → (AI targeting suggest) → user edits budget/targeting/headline/CTA → preview (image uploaded to Meta, spec built, iframe rendered) → user approves → launch (campaign+adset+creative+ad, PAUSED) → `launched_ads` row + Ads Manager link → optional Activate.

## Error handling
- **Token scopes**: preflight `GET /me/permissions`; if `ads_management`/`pages_manage_ads` missing → clear Hebrew error pointing to reconnect, before any spend/credit.
- **Partial Meta failure**: `launchFullCampaign` rolls back the campaign on a mid-chain failure; route refunds the credit and surfaces `{step, metaError}` in Hebrew.
- **Image upload failure / inaccessible URL**: surfaced at preview step (before launch), no credit spent.
- **Interest resolution**: unresolved interest names are dropped (logged), never block launch.
- **Idempotency**: `/api/meta/launch` honors an `Idempotency-Key` header (reuse the images-route pattern) to avoid double-spend on double-click.

## Testing
- **Unit**: `buildObjectStorySpec` for all 4 destinations → valid spec shape; `toMetaTargetingSpec` mapping (genders, interests→{id}, geo); destination→objective map.
- **Targeting**: `suggestTargeting` returns schema-valid output for a sample brief (mock/stub Claude or live behind env).
- **Integration (live, PAUSED so no spend)**: against a real test ad account — `launchFullCampaign` creates campaign+adset+creative+ad all PAUSED; assert IDs returned and visible via `GET /act_{id}/ads`. Then `setAdStatus`→ACTIVE→PAUSED toggles. Tear down (delete campaign) after.
- **Preview**: `/api/meta/preview` returns non-empty `previewHtml` for a sample approved ad.
- **E2E (Playwright)**: log in → /ads-launcher → pick approved ad → AI targeting → preview renders iframe → launch → success panel shows Ads Manager link; assert a `launched_ads` row exists.
- **Project rule**: `npm run type-check` + `npm run build` before any push.

## Phase 2 (preview only — separate spec)
Extend `/api/analytics` to fetch per-`ad_id`/`campaign_id` insights from `launched_ads`; add `lib/ad-insights-ai.ts` (`analyzeAdPerformance` → Claude → action recommendations: scale / pause / change creative / adjust targeting), surfaced on the launched-ad screen and merged into the existing recommendations UI. New action `ad_insights` (~2 credits).

## Open risks
- Click-to-WhatsApp ads require the page to have WhatsApp connected; if absent, that destination is disabled with an explanatory message.
- `generatepreviews` ad_format must match placement; v1 uses standard feed formats only.
- Meta API version is pinned in the existing proxy — confirm it supports Outcome-based objectives (ODAX); the campaign wizard already uses `OUTCOME_*`, so this is consistent.
