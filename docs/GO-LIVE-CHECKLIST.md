# AdMaster Pro — Go-Live Checklist (external gates)

> Everything below is **blocked only on secrets/config the orchestrator cannot supply** — the code is merged and green. Each item lists exact dashboard steps + the env vars to set (Vercel: Project → Settings → Environment Variables, Production scope). Domain referenced as `https://admaster-pro.co.il` (the canonical `NEXT_PUBLIC_APP_URL`); adjust if different.

## H1 — Database migrations (apply remaining DDL)
- **019 / 020 / 021** — ✅ already applied + verified.
- **025_reporting** (`report_shares`) — ⏳ pending apply. Two ways:
  - **Via me:** complete the Supabase MCP OAuth (URL provided in chat) → I apply it + run the A/B/C verify queries autonomously.
  - **Manual:** paste the `025` block (in chat / PR #22 body) into Supabase → SQL Editor → Run.
- Note: do **not** use `supabase db push` — the repo has pre-existing duplicate-numbered migrations (003/004/007/008) that break the migration runner; apply target migrations individually. DDL down-migration for 025 (reversible): `drop table if exists public.report_shares cascade;`

## H2 — Transactional email (SMTP) — unblocks signup confirm + password reset + report delivery
1. Pick a provider (Resend / Amazon SES / SendGrid) and create an SMTP credential + a verified sender domain.
2. **Supabase Dashboard → Authentication → Emails → SMTP Settings → enable Custom SMTP**; enter host, port (587), username, password, sender email/name.
3. **Authentication → URL Configuration:** set Site URL = `https://admaster-pro.co.il`; add Redirect URLs: `https://admaster-pro.co.il/auth/callback`.
4. Decide email-confirmation policy (Authentication → Providers → Email → "Confirm email"). Recommended **ON** (the register page + `/auth/callback` already handle the confirm UX). 
5. Test: register a throwaway address → confirm email arrives → link lands authenticated; then run the password-reset round-trip (`/forgot-password`).

## H3 — Stripe (live subscriptions + top-ups + self-serve portal)
1. **Stripe Dashboard → Products:** create 3 products with **recurring monthly ILS** prices — Starter, Pro, Agency. Copy each Price ID (`price_...`).
2. **Vercel env:** `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY` = those Price IDs; `STRIPE_SECRET_KEY` = live secret; `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = live publishable.
3. **Stripe Dashboard → Developers → Webhooks → Add endpoint:** URL `https://admaster-pro.co.il/api/credits/webhook`; subscribe to events **`checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`**. Copy the signing secret → Vercel env `STRIPE_WEBHOOK_SECRET`.
4. **Billing Portal:** Stripe Dashboard → Settings → Billing → Customer portal → activate (allow cancel + plan switch). The "ניהול מנוי / ביטול" button calls `/api/billing/portal` (resolves customer by email).
5. Test (Stripe test mode first): subscribe with `4242…` → `users.plan` updates; `stripe trigger invoice.paid` → credits top up; buy a top-up → credits increment once; open portal → cancel → `plan` reverts to `free`.

## H4 — Meta OAuth (dashboard connect + session-less client-connect link)
1. **Meta App Dashboard → Facebook Login → Settings → Valid OAuth Redirect URIs** — add BOTH (byte-exact, per environment):
   - `https://admaster-pro.co.il/api/meta/oauth/callback` (dashboard-initiated connect)
   - `https://admaster-pro.co.il/api/meta/connect/callback` (**NEW** — session-less client-connect link)
   - plus localhost equivalents for dev.
2. **App scopes:** `ads_management, ads_read, pages_read_engagement, pages_show_list, business_management`. Add your FB user as a Tester (App Roles) to use advanced scopes before App Review.
3. **Vercel env:** `META_APP_ID`, `META_APP_SECRET` (already set), `META_OAUTH_STATE_SECRET` (≥32 random chars), `META_OAUTH_REDIRECT_URI` = the oauth/callback URL, `META_CONNECT_REDIRECT_URI` = the connect/callback URL, optional `META_LOGIN_CONFIG_ID` (Business Login), `META_GRAPH_VERSION` (default `v21.0`).
4. Test: dashboard — open a client → "חבר חשבון Facebook" → consent → returns `?meta=connected`, row in `meta_connections`. Connect-link — mint a link from a client, open it logged-out, authorize, confirm a `meta_connections` row is created and the link is single-use.

## Post-config verification debt (env-gated smoke tests, run once H2–H4 set)
- create-post end-to-end (PR #14 `maxDuration`/retry) returns 200, no 502.
- OAuth round-trips (dashboard + connect-link) write `meta_connections`.
- Stripe test-mode flows (above).
- `POST /api/meta/insights` populates `ad_performance`; then a report renders real numbers; mint a `/report/<token>` link and open it logged-out.

## Supabase tier
- Free tier auto-pauses (NXDOMAIN/HTTP 521 when idle). For production, upgrade to keep the DB always-on (and so insights cron / live tests are reliable).
