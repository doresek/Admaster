# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Next.js dev server on :3000
npm run build       # production build
npm run start       # serve the build
npm run lint        # next lint (ESLint)
npm run type-check  # tsc --noEmit  ← USE THIS to catch errors hidden by next.config.js
```

No test runner is configured.

## Critical: build config hides errors

`next.config.js` sets both `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true`. `npm run build` succeeds even with real TS/ESLint errors — always run `npm run type-check` to actually verify type-safety. There are known live TS errors (notably `<Alert className>` and `<OutputBox className>` since those components don't accept the prop; Stripe `apiVersion` mismatch with installed `stripe@15.8.0`).

## Stack (RTL Hebrew app)

Next.js 14 App Router · Supabase (Auth + Postgres + RLS) · `@supabase/ssr@0.3.0` (pinned — see "Cookies" below) · Anthropic Claude · Stripe · Meta Graph API v19. All UI is Hebrew, RTL, hosted at `admaster-pro.co.il` via Vercel.

## Architecture

### Route groups

- `app/(auth)/` — `/login`, `/register` (public)
- `app/(dashboard)/` — protected agency dashboard, sidebar layout
- `app/brief/` — **public** client-facing brief forms (two parallel flows, see below)
- `app/api/` — server routes; **most are protected by middleware**, exceptions are whitelisted

`(auth)` and `(dashboard)` are Next.js route groups (parens don't appear in URLs). The dashboard layout (`app/(dashboard)/layout.tsx`) renders the sidebar and loads the current user — every protected page lives here.

### Middleware is the auth gate

`middleware.ts` checks Supabase session on every non-static request. The `publicRoutes` whitelist at the top decides what bypasses auth:

```ts
const publicRoutes = ['/login', '/register', '/brief', '/api/brief/'];
```

Note the trailing slash on `/api/brief/` — it intentionally excludes `/api/briefs/` (plural, agent-side) from being public. The new tokenized-brief API lives under singular `/api/brief/[token]/...` and is "authenticated" by a 64-hex token in the URL.

### Two parallel brief flows (do not conflate them)

**Legacy v1** (still wired, original code):
- Agent creates a 6-char code in `brief_codes` (directly from `app/(dashboard)/briefs/page.tsx` or `send-brief/page.tsx`)
- Client visits `/brief?code=ABC123` (query param)
- Form posts to `/api/briefs/submit` (admin client, bypasses RLS, verifies code exists)
- Brief is inserted into `briefs` table with `code` set, `status='new'`

**New v2** (tokenized, added in migration 004):
- Agent calls `POST /api/briefs/create-tokenized` (auth required)
- Server inserts `briefs` row with 64-hex `token`, `code=null`, `submitted_at=null`, `status='sent'`
- Client gets URL `/brief/[token]` (dynamic segment)
- `app/brief/[token]/BriefWizard.tsx` autosaves every ~800ms to `POST /api/brief/[token]/save`
- Final `POST /api/brief/[token]/submit` marks `status='submitted'`
- Token alone is the authorization — no session. All these routes use the admin client and verify the token by direct DB lookup.

The `briefs` table holds **both** kinds of rows. Legacy rows have `code` and no `token`; new rows have `token` and no `code`. Migration 004 dropped NOT NULL on both `code` and `submitted_at` to allow the new flow.

### Supabase clients (`lib/supabase/`)

- `createClient()` (server) — RLS-respecting, scoped to the request's auth cookie. Use for any operation that should be visible to "the current user".
- `createBrowserClient()` (`client.ts`) — browser-side, same idea.
- `createAdminClient()` — service_role, **bypasses RLS**. Use only in trusted server code: webhooks, the public brief endpoints, and the tokenized brief create endpoint (which needs to set `user_id` explicitly).

The cookie adapter on the server client uses `get/set/remove` (not `getAll/setAll`) because `@supabase/ssr@0.3.0` predates the new API. **Do not change to `getAll/setAll` without also bumping the package** — there was an outage caused by this mismatch (the auth cookie wasn't read, every request looked unauthenticated, redirect loop to `/login`).

### Credits are atomic, server-side only

Every chargeable action goes through `deduct_credits(p_user_id, p_action, p_cost)` — a `SECURITY DEFINER` RPC in `001_schema.sql` that locks the row, checks balance, deducts, and writes `credit_history` in one transaction. `app/api/ai/route.ts` is the canonical example. Costs are in `types/index.ts` as `CREDIT_COSTS`.

Migration `003_lock_credits.sql` (security fix B1) revokes column-level UPDATE on `credits/plan/plan_expires_at/is_agency/owner_id` from the `authenticated` role and adds a trigger that double-checks. Direct client-side updates to these columns will fail with `42501`. Use the RPC or the service_role (webhook).

### AI calls always go through `/api/ai`

Clients never call Anthropic directly. The pattern is:
1. Component calls `useAI()` (`lib/hooks/useAI.ts`) with `(action, system, prompt, maxTokens?, platform?)`
2. `/api/ai/route.ts` checks auth, calls `deduct_credits` for the action, calls Claude, persists output to `generated_content`, returns text + new credit balance
3. Output is often structured with `[TAG]...[/TAG]` blocks parsed client-side by the `xt(raw, tag)` helper (search any briefs page).

### Image generation goes through `/api/images` (Imagen 3)

The default provider is Google **Imagen 3** (`imagen-3.0-generate-002` via AI Studio REST). The wrapper lives at `lib/imagen.ts` — it returns base64, which the route uploads to the Supabase Storage bucket `generated-images` (must be created manually, public-read; see comment at the bottom of migration `005_imagen_module.sql`). The legacy Ideogram and DALL-E providers are kept behind `?provider=ideogram|dalle` for fallback — their remote URLs are stored as-is and may expire.

Every generation costs `CREDIT_COSTS.image` credits, deducted through the same `deduct_credits` RPC as the AI route, with `action: 'image'`. Rows in `generated_images` may link to a brief via `brief_id` (added in migration 005) — the page picks this up from `?briefId=` in the URL for forward-compat with brief-driven asset flows.

### Meta API always goes through `/api/meta`

The Meta access token lives in `meta_clients.token` and must not reach the browser. `app/api/meta/route.ts` is a proxy: `GET ?clientId=X&path=...` and `POST {clientId, path, body}`. The hook `useMeta()` (same file as `useAI`) is the client interface.

### Supabase migrations run manually

Migrations under `supabase/migrations/` are **not** auto-applied. After merging a PR that adds one, paste its SQL into the Supabase SQL Editor before deploying the app code, or the new code will crash on missing columns/policies. The order is `001` → `002` → `003` → `004` → `005`. Migration `005` also requires manually creating the `generated-images` Storage bucket (public-read) — see the comment at the bottom of the SQL file.

## Git / deploy conventions

- `main` deploys automatically to Vercel on push.
- Convention used in fix branches: `fix/B<id>-<slug>` for audit-driven security fixes (e.g. `fix/B1-credits-security`); `feat/<slug>` for new features. Merges to main use `--no-ff -m "Merge <branch>: <summary>"` to keep branch history visible.
- The companion `DEPLOY.md` documents the full Vercel + Supabase + Stripe + Meta setup walkthrough.

## Conventions in this codebase

- Hebrew strings inline (no i18n framework). Components in `components/ui/index.tsx` default to `dir="rtl"`.
- Tailwind with custom dark palette (`#0A7AFF`, `#D4AF55`, etc.) hardcoded in components.
- `BriefValues`, `Brief`, `MetaClient`, etc. types live in `types/index.ts` (single file, no per-domain split yet).
- Brand DNA stored as JSONB on `users.brand` — see `BrandDNA` type.
- The custom `xt(raw, tag)` regex helper appears in several pages to extract `[TAG]...[/TAG]` blocks from Claude output.
