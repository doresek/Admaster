# AutoAds — Meta (Facebook) Connection Flow

> Reverse-engineered from the **live** AutoAds app (`auto-ads.io`, Hebrew UI) on
> 2026-06-09, read-only. Goal: replicate the connect UX in our own app.
>
> **Method:** logged-in browser session, observe + screenshot + read DOM only.
> No Facebook login/consent was completed, nothing was connected/disconnected,
> and no app data was modified. The OAuth flow was followed only up to the point
> where Facebook's own login/consent screen appears, then stopped.
>
> Screenshots referenced below live in `docs/autoads-meta-flow-assets/`.

## TL;DR — the OAuth permissions AutoAds requests

Clicking **"חבר חשבון פייסבוק"** (Connect Facebook account) on a client's home
page kicks off a standard Meta **Authorization-Code** OAuth flow
(Facebook Business Login) with these scopes:

| Scope | What it grants |
|-------|----------------|
| `ads_management` | Create/edit/read ads, ad sets, campaigns; manage ad accounts (and pixels) |
| `ads_read` | Read ad accounts, campaigns, and **insights/performance** data |
| `pages_show_list` | List the Pages the user manages (Page picker) |
| `pages_read_engagement` | Read Page content/engagement metadata |
| `business_management` | Access Business Manager assets (businesses, ad accounts, pixels) |

- **Flow type:** `response_type=code` (server-side Authorization Code exchange)
- **Graph API version:** `v21.0`
- **Login type:** `is_business_login=1` (Facebook **Business** Login dialog)
- **No** `instagram_*`, `pages_manage_posts`, or explicit pixel scope is requested
  — pixel access rides on `ads_management` + `business_management`.

---

## 1. Entry points — where Meta/Facebook connect appears

There are **two** places, both **per-client**. There is **no global / account-level
Meta connection** anywhere (see Settings audit below).

### 1a. Per-client home page — the primary connect action
`/he/client-home?client=<clientId>`

A dedicated card titled **"חיבור Meta Ads"** with a green **"חדש"** (New) badge:

- **Card heading:** `חיבור Meta Ads` + badge `חדש`
- **Subtitle:** `חבר את חשבון הפייסבוק של הלקוח` ("Connect the client's Facebook account")
- **Button (primary, blue, with FB icon):** `חבר חשבון פייסבוק` ("Connect Facebook account")

Screenshot: `03-meta-connect-card.png` (card), `02-client-home-full.png` (in context).

### 1b. Per-client home page — setup checklist ("הקמה:")
At the top of the same client-home page, a 3-step **setup progress strip** labeled
**"הקמה:"** ("Setup:"):

1. `בריף` (Brief)
2. **`חיבור פייסבוק`** (Facebook connection) ← reflects Meta connection status
3. `מודעה ראשונה` (First ad)

So the Facebook connection is also surfaced as a setup milestone, not just a card.

### 1c. Dashboard client cards — status only (not an action)
`/he/dashboard`

Every client card shows a small **status pill** reflecting Meta connection state.
For all 8 current clients this reads **`לא מחובר`** ("Not connected"). The dashboard
pill is a **status indicator only** — the actual connect action lives on the
client-home page (1a). Screenshot: `01-dashboard.png`.

### 1d. Settings — NO Meta connection (audited)
`/he/settings` has tabs: **פרופיל** (Profile), **ארגון** (Organization),
**צוות** (Team), **תוכנית שותפים** (Affiliate), **תבניות** (Templates).
None contain any Meta/Facebook connection. Organization tab only has org
name + logo; Profile only personal details + password. Screenshot: `05-settings-tabs.png`.

**Takeaway for our app:** Meta is connected **per client**, not once per
agency/account. Each client carries its own Meta connection + status.

---

## 2. The connect click — captured Facebook authorize URL

From the `מנחם אוחיון` client home, clicking **`חבר חשבון פייסבוק`** performed a
**full-page redirect** (same tab, no popup) to Facebook. Because the automation
browser was not logged into Facebook, it landed on Facebook's `login.php`
interstitial that wraps the real OAuth dialog in its `next=` param.
**Stopped here — no credentials entered, no consent given.**
Screenshot: `04-facebook-oauth-stop.png`.

