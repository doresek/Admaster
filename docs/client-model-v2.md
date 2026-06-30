# Client Model v2 — clean rebuild (foundation)

> **Goal:** replace the overloaded `meta_clients` (identity + Meta credential + assets + strategy + connect-token on one row) with a clean separation: **`clients`** (business identity) · **`briefs`** (questionnaire) · **`client_strategy`** (analysis+avatar) · **`meta_connections`** (optional Meta asset, already exists). Break nothing; migrate everything; drop legacy last.
> **Execution gate:** every migration's SQL is shown for review **before** it is applied. Code re-points ship as PRs (tsc+build+tests, merge when green).
> **Status:** PR #33 (meta_clients patch) CLOSED; old `026` abandoned. **FOUNDATION APPLIED 2026-06-30** as `026_clients_and_strategy` (F1) + `027_backfill_clients` (F2) + `028_client_intelligence_phase_a` (F3). Foundation code merged (PR #34, `a60e00d`).
>
> **GROUND-TRUTH RECONCILIATION (live prod schema vs. assumed):** `meta_clients` already HAD `email/phone/company/notes` (preserved into `clients`). `meta_clients` did NOT have `business_analysis/avatar/core_generated_at` (migration `021` was never applied to prod) nor `connect_token/*` (`020` not applied) — so the **`client_strategy` backfill was empty by design**; it is populated going forward by the brain/orchestrator. Backfill verified **`clients` = `meta_clients` = 4**. Side-effect: the merged `buildAiContext`/orchestrator/#32 code reads those non-existent columns on prod today (latent failure) — the v2 re-point to `client_strategy` fixes it.

---

## 1. Full schema — ALL tables (design)

### 1.1 `clients` — business identity ONLY (NEW)
```sql
create table if not exists public.clients (
  id                   uuid primary key default uuid_generate_v4(),
  owner_user_id        uuid not null references public.users(id) on delete cascade,
  name                 text not null,
  email                text,
  phone                text,
  company              text,
  industry             text,            -- clean column (preserves legacy meta_clients.industry)
  notes                text,
  -- client-connect magic-link (moved off meta_clients): connecting THIS business
  connect_token        text,
  connect_expires_at   timestamptz,
  connect_consumed_at  timestamptz,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
create index if not exists idx_clients_owner on public.clients(owner_user_id);
create unique index if not exists idx_clients_connect_token
  on public.clients(connect_token) where connect_token is not null;
alter table public.clients enable row level security;
drop policy if exists clients_own on public.clients;
create policy clients_own on public.clients
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
```
> During migration, `clients.id` is **set equal to the existing `meta_clients.id`** (1:1), so every existing `client_id` FK value stays valid — re-pointing FKs is a constraint swap, not a data rewrite. **No Meta, no strategy on this table.**

### 1.2 `briefs` — the structured questionnaire (EXISTS; cleaned)
Current columns (migration 001 + 014):
```sql
-- existing:
--   id uuid pk, code text references brief_codes(code), user_id uuid not null,
--   values jsonb not null default '{}',  status text check (new|has_avatar|complete),
--   avatar text, ads text, funnel text,  submitted_at timestamptz, updated_at timestamptz,
--   client_id uuid references meta_clients(id) on delete cascade   (added 014)
```
**v2 changes:**
- Re-point `client_id` FK → `clients(id)`.
- **Deprecate** `avatar`, `ads`, `funnel` text columns — `avatar` content migrates into `client_strategy.avatar`; the questionnaire is `values jsonb`. (Legacy columns dropped in M4.)
- `brief_codes` (id, code unique, user_id, agency_name, created_at, **client_id** [014], **token** [018]) → re-point `client_id` FK → `clients(id)`.

### 1.3 `client_strategy` — analysis + avatar (NEW; the durable core)
```sql
create table if not exists public.client_strategy (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,  -- direct RLS
  business_analysis jsonb,   -- StrategyAnalysis (#32): strategic_summary / sub_audience / platform_funnel / offer_stack
  avatar            jsonb,   -- Avatar v2 structured (#30) or { v1_text }
  core_generated_at timestamptz,
  updated_at        timestamptz default now(),
  unique (client_id)
);
create index if not exists idx_client_strategy_owner on public.client_strategy(owner_user_id);
alter table public.client_strategy enable row level security;
drop policy if exists client_strategy_own on public.client_strategy;
create policy client_strategy_own on public.client_strategy
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
```

