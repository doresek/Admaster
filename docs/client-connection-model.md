# Client ↔ Connection Model — Design Doc

> **Status:** DESIGN ONLY. No code, no migrations have been written or run.
> **Author context:** Follow-up to the read-only investigation of how a "client"
> (לקוח) is modeled vs Meta entities in AdMaster.

---

## ⛔ GATE — DO NOT BUILD UNTIL THE BUYER-IDENTITY VERDICT CONFIRMS THE AGENCY MODEL

**This entire document is conditional.** It assumes the product is a *true agency
platform*: each client is a **separate business** that owns its **own** Meta
connection, brief, and avatar — connected by the client, not the agency owner.

That assumption has **not** been confirmed. The current product behaves as a
single-operator tool where every "client" is derived from the operator's own
connected Meta token (see the investigation findings, summarized in §1).

**Do not write any of the migrations, routes, or read-path changes below until
the buyer-identity verdict explicitly confirms the agency model is the target.**

Reasons the gate exists:

- If the product stays single-operator, splitting the credential out of
  `meta_clients` is **pure cost with no benefit** — it adds a join to every read
  path and a backfill risk for zero user-visible change.
- The session-less client-connect link (§2) only makes sense if **external
  clients** authenticate their own Meta. In a single-operator world there is no
  external client to send the link to.
- PR #10 (`feat/meta-oauth`) is **mergeable as-is** under the single-operator
  model. The reconciliation in §3 is only required if we commit to the agency
  model. Blocking #10 on this doc would be a mistake if the verdict goes the
  other way.

**When the verdict lands:**