### The actual OAuth dialog URL (decoded from `next=`)

```
https://www.facebook.com/v21.0/dialog/oauth
  ?client_id=1239768361023231
  &redirect_uri=https://jrhaywbfykjsjywanjsy.supabase.co/functions/v1/meta-oauth?action=callback
  &scope=ads_management,ads_read,pages_read_engagement,pages_show_list,business_management
  &state=<signed JWT, see below>
  &response_type=code
  &ret=login
  &fbapp_pres=0
  &tp=unspecified
```

### Key parameters called out

| Param | Value |
|-------|-------|
| `client_id` (Meta App ID) | **`1239768361023231`** |
| `redirect_uri` | **`https://jrhaywbfykjsjywanjsy.supabase.co/functions/v1/meta-oauth?action=callback`** |
| `scope` | **`ads_management,ads_read,pages_read_engagement,pages_show_list,business_management`** |
| `response_type` | **`code`** (Authorization Code grant) |
| Graph version | `v21.0` |
| `is_business_login` | `1` (Business Login dialog) |
| `display` | `page` · `locale` = `he_IL` |

### Architecture revealed by the redirect_uri

- The OAuth **callback is a Supabase Edge Function**: project ref
  `jrhaywbfykjsjywanjsy`, function **`meta-oauth`**, dispatched by an
  `action` query param (`action=callback` for the return leg; the initiating
  leg almost certainly uses the same function with a different `action`).
- This is AutoAds's own Supabase project (distinct from ours,
  `racywcnflunsdyxbmlms`). The token exchange (code → access token) happens
  **server-side in the edge function**, so the Meta App Secret never touches the
  browser. Good pattern to mirror.

### The `state` param (CSRF + context carrier)

`state` is a **signed JWT** (HS256-style `header.payload.signature`). Decoded payload:

```json
{
  "userId": "478e1bac-d9ab-4406-862a-6dbd0c1973a8",
  "clientId": "dca0d0d3-004c-43f3-83fb-d0db0ba2b923",
  "organizationId": "0d621f7d-ff20-4529-8c9f-7fe739b095ba",
  "returnTo": "https://auto-ads.io/he/client-home",
  "iat": 1781036824,
  "nonce": "fb0b3fe0-9a65-4a7b-a95a-e11cf2cb6ff8"
}
```

So `state` simultaneously: (a) ties the callback back to the **user + client +
organization**, (b) carries **`returnTo`** so the edge function can redirect the
browser back to the right client-home page after token exchange, and
(c) provides **CSRF protection** via `nonce` + signature + `iat` timestamp.

The `cancel_url` (user-denies path) points back to the same callback with
`error=access_denied&error_reason=user_denied&...&state=<same JWT>`, so denials
are handled by the same edge function.

**Replication note:** this is a clean, well-formed pattern — signed `state`
encoding `{userId, clientId, organizationId, returnTo, nonce, iat}`, callback in
an edge function, per-client granularity. Worth copying near-verbatim.

---

## 3. Connected-account UI

**None of the 8 clients currently has Meta connected** — every dashboard card and
client-home setup strip shows **`לא מחובר` / unconnected**. Therefore the
*connected* state (status display, ad-account selector, Page/pixel selection,
displayed insights) **could not be observed live** without actually completing a
Facebook consent, which was explicitly out of scope.

What we can state:
- In the **unconnected** state, the client-home shows the single
  "חיבור Meta Ads → חבר חשבון פייסבוק" CTA card (Section 1a).
- The dashboard pill renders **`לא מחובר`** per client.
- Quick-actions **`נהל מודעות`** (Manage ads) and **`ביצועים`** (Performance)
  exist on the client-home (Section 5) and are presumably the surfaces that
  light up once connected — but they were not exercised.

> To document the connected UI later: connect ONE throwaway client through real
> Facebook consent, then screenshot the post-connect client-home card +
> the `נהל מודעות` / `ביצועים` screens.

## 4. Post-connect config (ad account / Page / pixel pickers)

Not observable live (no connected client). **Inferred from the requested scopes:**

