-- 052_contacts_retention.sql — CP-6 retention substrate (applied 2026-07-06; additive-autonomy per owner)
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