### 1.4 `meta_connections` — optional Meta asset (EXISTS, migration 019; only FK re-points)
```sql
-- existing columns (migration 019):
--   id uuid pk,
--   client_id uuid not null references meta_clients(id) on delete cascade,   ← re-point to clients(id)
--   agency_user_id uuid not null references users(id) on delete cascade,
--   token_encrypted text,
--   meta_user_id text, meta_user_name text,
--   pages jsonb default '[]', ad_accounts jsonb default '[]',
--   selected_page_id text, selected_ad_account_id text,
--   status text check (pending|connected|error|revoked) default 'connected',
--   connected_at timestamptz, updated_at timestamptz
-- RLS: meta_connections_own = (auth.uid() = agency_user_id)
```
**v2 change:** re-point `client_id` FK → `clients(id)`. Meta credentials/assets live ONLY here. (Legacy `meta_clients.token/pages/ad_accounts/selected_*/meta_user_*/status` are dropped in M4.)

**Resulting shape:** `clients (1) ─< briefs` · `clients (1) ─1 client_strategy` · `clients (1) ─< meta_connections (0..n)`.

---

## 2. Reference map — every current `meta_clients` reference → re-point

### 2a. Schema FKs (`<table>.client_id → meta_clients(id)`) → re-point to `clients(id)`
| Table (migration) | On-delete | Re-point |
|---|---|---|
| `ad_performance` (002) | cascade, NOT NULL | → `clients(id)` |
| `pixels` (002) | cascade | → `clients(id)` |
| other 002 client-scoped tables (contacts/scheduled_posts) | cascade / set null | → `clients(id)` |
| `messages`, `message_series`, `series_messages` (003/007) | set null | → `clients(id)` |
| `generated_content` (004) | set null | → `clients(id)` |
| `landing_pages` (004) | set null | → `clients(id)` |
| `brief_analyses` / `weak_ad_analyses` / `offer_stacks` (005 / cebd735) | set null | → `clients(id)` |
| `client_journeys`, `journey_events`, `autopilot_runs` (013) | cascade | → `clients(id)` |
| `briefs`, `brief_codes` (014) | cascade / set null | → `clients(id)` |
| `generated_images` (016) | set null | → `clients(id)` |
| `report_shares` (025) | cascade, NOT NULL | → `clients(id)` |
| `approvals` (001) | set null | → `clients(id)` |
| `meta_connections` (019) | cascade | → `clients(id)` |

All re-points are **constraint swaps** (drop FK→meta_clients, add FK→clients); values unchanged because `clients.id == meta_clients.id`.

### 2b. Code reads — IDENTITY (name/list) → read `clients`
`app/(dashboard)/{analytics,approvals,clients,cockpit,history,library,messages,page,pixel,reports,schedule,series}/page.tsx` · `lib/hooks/useMetaClients.ts` · `app/api/active-client/route.ts` · `app/api/recommendations/route.ts` · `app/api/reports/route.ts` (`.select('name, industry')`) · `app/api/report/[token]/resolve.ts` (`meta_clients(name)` join → `clients(name)`) · `app/api/reports/share/mint.ts` · `app/api/briefs/code/issue.ts` (client-scope check).
→ Re-point via a new **`lib/clients.ts`** data layer (`getClient`, `listClients`, `createClient`, `updateClient`, `getClientStrategy`) so call-sites change import, not query shape.

### 2c. Code reads/writes — CREDENTIAL/ASSET → `meta_connections` (via `getActiveConnection`)
`app/api/meta/oauth/{authorize,callback}/route.ts` · `app/api/meta/connect/{[token],callback}/route.ts` · `app/api/meta/clients/[id]/connect-link/route.ts` (connect_token now on `clients`) · `app/api/{analytics,pixel}/route.ts` + `lib/meta.ts` `getDecryptedMetaToken` (already via `getActiveConnection`). Connect-link mint/consume → `clients.connect_*`.

### 2d. Code reads/writes — STRATEGY/CORE → `client_strategy`
`lib/client-core/orchestrator.ts` (writes `business_analysis`/`avatar`/`core_generated_at` → `client_strategy`) · `lib/ai-context.ts` `buildAiContext` (identity from `clients` + strategy from `client_strategy`) · `app/api/client-core/run/route.ts` · `app/api/tools/route.ts` (`persistBusinessAnalysis` → `client_strategy`).

### 2e. Create path → `clients`
`app/api/meta/clients/route.ts` → replaced by `POST /api/clients` (identity only) · `app/(dashboard)/clients/page.tsx` (contact form).

---

## 3. Staged data migration (SQL shown per step; reversible; NOT run without approval)

> `clients.id = meta_clients.id` (1:1) makes child FK re-points no-data-change constraint swaps.

### M1 — create tables (additive, zero risk). ⟲ `drop table client_strategy, clients;`
*(full DDL: §1.1 `clients` + §1.3 `client_strategy`)*