- `pages_show_list` ⇒ expect a **Facebook Page picker** after consent.
- `ads_read` + `ads_management` + `business_management` ⇒ expect an
  **ad-account selector** (and, since the same scopes cover pixels, likely a
  **pixel selector**) drawn from the user's Business Manager.
- `ads_read` ⇒ enables pulling **insights/performance** (the "ביצועים" surface).

The pricing page corroborates this is the intended post-connect feature set:
Pro plan lists "**יצירת קמפיין והעלאת מודעות ישירות ל-META**" and
"**ניתוח מודעות מנצחות ב-META ויצירת וריאציות**", both tagged **בקרוב** (Coming soon).

---

## 5. Client-home page layout (for our client-management parity)

URL: `/he/client-home?client=<clientId>`. Top-to-bottom order:

1. **Breadcrumb:** `דשבורד › <client name>`.
2. **Client header:** avatar (initials) + **name** (H1) + **company/sub-line**
   (e.g. `mg trips`).
3. **Setup strip — "הקמה:"** → `בריף` · `חיבור פייסבוק` · `מודעה ראשונה`
   (3 milestone chips with status icons).
4. **Stat counters (clickable):** `N טיוטות` (drafts) · `N מאושרות` (approved) ·
   `N פורסמו` (published).
5. **"פעולות מהירות" (Quick Actions)** — grid of 10 buttons, in order:
   `צור מודעה` (Create ad), `צור תמונה` (Create image), `קמפיין` (Campaign),
   `דף נחיתה` (Landing page), `מייל` (Email), `וואטסאפ` (WhatsApp), `SMS`,
   `רב-ערוצי` (Multi-channel), `נהל מודעות` (Manage ads), `ביצועים` (Performance).
6. **"חיבור Meta Ads" card** (Section 1a) — the connect CTA.
7. **"הבריף" (The Brief) card** — header with **`ערוך בריף מלא`** (Edit full brief)
   action, then the full briefing rendered as grouped Q&A sections:
   - `בוא נכיר את העסק (והנשמה שמאחוריו)` — business identity / founding story / presenter.
   - `איפה אפשר לראות אתכם?` — website + social links (site, Instagram, Facebook,
     TikTok, LinkedIn, YouTube, extra links).
   - `מה הלקוח מקבל? (הצעה לעומק)` — offer / price / guarantee / differentiation / process / success story.
   - `מי הלקוח ומה כואב לו? (פסיכולוגיה עמוקה)` — audience pain / emotions / objections / status.
   - `עוד משהו שחשוב שנדע?` — free-text extras.

Note the **per-card "edit" affordance** pattern (e.g. brief card has its own
`ערוך בריף מלא`), and the **active-client switcher** in the top bar
(`לקוח פעיל / <name>`) that scopes the whole app to one client.

### Dashboard card layout (the list view, `/he/dashboard`)
Each client card carries: initials avatar + name; email and/or phone; company;
brief-status line (`בריפינג הושלם (100%)` or `ללא בריפינג`, sometimes a
"נשלח ללקוח (לפני N ימים)" sent-to-client note); optional draft/approved/published
counts; the **`לא מחובר`** Meta pill; 3 small icon-buttons (top-left of card); and
two text actions: **`בריפינג`** and **`פתח`** (Open → goes to client-home).
Dashboard header has: greeting, `N קרדיטים · N לקוחות`, **`ייצוא CSV`**,
**`לקוח חדש`** (New client), a search box, and total counters.

---

## Appendix — constants worth reusing / noting

| Thing | Value |
|-------|-------|
| Meta App ID (`client_id`) | `1239768361023231` |
| OAuth callback (edge fn) | `https://jrhaywbfykjsjywanjsy.supabase.co/functions/v1/meta-oauth?action=callback` |
| Supabase project ref (AutoAds) | `jrhaywbfykjsjywanjsy` |
| Graph API version | `v21.0` |
| Scopes | `ads_management, ads_read, pages_read_engagement, pages_show_list, business_management` |
| Grant type | Authorization Code (`response_type=code`) |
| `state` contents | signed JWT `{userId, clientId, organizationId, returnTo, iat, nonce}` |
| Connect entry point | per-client `client-home`, button `חבר חשבון פייסבוק` |
| Global/settings Meta connect | none (per-client only) |
```