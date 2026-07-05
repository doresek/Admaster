# Retention Engine — Design (CP-6, design phase)

**Status:** DESIGN ONLY — no code changed, migration 052 RESERVED and NOT applied.
**Scope:** the Series feature (סדרת הודעות) becomes a consent-based retention / win-back
engine operating ONLY on the business's own opt-in list. Not cold acquisition. Warm tone,
repeat purchase / win-back / loyalty. Three pillars, in the owner's words:
client-scoped + brain-grounded; **channel orchestration — "don't nag"**; **compliance
non-bypassable** (opt-out, Shabbat/Yom-Tov + sending hours, frequency caps — structural,
not advisory). Autonomy tie-in: Mode 2 proposals, Mode 3 within caps.

---

## 1. Existing-asset map

### 1.1 The series/messages model (reusable core)

| Asset | Where | What it is today |
|---|---|---|
| `messages` | `supabase/migrations/003_messages_and_series.sql:11-28` | Single multi-channel copy items (`channel in ('email','sms','whatsapp')`, subject/body/cta). A copy LIBRARY — nothing is ever sent from it. |
| `message_series` | `003_messages_and_series.sql:33-44` | The campaign shell: `user_id`, `client_id`, `goal` (`'reengagement'` already exists!), `duration_days ≤ 365`, `channels jsonb`, `status in ('draft','active','paused','done')`. **No audience linkage, no autonomy state, no activation timestamp.** |
| `series_messages` | `003_messages_and_series.sql:46-56` | Per-step rows: `day_offset`, `channel`, `subject`, `body`, `position`. This is exactly the "plan" half of the engine — reusable as-is. |
| FK repoint | `029_repoint_fks_to_clients.sql:60-63` | `message_series.client_id` and `messages.client_id` already point at the NEW `public.clients` id space. Good — no legacy `meta_clients` problem here. |
| Series UI | `app/(dashboard)/series/page.tsx:65-115` | LLM builds a `[MSG day= ch=]` plan (prompt at `:72-91` already says "מקסימום 1-2 הודעות בשבוע (לא להציף)" — the don't-nag instinct exists but only as a PROMPT, not structure). `saveSeries` (`:117-144`) inserts `message_series` + `series_messages`, status stays `'draft'` forever. **Nothing ever sends; there is no audience.** |
| Messages UI | `app/(dashboard)/messages/page.tsx:41,79` | One-off generator writing to `messages`. Also never sends. |

### 1.2 Send paths (reusable, dry-run today)

| Asset | Where | Notes |
|---|---|---|
| WhatsApp sender | `lib/whatsapp/send.ts:33-84` | `sendWhatsApp()`: InforU adapter → compose `whatsapp_messages` row with `grounded_in` → persist via admin client. Graceful when table absent. **The retention sender wraps this — it is the only real send pipe in the repo.** |
| InforU adapter | `lib/whatsapp/inforu.ts:31-38,79-132` | `resolveMode()` defaults **mock** (no HTTP) unless `INFORU_MODE=live` AND creds (`INFORU_USER`/`INFORU_TOKEN`). Live payload is an ASSUMED shape (blocker C2). InforU also does SMS — the same adapter pattern (likely a different endpoint) covers the SMS channel later. |
| Send log | `030_ai_marketer.sql:132-149` | `whatsapp_messages`: per-send row, `status in ('queued','sent','delivered','read','failed')`, `grounded_in uuid[]`, RLS owner-only. Channel-specific — NOT a per-contact frequency substrate (no contact id, WhatsApp-only). |
| Send API | `app/api/whatsapp/send/route.ts` | Authed one-off send. Stays; the retention sender calls `lib/whatsapp` directly, not this route. |
| Email | — | **No email provider anywhere in the repo** (no resend/sendgrid/nodemailer/postmark). Email channel is design-complete but build-gated on a provider decision (open question §7). |

### 1.3 Contact-store reality — what exists per contact today

| Candidate | Where | Verdict |
|---|---|---|
| `public.contacts` | `003_messages_and_series.sql:187-207`, RLS fixed in `008_fix_contacts_rls.sql` | **DEAD END + NAME COLLISION.** This is the marketing-SITE contact form inbox (anon-insert, service-role-read only, no client_id, no consent). The new table CANNOT be named `contacts` — this design uses **`client_contacts`**. |
| `landing_page_leads` | `004_phase_b.sql:40-56` | Leads from the user's landing pages: `landing_page_id`, `user_id`, `fields jsonb`, UA/referrer. Has NO client_id, NO consent fields, NO channel prefs, NO opt-out. **Not a contact store — but the best IMPORT SOURCE** (a lead who submitted a form is a documented consent event: `consent_source='landing_page'`, evidence = the lead row id). |
| `whatsapp_messages.to_phone` | `030:139` | Raw phone per send; no identity, no consent. Not a store. |

**Per-contact data that exists today: NOTHING.** No consent flag, no opt-out, no channel
prefs, no last-purchase/last-contact. The entire per-contact layer is new (§2).

### 1.4 Autonomy, approvals, timing, heartbeat (reusable frames)

| Asset | Where | Notes |
|---|---|---|
| Action kinds | `lib/capability-contracts/index.ts:299-306`, `lib/autonomy/policy.ts:74-77` | **`send_message` already exists** and is classified a "money kind" (`policy.ts:220-268`): draft_only → propose; propose_approve → propose; act_within_caps → execute iff within ILS caps. No new kind needed. |
| Route-and-audit | `lib/autonomy/route-and-log.ts:52-104` | The "no un-audited execution" invariant (audit-write failure downgrades execute→propose). **The compliance gate copies this fail-closed shape** (§4). |
| Autonomy tables | `040_autonomy.sql` + `044_autonomy_modes.sql` | `client_autonomy` (mode, `caps jsonb`), `autonomy_events` (append-only audit; proposals surface here). Mode-2 approval tap: `app/api/autonomy/approve/route.ts` → `recordApprovalOutcome`. CP-1 is building the approval render surface; retention proposals ride the same rails. |
| Client-portal approvals | `003:91-173` | Token-based EXTERNAL client portal (`get_approval_by_token`). Different audience (the agency's client, not the owner) — not the Mode-2 surface, but its security-definer-RPC-by-token pattern is exactly what the public **opt-out** endpoint needs (§2.4, §4.1). |
| Holidays | `lib/organic-calendar/holidays.ts:19-27` | `IL_HOLIDAYS`: 7 fixed Gregorian dates 2026–2027 (first day only, honesty note: manual yearly refresh). Reused for Yom-Tov windows, but needs a `days` duration notion (§4.3). |
| Shabbat precedent | `lib/organic-calendar/plan.ts:23-27,89` | Planner never schedules Saturday (`DOW_PREFERENCE` omits 6) — but it works on UTC DATES for planning. Send-time enforcement needs Asia/Jerusalem WALL-CLOCK windows (Shabbat starts Friday afternoon), computed, not listed (§4.3). |
| Heartbeat | `lib/heartbeat/scheduler.ts` + `ticks/daily.ts:109-193` | Daily per-client tick: fleet-first, attention-ordered, claim-lease idempotent, every action routed through autonomy BEFORE execution. **The retention sender is a new step in the daily tick** (§3.1) — cron trigger already exists (`app/api/heartbeat/route.ts`, CRON_SECRET-guarded). |
| Grounding | `026_clients_and_strategy.sql:7`, `028_client_intelligence_phase_a.sql:10` | `clients` + `client_insights` — the brain. Series copy generation grounds in atoms exactly like the organic planner (`grounded_in uuid[]` + Hebrew rationale, pattern of `051_organic_schedule.sql:29-30`). |

**Reusable:** `message_series`/`series_messages` (plan store), `lib/whatsapp` (send pipe),
autonomy `send_message` + route-and-log (approval/caps), heartbeat daily tick (scheduler),
`IL_HOLIDAYS` (Yom-Tov), 051's table conventions (RLS/grounding).
**Dead ends:** `contacts` (name taken), `landing_page_leads` as-a-store, `messages` as a
send queue, client-portal `approvals` as the Mode-2 surface.

---

## 2. Data model — migration 052 (draft, RESERVED)

Design decisions first, SQL after.

1. **`client_contacts`, not `contacts`** — the name is taken (§1.3). Client-scoped,
   owner-RLS like 051. A row REQUIRES a consent event: `consented_at` + `consent_source`
   are NOT NULL — there is structurally no such thing as a consent-less contact.
2. **Opt-out is a tombstone, never a delete** — `opted_out_at` stays forever so a
   re-import can never resurrect an opted-out person (the dedup keys hit the tombstone
   and the import updates nothing).
3. **`contact_touches` is the frequency-cap substrate** — one row per send ATTEMPT per
   contact/channel/series, including **refusals** (status `'refused'` + `refusal_code`),
   because "what did we refuse and why" is a compliance requirement, and only
   `status='sent'` rows count toward caps. `promo_key` is what makes "never the same
   promo on two channels" a QUERY, not a hope.
4. **`series_enrollments` is the engine's cursor** — day_offsets are relative to each
   contact's `enrolled_at` (win-back is triggered per contact, not per calendar), and
   `next_position` + `not_before` let caps DEFER a touch without skipping it.
5. **`message_series` gets additive columns** — audience selection (tags), activation
   state, the autonomy proposal linkage, and `promo_key` defaulting per step.
6. Per-contact **`opt_out_token`** (random, unique) powers the public one-click opt-out
   RPC — same anon security-definer pattern as `get_approval_by_token` (`003:116-141`).

```sql
-- 052_contacts_retention.sql (RESERVED — do not apply; orchestrator applies after owner sees it)
--
-- CP-6 retention engine substrate: consented contacts, per-touch send log
-- (frequency-cap substrate), per-contact series enrollment, and the additive
-- message_series columns for audience + activation + autonomy linkage.
-- ADDITIVE ONLY. RLS owner-only (051 convention). `public.contacts` is TAKEN
-- (marketing-site inbox, 003/008) — hence `client_contacts`.

-- 1) client_contacts — the client's OWN opt-in list. A row is impossible
--    without a consent event (consented_at/consent_source NOT NULL).
create table if not exists public.client_contacts (
  id               uuid primary key default uuid_generate_v4(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  full_name        text,
  phone            text,                       -- E.164; nullable, but see CHECK below
  email            text,                       -- lowercased at write time (lib enforces)
  tags             text[] not null default '{}',        -- audience selection substrate
  -- consent (STRUCTURAL: cannot insert a contact without it)
  consent_source   text not null check (consent_source in
                     ('landing_page','checkout','manual','import','api')),
  consented_at     timestamptz not null,
  consent_evidence text,                       -- free-form: lead row id / file name / note
  -- opt-out (tombstone — never deleted, so re-import cannot resurrect)
  opted_out_at     timestamptz,
  opt_out_channel  text check (opt_out_channel in ('email','sms','whatsapp','manual')),
  opt_out_reason   text,
  opt_out_token    text not null unique default encode(gen_random_bytes(18), 'hex'),
  -- channel preferences: explicit false = never use that channel for this contact
  channel_prefs    jsonb not null default '{}'::jsonb,  -- e.g. {"whatsapp":true,"email":false}
  -- retention signals
  last_purchase_at timestamptz,
  last_contact_at  timestamptz,                -- denormalized from contact_touches (sender maintains)
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (phone is not null or email is not null)        -- reachable on ≥1 channel
);
-- dedup per client (partial: null-safe)
create unique index if not exists uq_client_contacts_phone
  on public.client_contacts(client_id, phone) where phone is not null;
create unique index if not exists uq_client_contacts_email
  on public.client_contacts(client_id, email) where email is not null;
-- cap/eligibility queries
create index if not exists idx_client_contacts_client_active
  on public.client_contacts(client_id) where opted_out_at is null;
create index if not exists idx_client_contacts_tags
  on public.client_contacts using gin (tags);
create index if not exists idx_client_contacts_owner
  on public.client_contacts(owner_user_id);

alter table public.client_contacts enable row level security;
drop policy if exists client_contacts_owner_all on public.client_contacts;
create policy client_contacts_owner_all on public.client_contacts
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 2) contact_touches — one row per send ATTEMPT (sent AND refused).
--    THE frequency-cap substrate: caps are computed from status='sent' rows;
--    refusals are the compliance log ("what we did NOT send, and why").
create table if not exists public.contact_touches (
  id                uuid primary key default uuid_generate_v4(),
  contact_id        uuid not null references public.client_contacts(id) on delete cascade,
  client_id         uuid not null references public.clients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  series_id         uuid references public.message_series(id) on delete set null,
  series_message_id uuid references public.series_messages(id) on delete set null,
  channel           text not null check (channel in ('email','sms','whatsapp')),
  status            text not null check (status in ('sent','failed','refused')),
  refusal_code      text check (refusal_code in
                      ('opted_out','no_consent','channel_pref','missing_address',
                       'shabbat','holiday','quiet_hours',
                       'daily_cap','weekly_cap','monthly_cap','min_gap',
                       'promo_duplicate','autonomy_blocked','dry_run_hold')),
  promo_key         text,                      -- same offer = same key; the R4 invariant substrate
  provider          text,                      -- 'inforu' | future email provider
  provider_ref      uuid,                      -- e.g. whatsapp_messages.id (soft ref, cross-table)
  grounded_in       uuid[] not null default '{}',
  rationale         text,                      -- Hebrew WHY (051 convention)
  sent_at           timestamptz not null default now(),
  check ((status = 'refused') = (refusal_code is not null))
);
-- THE cap queries: per-contact recency/counters, per-client volume
create index if not exists idx_touches_contact_sent
  on public.contact_touches(contact_id, sent_at desc) where status = 'sent';
create index if not exists idx_touches_contact_promo
  on public.contact_touches(contact_id, promo_key) where status = 'sent';
create index if not exists idx_touches_client_sent
  on public.contact_touches(client_id, sent_at desc);
create index if not exists idx_touches_series
  on public.contact_touches(series_id);
create index if not exists idx_touches_owner
  on public.contact_touches(owner_user_id);

alter table public.contact_touches enable row level security;
drop policy if exists contact_touches_owner_all on public.contact_touches;
create policy contact_touches_owner_all on public.contact_touches
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 3) series_enrollments — per-contact cursor through a series. day_offset is
--    relative to enrolled_at (win-back is per-contact, not per-calendar).
create table if not exists public.series_enrollments (
  id             uuid primary key default uuid_generate_v4(),
  series_id      uuid not null references public.message_series(id) on delete cascade,
  contact_id     uuid not null references public.client_contacts(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  status         text not null default 'active'
                   check (status in ('active','completed','stopped','opted_out')),
  enrolled_at    timestamptz not null default now(),
  next_position  int not null default 0,       -- first series_messages.position not yet sent
  not_before     timestamptz,                  -- deferral marker (caps push, never skip)
  last_touch_at  timestamptz,
  last_channel   text check (last_channel in ('email','sms','whatsapp')),
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (series_id, contact_id)
);
create index if not exists idx_enrollments_due
  on public.series_enrollments(client_id, status, not_before);
create index if not exists idx_enrollments_contact
  on public.series_enrollments(contact_id);
create index if not exists idx_enrollments_owner
  on public.series_enrollments(owner_user_id);

alter table public.series_enrollments enable row level security;
drop policy if exists series_enrollments_owner_all on public.series_enrollments;
create policy series_enrollments_owner_all on public.series_enrollments
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 4) message_series — additive columns: audience, activation, autonomy linkage.
alter table public.message_series
  add column if not exists audience_tags     text[] not null default '{}',  -- '{}' = all active contacts
  add column if not exists activated_at      timestamptz,
  add column if not exists approval_event_id uuid,          -- autonomy_events.id of the approving tap (Mode 2)
  add column if not exists grounded_in       uuid[] not null default '{}',
  add column if not exists rationale         text;

-- 5) series_messages — additive: promo identity + grounding per step.
alter table public.series_messages
  add column if not exists promo_key   text,                -- same offer across steps/channels = same key
  add column if not exists grounded_in uuid[] not null default '{}';

-- 6) clients — per-client retention policy overrides (defaults live in code;
--    lib/retention/policy.ts owns the shape: quiet hours, caps, min gap).
alter table public.clients
  add column if not exists retention_policy jsonb not null default '{}'::jsonb;

-- 7) Public one-click opt-out by token (anon; same pattern as
--    get_approval_by_token in 003). Sets the tombstone; idempotent.
create or replace function public.retention_opt_out(p_token text, p_channel text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.client_contacts
     set opted_out_at    = coalesce(opted_out_at, now()),
         opt_out_channel = coalesce(opt_out_channel,
           case when p_channel in ('email','sms','whatsapp') then p_channel else 'manual' end),
         updated_at      = now()
   where opt_out_token = p_token
   returning id into v_id;
  if v_id is null then
    return json_build_object('success', false, 'error', 'not_found');
  end if;
  update public.series_enrollments
     set status = 'opted_out', updated_at = now()
   where contact_id = v_id and status = 'active';
  return json_build_object('success', true);
end; $$;
grant execute on function public.retention_opt_out(text, text) to anon, authenticated;
```

(A matching `052_contacts_retention.down.sql` — drop function, drop 3 tables, drop the
added columns — will accompany the up file; omitted here for brevity.)

---

## 3. Orchestration algorithm — deterministic, "don't nag"

All logic lives in `lib/retention/` as PURE functions over loaded rows (the
organic-calendar/policy.ts discipline: injectable `now`, no `Date.now()`, no LLM in the
scheduler; the LLM only writes copy at series-build time, grounded in atoms).

### 3.1 Where it runs

A new step in the **heartbeat daily tick** (`lib/heartbeat/ticks/daily.ts`), after the
hypothesis review: `runRetentionStep(ctx, deps)` — per client, claim-lease idempotent for
free (one daily tick per client per day via `heartbeat_runs`, `045` uniqueness). Cron
plumbing already exists (`/api/heartbeat?tick=daily`).

### 3.2 Candidate selection (per client, per day)

```
for each series with status='active':
  for each enrollment with status='active'
      and (not_before is null or not_before <= now):
    step = series_messages[next_position]
    if step is null → enrollment completed
    if enrolled_at + step.day_offset days <= now → candidate(enrollment, step)
dedupe: AT MOST ONE candidate per contact_id per day (earliest due step wins;
        cross-series ties broken by enrolled_at asc, then series_id — deterministic)
order:  deterministic (contact_id asc) — same inputs ⇒ same batch, byte for byte
```

### 3.3 Channel resolution (rotation, prefs)

For each candidate, the planned channel is `step.channel`, then:

1. Drop channels the contact can't receive (`phone is null` → no sms/whatsapp;
   `email is null` → no email) or has `channel_prefs[ch] === false`.
2. **Rotation rule:** if the resolved channel equals `enrollment.last_channel` AND the
   contact has ≥2 permitted channels, rotate to the next permitted channel in the fixed
   order `whatsapp → email → sms → whatsapp` (deterministic, no randomness).
3. If NO permitted channel remains → refusal `channel_pref` / `missing_address` (logged,
   cursor advances — the step is unreachable for this contact, not deferred).

### 3.4 The "don't nag" invariants (testable rules)

Defaults live in `lib/retention/policy.ts`; per-client overrides in
`clients.retention_policy`. Every rule is a pure predicate over `contact_touches`
(`status='sent'`) + the candidate — each gets a table test.

| # | Invariant (testable statement) | Default |
|---|---|---|
| R1 | ≤ 1 sent touch per contact per calendar day (Asia/Jerusalem), across ALL series and channels. | 1/day |
| R2 | Min gap between consecutive sent touches to a contact ≥ `min_gap_days`. | 3 days |
| R3a | ≤ `weekly_cap` sent touches per contact per rolling 7 days. | 2 |
| R3b | ≤ `monthly_cap` sent touches per contact per rolling 30 days. | 6 |
| R4 | **Never the same promo on two channels:** a candidate whose `promo_key` already has a sent touch for this contact (any channel, within `promo_dedup_days`) is refused `promo_duplicate`. | 90 days |
| R5 | Consecutive touches to a contact use different channels whenever ≥2 channels are permitted (§3.3 rotation). | always |
| R6 | Offer density: at series-BUILD time, at most 1 in 4 steps is a hard offer (mirrors the organic `ROTATION` at `plan.ts:38`); the generator enforces it structurally, the lint rejects plans that violate it. | 1-in-4 |
| R7 | Cap/timing blocks DEFER, never skip: the enrollment gets `not_before = next eligible day`, `next_position` unchanged — sequence order is preserved and the series stretches rather than drops steps. Timing-window blocks (Shabbat/chag/hours) defer to the next allowed send window. | — |
| R8 | Per-client daily volume ≤ `client_daily_send_cap` (protects provider reputation + the "runaway loop" nightmare; excess candidates defer, deterministic order). | 200/day |

180-day sequencing falls out of R1–R7: `series_messages.day_offset` (0–180) anchors the
plan per contact; caps stretch it; `duration_days` remains the design horizon, not a hard
cutoff (a deferred final step still sends).

---

## 4. Compliance gates — the non-bypassable layer

### 4.1 Single chokepoint

`lib/retention/gate.ts` exports ONE function every retention send MUST pass — the same
shape as the autonomy gate (`policy.ts` pure verdicts + `route-and-log.ts` fail-closed
audit):

```ts
checkSendAllowed(input: {
  contact: ContactRow; candidate: Candidate;
  recentTouches: TouchRow[];        // status='sent', loaded for the contact
  policy: RetentionPolicy;          // defaults ⊕ clients.retention_policy
  now: Date;                        // injected — deterministic & testable
}): { allow: true } | { allow: false; code: RefusalCode; reason: string }
```

Pure and TOTAL (garbage in → refuse, never throw). Check order (first hit wins):

1. `no_consent` — `consented_at` missing/unparsable (defense in depth; the schema already forbids it).
2. `opted_out` — `opted_out_at` set. **Checked on EVERY send**, not at enrollment.
3. `channel_pref` / `missing_address` — §3.3 left no permitted channel.
4. `shabbat` / `holiday` / `quiet_hours` — timing windows (§4.3).
5. `min_gap` / `daily_cap` / `weekly_cap` / `monthly_cap` — R1–R3 over `recentTouches`.
6. `promo_duplicate` — R4.

**Non-bypassability is structural, two ways:**

- **Code path:** `lib/retention/sender.ts` is the only module that calls
  `lib/whatsapp/send` (or the future email adapter) for retention, and its send is
  literally inside `if (verdict.allow)`. There is no exported "send raw" in
  `lib/retention`. (Enforced by a lint-style test: no other file under `lib/retention/`
  or `app/api/retention/` imports `lib/whatsapp`.)
- **Fail-closed logging (inverse of route-and-log's downgrade):** the sender writes the
  `contact_touches` row **before** invoking the provider (`status:'sent'` optimistically,
  flipped to `'failed'` on provider error). If the touch-log INSERT fails, the send is
  ABORTED — a send that can't be counted toward tomorrow's caps must not happen.
  Refusals are logged as `status:'refused'` + `refusal_code` + Hebrew `reason` — the
  per-refusal audit the spec requires. (Note the asymmetry: autonomy downgrades
  execute→propose on audit failure; retention aborts, because an uncounted send
  permanently corrupts the cap substrate.)

### 4.2 What gets logged per refusal

One `contact_touches` row: contact, series, step, channel, `status='refused'`,
`refusal_code`, `rationale` (Hebrew, human-readable: "נדחה: חלון שבת — יידחה לראשון 09:00"),
`sent_at` = decision time. Surfaced in the series UI as the "why didn't it send" trail.

### 4.3 Shabbat / Yom-Tov / sending-hours computation

`lib/retention/quiet-windows.ts` — pure, `now` injected:

- **Israel wall-clock without dependencies:** `Intl.DateTimeFormat('en-GB', { timeZone:
  'Asia/Jerusalem', ... })` yields local weekday/hour/minute (Node 20 ships full ICU).
  No date library added.
- **Shabbat (weekly, COMPUTED — never listed):** blocked from **Friday
  `shabbat_start_hour` (default 15:00)** through **Saturday `shabbat_end_hour` (default
  21:00)** Israel time. The fixed conservative window covers candle-lighting drift
  year-round (earliest winter entry ~16:00, latest summer exit ~20:30) without sunset
  math; per-client override in `retention_policy`. This deliberately upgrades the
  organic planner's date-only rule (`plan.ts:26` skips Saturday) to wall-clock.
- **Yom-Tov:** reuse `IL_HOLIDAYS` (`holidays.ts:19-27`) extended in-module with a
  `days` map (רה"ש 2, יו"כ 1, סוכות first+שמח"ת, פסח first+seventh, שבועות 1 — chag
  days only, not chol-hamoed) — blocked from **erev-chag 15:00** through **21:00 of the
  last chag day**. Same honesty note as `holidays.ts`: fixed 2026–2027 dates, yearly
  refresh required; the gate emits a loud heartbeat note when `now` is within 60 days of
  the list's horizon (fail-open for holidays beyond it, since Shabbat — the weekly rule —
  is computed and never expires; owner question §7).
- **Sending hours:** allowed **Sun–Thu 09:00–20:00, Friday 09:00–14:00** Israel time
  (defaults; per-client override). Outside → `quiet_hours`, defer to next window start.
- Timing refusals defer (R7): `not_before` = next allowed window, so a Friday-evening
  batch lands Sunday morning, not never.

---

## 5. Autonomy + approval tie-in

- **Action kind: `send_message`** — already in the contract
  (`capability-contracts/index.ts:301`) and already classified as a money kind in the
  policy table (`policy.ts:220-268`). No policy change needed.
- **Approval granularity = SERIES ACTIVATION, not per touch.** Routing every daily touch
  in Mode 2 would spam the owner — the engine would nag the OWNER instead of the
  contacts. So:
  - **Activating a series** routes ONE `send_message` action through `routeAndLog`:
    `ref = series_id`, `rationale` = the plan summary (N contacts × M steps × channels,
    est. provider cost), `impact.spend_ils` = estimated total provider cost (SMS/WA unit
    prices × planned sends), `grounded_in` = the series' atoms.
    - **draft_only** → propose (never activates itself).
    - **propose_approve (Mode 2)** → propose → surfaces as an approval item on the CP-1
      surface (an `autonomy_events` `action_proposed` row rendered with the series plan:
      audience size, calendar preview, sample messages). Owner's tap →
      `/api/autonomy/approve` → `message_series.status='active'`, `activated_at=now()`,
      `approval_event_id` = the event id. The tap feeds the trust counters as usual.
    - **act_within_caps (Mode 3)** → execute iff est. cost within remaining daily/monthly
      ILS caps (`policy.ts` rule 7); over-cap → propose with the numbers.
  - **Daily batch sends under an ACTIVE series** are the standing approval executing:
    they do NOT re-route per touch. Each daily batch logs one `autonomy_events`
    `action_auto_executed` (kind `send_message`, ref `series_id@date`, reason
    "standing approval <approval_event_id>", counts of sent/refused) — so the audit
    ledger still shows every day the engine acted, and the daily
    `MAX_ACTIONS_PER_DAY` runaway quarantine (`policy.ts:55`) still applies to the batch
    event. **A material change (audience, steps, channels) or pause→resume demotes the
    series to `draft` and requires re-approval.**
- **Compliance is BELOW autonomy:** the §4 gate runs on every touch regardless of mode —
  an owner tap can activate a series, it can never bypass opt-out/Shabbat/caps. (Two
  gates, layered: autonomy answers "may the SYSTEM act?", compliance answers "may THIS
  message reach THIS person NOW?".)
- **Mode-3 volume cap:** propose adding optional `daily_message_cap` (count) to the
  `AutonomyCaps` jsonb — additive, no DDL (`caps` is jsonb). Until then R8's
  `client_daily_send_cap` bounds volume anyway.

---

## 6. Build plan — CP-6b (disjoint file ownership)

All tasks land dry-run-safe; nothing sends live without `INFORU_MODE=live` + creds (C2)
and an email provider decision. Migration 052 application is orchestrator-owned.

| # | Task | Files (owner-exclusive) | Size | Gated on |
|---|---|---|---|---|
| T1 | Contracts + policy defaults: `RetentionPolicy`, row types, refusal codes; `checkSendAllowed` pure gate + quiet-windows (Shabbat/chag/hours) + full table tests | `lib/retention/types.ts`, `lib/retention/policy.ts`, `lib/retention/gate.ts`, `lib/retention/quiet-windows.ts`, `lib/retention/__tests__/*` | M | nothing (pure; tests run pre-migration) |
| T2 | Deterministic orchestrator: candidate selection, channel rotation, R1–R8, deferral; pure over injected rows + tests | `lib/retention/orchestrate.ts` (+ its tests) | M | nothing (pure) |
| T3 | Sender + heartbeat step: load rows, run T2, per-candidate T1 gate, touch-log-then-send via `lib/whatsapp` (mock), enrollment cursor/`last_contact_at` updates, standing-approval audit event; wire `runRetentionStep` into the daily tick | `lib/retention/sender.ts`, `lib/retention/store.ts`, edit `lib/heartbeat/ticks/daily.ts` (+ tests) | M | **migration 052 applied**; sends dry-run (InforU mock) |
| T4 | Contacts CRUD + CSV import (consent fields REQUIRED per row; dedup on phone/email; tombstone respected) + `landing_page_leads` import path | `app/api/contacts/route.ts`, `app/api/contacts/import/route.ts`, `app/(dashboard)/contacts/page.tsx` (NEW) | M | migration 052 |
| T5 | Series page rework: audience picker (tags + count preview), enrollment on activate, activation → `routeAndLog(send_message)`, Mode-2 propose state, calendar/refusal trail views | `app/(dashboard)/series/page.tsx`, `app/api/series/*` (NEW) | M | T2 shapes; CP-1 renders the proposal card |
| T6 | Public opt-out: `GET /api/retention/opt-out?t=<token>` → `retention_opt_out` RPC + tiny Hebrew confirmation page; opt-out link/STOP-hint appended to every outbound body | `app/api/retention/opt-out/route.ts`, `app/opt-out/page.tsx` | S | migration 052 |
| T7 | Email adapter behind the same gate (interface + mock now; provider impl later) | `lib/retention/email.ts` | S now / M live | **provider choice (owner)** + creds |
| T8 | InforU SMS variant of the adapter (same envelope, SMS endpoint) | `lib/whatsapp/inforu.ts` extension or `lib/retention/sms.ts` | S | **C2 creds + real API docs** |

Suggested waves: **W1** = T1+T2 (pure, parallel, no DB) → orchestrator applies 052 →
**W2** = T3+T4+T6 (parallel, disjoint) → **W3** = T5+T7+T8.

---

## 7. Open questions for the owner

1. **Contact import format** — CSV with which columns? Minimum proposed:
   `full_name,phone,email,tags,consented_at,consent_source,last_purchase_at`. Is a
   per-row consent date realistic for existing lists, or do we accept one bulk
   attestation ("this whole list is opt-in, collected via X on date Y") recorded as
   `consent_source='import'` + `consent_evidence`?
2. **Email provider** — Resend / SendGrid / other? (None exists in the repo; email
   channel is blocked on this + creds. Resend is the low-friction default for
   Vercel-hosted Next.js.)
3. **Default caps** — proposed: 1/day, min-gap 3d, 2/week, 6/month per contact;
   200/day per client; promo-dedup 90d. Confirm or adjust.
4. **Quiet windows** — Shabbat Fri 15:00→Sat 21:00 and chag erev-15:00→21:00 OK?
   Friday sending until 14:00 OK? Any client whose audience is שומרי שבת enough to
   also block Sunday-morning "post-Shabbat blast" pileups?
5. **Holiday horizon** — keep the hardcoded `IL_HOLIDAYS` (yearly manual refresh, loud
   warning near horizon), or adopt `@hebcal/core` for computed chagim (one new
   dependency, removes the refresh chore and gives multi-day chag spans for free)?
6. **Mode-2 granularity** — is "approve once per series activation, daily batches ride
   the standing approval" the right trust boundary, or do you want a daily one-tap
   ("today's batch: 12 touches") option as well?
7. **`last_purchase_at` source** — no commerce integration exists; manual/import only
   for now. Is a future webhook/API ingest (`consent_source='checkout'`) planned?
8. **Opt-out link in SMS/WhatsApp** — a URL per message costs SMS length; is "השב הסר"
   (reply-to-remove, requires an InforU inbound webhook — extra scope) preferred over a
   link for SMS?