- **Agency model confirmed** → proceed; start at §3 (reconcile #10) so we don't
  ship a schema we immediately have to migrate.
- **Single-operator confirmed** → archive this doc; merge #10 unchanged; close
  the gap as "won't do."

Everything past this line is the design to execute *only after* the gate clears.

---

## 1. Background — today's model (the conflation)

There is no standalone `clients` table. The entity the UI calls a "לקוח" is
`public.meta_clients` (`supabase/migrations/001_schema.sql:65-84`), and that one
row plays **three roles at once**:

| Role | Columns | Problem |
|---|---|---|
| Business identity | `name, industry, emoji` | fine on its own |
| Meta credential | `token`, `token_encrypted` (added in `003`) | 1:1 welded to identity |
| Meta asset snapshot | `pages` jsonb, `ad_accounts` jsonb, `selected_page_id`, `selected_ad_account_id` | denormalized copy of whatever the token could see |

A client is **created from a Meta token** (`app/api/meta/clients/route.ts`), not
as an independent business. Briefs and avatars hang off the same row:

```
users (agency owner)
  └─ meta_clients         ← "CLIENT"  (+ token + pages[] + ad_accounts[])
       ▲   ▲
       │   └── brief_codes.client_id        (migration 014)
       │              │ code
       │              ▼
       └────── briefs.client_id             (migration 014)
                      │   briefs.avatar = TEXT column (no separate entity)
                      └─ generated_images.client_id (migration 016)
```

Migration `014_brief_client_link.sql` already made `meta_clients.token` nullable
("clients can exist before a Meta token") — the first half-step toward separating
identity from credential. This doc completes that split.

**Target model:** `meta_clients` stays the **client/business** entity; a new
`meta_connections` child table holds the **credential + assets**. One client →
0..n connections.

```
meta_clients (client/business identity)
  └─ meta_connections (0..n)   ← token_encrypted + pages[] + ad_accounts[] + selection
```

---

## 2. Migration design (DDL only — apply manually in Supabase SQL Editor)

> Conventions honored: pure ASCII; idempotent (`if not exists`); DDL-only and
> applied by hand in the SQL Editor (no automated DDL in this project); RLS
> mirrors the existing `auth.uid() = user_id` pattern from `001_schema.sql`.

> **Migration number — COORDINATE BEFORE USE.** Highest on `main` is `017`.
> `feat/brief-magic-link` already claims `018_brief_code_token.sql` and
> `feat/meta-oauth` (PR #10) adds **no** migration. The numbers below are
> placeholders (`019`, `020`); confirm the next free integer with the user at
> merge time to avoid a collision across worktrees.

### 2.1 `019_meta_connections.sql` — new table + RLS

```sql
-- ============================================================
-- 019_meta_connections
-- Split the Meta credential + asset snapshot out of meta_clients into a
-- child table, so one client (business) can own 0..n Meta connections and
-- a client can exist with no connection at all.
-- DDL only -- apply MANUALLY in the Supabase SQL Editor.
-- ============================================================

create table if not exists public.meta_connections (
  id                      uuid default uuid_generate_v4() primary key,

  -- The business this connection belongs to.
  client_id               uuid not null
                            references public.meta_clients(id) on delete cascade,

  -- The agency operator who MANAGES this connection (for RLS + listing).
  -- The Meta TOKEN itself may belong to the external client; agency_user_id is
  -- about who can see/manage the row inside AdMaster, not who owns the FB asset.
  agency_user_id          uuid not null
                            references public.users(id) on delete cascade,

  -- Credential. Encrypted with lib/crypto (AES-256-GCM), same format as
  -- meta_clients.token_encrypted. Nullable so a connection row can be created
  -- (e.g. a pending connect link) before the token arrives.
  token_encrypted         text,

  -- Identity of the connected Meta account (whoever authorized).
  meta_user_id            text,
  meta_user_name          text,

  -- Asset snapshot fetched at connect time (same shape as meta_clients today).
  pages                   jsonb default '[]'::jsonb,
  ad_accounts             jsonb default '[]'::jsonb,
  selected_page_id        text,
  selected_ad_account_id  text,

  status                  text default 'connected'
                            check (status in ('pending','connected','error','revoked')),

  connected_at            timestamptz default now(),
  updated_at              timestamptz default now()
);

create index if not exists idx_meta_connections_client
  on public.meta_connections(client_id);
create index if not exists idx_meta_connections_agency
  on public.meta_connections(agency_user_id);

-- One "primary/active" connection per client is the common case. We do NOT
-- enforce uniqueness on client_id (a client may have multiple connections),
-- but the read path (4.x) picks the most-recent connected row per client.

-- ── RLS ─────────────────────────────────────────────────────
alter table public.meta_connections enable row level security;

-- Agency operator sees + manages only their own connection rows. Mirrors the
-- "meta_clients_own" policy in 001_schema.sql.
create policy "meta_connections_own" on public.meta_connections
  using (auth.uid() = agency_user_id)
  with check (auth.uid() = agency_user_id);

-- NOTE: the session-less connect callback (section 2/§2.3 below) writes the
-- token via the SERVICE ROLE (createAdminClient), which bypasses RLS — exactly
-- as the public brief resolver does today. The token in the signed link IS the
-- authorization for that write; RLS above governs the authenticated dashboard.
```

### 2.2 `019` (cont.) — BACKFILL existing connected clients

```sql
-- ============================================================
-- BACKFILL: move every currently-connected meta_clients row into ONE
-- meta_connections row, so nothing breaks on cutover. Idempotent: re-running
-- will NOT create duplicates (guarded by the NOT EXISTS sub-select).
-- ============================================================

insert into public.meta_connections (
  client_id,
  agency_user_id,
  token_encrypted,
  meta_user_id,
  meta_user_name,
  pages,
  ad_accounts,
  selected_page_id,
  selected_ad_account_id,
  status,
  connected_at,
  updated_at
)
select
  mc.id                                 as client_id,
  mc.user_id                            as agency_user_id,
  -- Preserve whichever credential form the legacy row holds. Legacy plaintext
  -- `token` rows are tolerated downstream by lib/crypto decryptOrPlaintext, and
  -- are separately re-encrypted by scripts/backfill-encrypt-meta-tokens.ts.
  coalesce(mc.token_encrypted, mc.token) as token_encrypted,
  mc.meta_user_id,
  mc.meta_user_name,
  coalesce(mc.pages, '[]'::jsonb),
  coalesce(mc.ad_accounts, '[]'::jsonb),
  mc.selected_page_id,
  mc.selected_ad_account_id,
  -- Only rows that actually have a credential become 'connected'.
  case
    when coalesce(mc.token_encrypted, mc.token) is not null then 'connected'
    else 'pending'
  end,
  coalesce(mc.connected_at, now()),
  now()
from public.meta_clients mc
where coalesce(mc.token_encrypted, mc.token) is not null   -- only connected clients
  and not exists (
    select 1 from public.meta_connections c
    where c.client_id = mc.id
  );

-- Verify before proceeding:
--   select c.client_id, mc.name, c.status, left(coalesce(c.token_encrypted,''),8)
--   from public.meta_connections c join public.meta_clients mc on mc.id = c.client_id
--   order by c.connected_at desc limit 20;
```

### 2.3 `020_meta_client_connect_token.sql` — session-less connect link support

```sql
-- ============================================================
-- 020_meta_client_connect_token
-- Magic-link support for the CLIENT-side Meta connect, mirroring the brief
-- magic-link pattern (migration 018_brief_code_token). The agency generates a
-- per-client connect token and sends it to the client; the client authorizes
-- their OWN Meta without ever logging into AdMaster.
--
-- Higher stakes than a brief link (it grants a Meta write), so unlike the brief
-- token this one is SINGLE-USE + EXPIRING by design.
-- DDL only -- apply MANUALLY in the Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

alter table public.meta_clients
  add column if not exists connect_token       text,
  add column if not exists connect_expires_at  timestamptz,
  add column if not exists connect_consumed_at  timestamptz;

create unique index if not exists idx_meta_clients_connect_token
  on public.meta_clients(connect_token)
  where connect_token is not null;

-- No backfill: tokens are minted on demand when the agency clicks
-- "Send connect link", exactly like brief codes mint a token at issue time.
```

> **Token shape:** 256-bit CSPRNG rendered as 64 lowercase hex chars
> (`encode(gen_random_bytes(32),'hex')` in SQL, or `randomBytes(32)` in Node) —
> identical to `generateBriefToken()` so the existing `TOKEN_REGEX`
> (`/^[a-f0-9]{64}$/`) and rate-limit conventions apply verbatim.

---

## 3. Session-less client-connect link (reusing the brief magic-link pattern)

The brief magic-link (`feat/brief-magic-link`) already establishes the exact
pattern we want: a long unguessable token *is* the authorization, resolved
server-side by the **service role** so the external party needs no AdMaster
login. We mirror it for Meta connect.

**Reference points in the existing magic-link code:**

- `lib/share.ts` — `getAppOrigin()` + `briefLink(token)` build the canonical
  production URL (`NEXT_PUBLIC_APP_URL`, never a preview origin).
- `app/api/brief/[token]/route.ts` — public resolver: `TOKEN_REGEX` pre-check →
  IP rate-limit (`checkRateLimit`, 30/min) → `createAdminClient()` lookup by
  token. The token, not a session, is the access control.
- `app/api/briefs/code/issue.ts` — mints the token at issue time.

### 3.1 Flow

```
Agency (logged in)                 External client (NO AdMaster login)        Meta
──────────────────                 ───────────────────────────────────       ────
1. Click "Send connect link"
   POST /api/meta/clients/:id/connect-link
   -> mint connect_token (64-hex),
      set connect_expires_at (e.g. now()+72h),
      save on meta_clients (admin client)
   -> return connectLink(token)
2. Send link via WhatsApp/email
   (reuse whatsappShareLink in lib/share.ts)
                                   3. Open /connect/<token>
                                      GET /api/meta/connect/<token>  (PUBLIC)
                                        - TOKEN_REGEX + rate-limit
                                        - admin lookup: token valid,
                                          not consumed, not expired
                                        - show agency + client name
                                   4. Click "Connect Facebook"
                                      GET /api/meta/connect/<token>/authorize
                                        - resolve client_id FROM TOKEN
                                          (NOT auth.getUser())
                                        - signState({ clientId, connectToken,
                                          returnTo }) -- no userId
                                        - 302 -> Facebook dialog ─────────────> 5. Client authorizes
                                                                                   THEIR OWN Meta
                                   6. GET /api/meta/connect/callback?code&state <─┘
                                        - verifyState (CSRF)
                                        - re-validate connect_token (admin):
                                          still valid + unconsumed + unexpired
                                        - code -> long-lived token
                                        - fetchMetaIdentity
                                        - INSERT meta_connections row:
                                            client_id      = state.clientId
                                            agency_user_id = meta_clients.user_id (looked up)
                                            token_encrypted = encrypt(longToken)
                                            status = 'connected'
                                        - mark connect_consumed_at = now()
                                        - redirect to a public "done" page
```

### 3.2 Key differences from the brief link

| Aspect | Brief link (018) | Connect link (this design) |
|---|---|---|
| Reusable? | Yes (one code → many briefs) | **No** — single-use (`connect_consumed_at`) |
| Expiry? | None in v1 | **Yes** (`connect_expires_at`, ~72h) |
| Authorization carried | token only | token (CSRF re-checked) + signed `state` JWT through the OAuth round-trip |
| Who writes the row | client submits brief (RLS insert-by-code) | **service role** inserts `meta_connections` in the callback |
| Ownership stamped | `briefs.client_id` | `meta_connections.agency_user_id` = the client's `meta_clients.user_id`; **token = client's own FB** |

### 3.3 Why `agency_user_id` is stamped but the token is the client's

`agency_user_id` controls **who in AdMaster can see/manage** the connection (it
drives the `meta_connections_own` RLS policy and the dashboard listing). It is
resolved server-side from `meta_clients.user_id` for the `client_id` in the
signed token — **never** from a session, because the external client has none.
The Meta access token stored in `token_encrypted` is whatever the *client*
authorized in step 5, so the agency operates the client's own Meta asset without
ever holding the client's Facebook password or pasting a token by hand.

---

## 4. Reconciliation with PR #10 (`feat/meta-oauth`)

**Current behavior of #10:** OAuth writes the token onto the **`meta_clients`**
row.

- `app/api/meta/oauth/authorize/route.ts` — requires `auth.getUser()`, requires
  the `meta_clients` row to already belong to that user, signs
  `state = { userId, clientId, returnTo, nonce }`.
- `app/api/meta/oauth/callback/route.ts` — exchanges code → long-lived token,
  then **`UPDATE meta_clients SET token_encrypted, pages, ad_accounts, ...
  WHERE id = state.clientId AND user_id = user.id`**, with a hard
  `user.id !== state.userId` session-mismatch guard.

This is correct for the **single-operator** model and **conflicts** with the
agency model only in *where the credential lands* (`meta_clients` vs
`meta_connections`).

### 4.1 Exact route changes (agency model)

**`authorize/route.ts`** — minimal change:

- Keep the owner-session guard for the *dashboard-initiated* reconnect (agency
  reconnecting on behalf of a client they own). No change to `state` shape for
  this path.
- Add the *session-less* sibling route described in §3 (`/api/meta/connect/...`)
  whose `state` carries `connectToken` and **omits `userId`**. The two authorize
  entry points share `signState`/`verifyState` from `lib/meta-oauth.ts`.

**`callback/route.ts`** — change the write target. Replace the
`UPDATE meta_clients ...` block with an **INSERT into `meta_connections`**:

```ts
// BEFORE (PR #10): writes credential onto the client identity row
await supabase.from('meta_clients').update({
  token_encrypted, token: null, meta_user_id, meta_user_name,
  pages, ad_accounts, selected_page_id, selected_ad_account_id,
  status: 'connected', updated_at,
}).eq('id', state.clientId).eq('user_id', user.id);

// AFTER (agency model): credential becomes a child connection row
await supabase.from('meta_connections').insert({
  client_id:              state.clientId,
  agency_user_id:         /* owner-session: user.id; connect-link: looked-up owner */,
  token_encrypted,
  meta_user_id, meta_user_name,
  pages, ad_accounts,
  selected_page_id:       pages[0]?.id ?? null,
  selected_ad_account_id: adAccounts[0]?.id ?? null,
  status:                 'connected',
});
// meta_clients is NOT touched on connect anymore — it is pure identity.
```

- `meta_clients` no longer carries `token`/`pages`/`ad_accounts` going forward
  (those columns remain, populated only by the backfill snapshot, and become
  read-legacy — see §6).
- The owner-session path uses `agency_user_id = user.id`. The connect-link path
  uses the service role and sets `agency_user_id` from the looked-up
  `meta_clients.user_id`.

### 4.2 Merge order — re-point #10 BEFORE merge

**Recommendation: re-point `feat/meta-oauth` to write `meta_connections` BEFORE
merging it — do not merge-then-migrate.**

Rationale:

- Merge-then-migrate ships a schema (`token` on `meta_clients`) that we
  immediately deprecate, and creates a window where production writes the
  credential to the *old* place while the agency read path expects the *new*
  place. That window needs a dual-write or a freeze — avoidable complexity.
- #10 adds **no migration of its own**, so re-pointing it is purely a
  route-handler change (the `update meta_clients` → `insert meta_connections`
  swap above). Low cost, no schema churn.
- Sequence:
  1. Apply `019` (table + RLS + backfill) and `020` (connect token) in Supabase.
  2. Re-point #10's callback to `meta_connections` (and add the connect-link
     routes from §3).
  3. Update read paths (§5).
  4. Merge #10.

If — and only if — the buyer-identity verdict is still pending when #10 is
otherwise ready, the fallback is to **merge #10 as-is under the single-operator
model** and treat this whole document as not-yet-triggered. That is the gate at
the top doing its job; it is not "merge-then-migrate" of the agency model.

---

## 5. Read-path changes (client → connection)

The principle: anything that needs a **credential or assets** reads through the
client's **active connection**; anything that needs **identity** still reads
`meta_clients`.

Define one shared resolver (sketch, design only):

```ts
// "active connection" = most-recent 'connected' row for the client.
async function getActiveConnection(supabase, clientId, agencyUserId) {
  const { data } = await supabase
    .from('meta_connections')
    .select('id, token_encrypted, pages, ad_accounts, selected_page_id, selected_ad_account_id, status')
    .eq('client_id', clientId)
    .eq('agency_user_id', agencyUserId)
    .eq('status', 'connected')
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
```

### 5.1 `getDecryptedMetaToken` (`lib/meta.ts`)

Today it selects `token_encrypted, token` from `meta_clients`. Re-point it to
read from the active connection, keeping the same `decryptOrPlaintext` safety
net and the same `(clientId, userId)` signature:

```ts
// was: .from('meta_clients').select('token_encrypted, token').eq('id', clientId).eq('user_id', userId)
// now: resolve via getActiveConnection(clientId, userId) -> decrypt its token_encrypted
```

Legacy fallback: if no `meta_connections` row exists yet (pre-backfill edge),
fall back to the old `meta_clients` columns so nothing breaks mid-rollout.

### 5.2 Page / ad-account picker (`app/(dashboard)/clients/page.tsx`)

- `client.pages` / `client.ad_accounts` and the `selected_page_id` writes
  (`onUpdate({ selected_page_id })`) currently target the `meta_clients` row.
- Re-point them to the **active connection**: the picker reads
  `connection.pages` / `connection.ad_accounts`, and selecting a page/account
  updates `meta_connections.selected_page_id` / `selected_ad_account_id`
  (`...update(...).eq('id', connection.id)`).
- The client card counts (`c.pages.length`, `c.ad_accounts.length`) read from
  the active connection instead of the client row.

### 5.3 AI grounding (`lib/ai-context.ts` → `buildAiContext`)

- The **client block** (`name, industry, emoji`) is unchanged — that is pure
  identity and stays on `meta_clients` (`ai-context.ts:56-64`).
- The **brief/avatar block** is unchanged — briefs already link by
  `briefs.client_id` (`ai-context.ts:76-89`); the avatar is still
  `briefs.avatar`.
- **No credential is read here**, so grounding needs *no* connection lookup. The
  only thing to confirm is that `clientId` continues to mean "a `meta_clients`
  identity id" — which it does. Grounding is unaffected by the split.

### 5.4 Anywhere using `meta_clients` for publish/campaign

`app/api/meta/route.ts` already funnels every Graph call through
`getDecryptedMetaToken`, so once §5.1 is re-pointed, publish + campaign creation
automatically use the connection's token. Audit for any direct
`from('meta_clients').select('...token...')` reads and route them through
`getActiveConnection`.

---

## 6. What `meta_clients` keeps vs sheds (post-cutover)

| Column on `meta_clients` | Fate |
|---|---|
| `id, user_id, name, industry, emoji` | **Keep** — core client identity |
| `connect_token, connect_expires_at, connect_consumed_at` | **Add** (migration 020) |
| `posts_published, campaigns_created` | Keep (per-client rollups) — or move to connection later; out of scope |
| `token, token_encrypted` | **Legacy-read only** after backfill; new writes go to `meta_connections`. Drop in a later migration once `getDecryptedMetaToken` no longer falls back to them |
| `meta_user_id, meta_user_name` | Legacy-read only; canonical copy now on the connection |
| `pages, ad_accounts, selected_page_id, selected_ad_account_id` | Legacy-read only; canonical copy now on the connection |
| `status, connected_at` | Legacy-read only; connection has its own |

Dropping the legacy columns is a **separate, later** migration — not part of this
cutover — so the rollout is reversible.

---

## 7. Rollout checklist (only after the §0 gate clears)

1. [ ] Confirm next free migration numbers with the user (placeholders 019/020).
2. [ ] Apply `019` (table + RLS) in Supabase SQL Editor; verify.
3. [ ] Run the `019` backfill; verify one connection per connected client.
4. [ ] Apply `020` (connect token columns); verify.
5. [ ] Re-point `feat/meta-oauth` (#10) callback `meta_clients` → `meta_connections`.
6. [ ] Add session-less connect routes + `lib/share.ts` `connectLink()` helper.
7. [ ] Re-point read paths (`lib/meta.ts`, clients page picker; confirm grounding untouched).
8. [ ] Type-check + build + smoke test (per project policy: never push a broken state).
9. [ ] Merge #10.
10. [ ] Later, separate migration: drop legacy credential/asset columns from `meta_clients`.

---

*End of design. No code or migrations were created or executed.*