### M2 — backfill (additive inserts; idempotent). ⟲ `truncate clients, client_strategy;`
```sql
-- clients ← meta_clients identity (same id). industry→industry (clean); notes stays NULL.
insert into public.clients
  (id, owner_user_id, name, industry, connect_token, connect_expires_at, connect_consumed_at, created_at, updated_at)
select mc.id, mc.user_id, mc.name, nullif(mc.industry,''),
       mc.connect_token, mc.connect_expires_at, mc.connect_consumed_at,
       coalesce(mc.connected_at, now()), now()
from public.meta_clients mc
where not exists (select 1 from public.clients c where c.id = mc.id);
-- (email/phone/company stay NULL — never existed on meta_clients; populated going forward.)

-- client_strategy ← analysis + avatar
insert into public.client_strategy
  (client_id, owner_user_id, business_analysis, avatar, core_generated_at, updated_at)
select mc.id, mc.user_id, mc.business_analysis, mc.avatar, mc.core_generated_at, now()
from public.meta_clients mc
where (mc.business_analysis is not null or mc.avatar is not null)
  and not exists (select 1 from public.client_strategy s where s.client_id = mc.id);

-- fold legacy briefs.avatar (text) into client_strategy.avatar as {v1_text} where strategy.avatar is null
insert into public.client_strategy (client_id, owner_user_id, avatar, updated_at)
select b.client_id, b.user_id, jsonb_build_object('v1_text', b.avatar), now()
from public.briefs b
where b.client_id is not null and b.avatar is not null and b.avatar <> ''
  and not exists (select 1 from public.client_strategy s where s.client_id = b.client_id);

-- VERIFY: clients should equal meta_clients count.
-- select (select count(*) from public.meta_clients) as meta_clients,
--        (select count(*) from public.clients)       as clients,
--        (select count(*) from public.client_strategy) as client_strategy;
```

### M3 — re-point FKs (constraint swaps). ⟲ swap each FK back to meta_clients.
For each table in §2a (example shape):
```sql
alter table public.<table> drop constraint <table>_client_id_fkey;
alter table public.<table>
  add constraint <table>_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete <same-as-before>;
```
(Exact constraint names confirmed at apply time via `\d <table>`.) Values stay valid (ids identical).

### M3.5 — sync trigger (transition safety, optional). ⟲ `drop trigger`.
Trigger on `meta_clients` insert/update → upsert mirror into `clients`, so any not-yet-re-pointed legacy write cannot create a gap during cutover.

### M4 — drop legacy (LAST, destructive, heavily gated). ⟲ restore from kept copies / compat view.
After ALL code re-pointed + verified: drop `meta_clients` credential/asset/strategy/connect columns and the deprecated `briefs.avatar/ads/funnel`; then `drop table meta_clients` (or convert to a compat VIEW over `clients` if any external dependency remains). Only on explicit approval.

---

## 4. Clean `/clients` + brief UI (AutoAds 1:1, per `autoads-full-map.md`)
- **Dashboard `/clients`:** title **"לקוחות"**; "לקוח חדש" → modal with **name(req) · phone · email · company · notes** (no Meta, no token; `industry` is preserved data, not in the create form per AutoAds). Contact-style cards (initials avatar + name + phone/email/company + brief-status + small "לא מחובר" pill + פתח/בריפינג).
- **Per-client home `/clients/[id]`:** header (name/company/Meta pill) + **5-step workflow strip** (בריף → יצירת מודעות → דף נחיתה → העלאה → סדרות מסרים) + quick actions + stat counters + **Meta optional card** (OAuth `ConnectFacebookButton`) + brief card (5 grouped sections).
- **Brief:** 5-section questionnaire (identity/soul · presence · offer-depth · deep-psychology · extras) → on submit, orchestrator builds `client_strategy` (analysis #32 + avatar #30). Meta never appears in creation or brief.

---

## 5. Phased, safe, reversible execution order
1. **M1** create tables *(SQL → you apply)*. ⟲ drop tables.
2. **M2** backfill *(SQL → you apply; verify counts)*. ⟲ truncate.
3. **Code: `lib/clients.ts` + re-point all READS** (identity→clients, strategy→client_strategy) — PR, merge green. ⟲ revert PR.
4. **M3** re-point FKs *(SQL → you apply)* + **M3.5** sync trigger. ⟲ swap back / drop trigger.
5. **Code: re-point WRITES** — `POST /api/clients` (create→clients), orchestrator→client_strategy, connect→meta_connections + clients.connect_*. PR, merge green. ⟲ revert PR.
6. **Code: clean UI** — `/clients` contact + `/clients/[id]` workflow home + brief. PR, merge green. ⟲ revert PR.
7. **Verify end-to-end** (create client → brief → strategy → generate; existing data intact).
8. **M4** drop legacy meta_clients *(SQL → you approve; the one destructive step)*. ⟲ restore from kept copies / compat view.

Each migration gated on your SQL review. Code steps are independent PRs that self-verify and merge when green. Nothing destructive before step 8 (explicit approval).

*Design complete. No DB changed. Migrations applied only after you approve each SQL block.*
