-- ============================================================
-- 050_signup_antiabuse — signup anti-abuse (Part 3 #8).
-- ADDITIVE / REVERSIBLE / IDEMPOTENT. Pure ASCII.
--
-- Strong-smart signup guard WITHOUT a credit card. Four signals land here:
--   1. device_fingerprint  — hashed, hand-rolled, captured client-side
--   2. signup_ip           — captured SERVER-SIDE (x-real-ip / x-forwarded-for)
--   3. phone + phone_verified_at (SMS OTP)  — ONE phone = ONE account
--   4. repeat-business detection is READ-ONLY over meta_connections/meta_clients
--      (see lib/anti-abuse/repeat-business.ts) and needs no schema here.
--
-- PRIVACY: device fingerprint, IP and phone are PERSONAL DATA. Their collection
-- must be disclosed in the privacy policy (see lib/anti-abuse notice block).
--
-- OTP is stored HASHED (otp_hash) with a short expiry (otp_expires_at) and an
-- attempt cap (attempts). Plaintext OTP is NEVER stored.
--
-- Adds nothing destructive: one new column on public.users (phone) + a partial
-- unique index, and one new table public.signup_verifications (RLS owner-only).
-- Reverse: 049_signup_antiabuse.down.sql
-- Run AFTER 048_competitor_signal_type.sql.
-- ============================================================

-- ── 1) users.phone — the ONE verified phone per account ────────────────────
-- Additive, nullable. Phone was not collected before this migration, so there
-- are no existing rows to conflict with the unique index below.
alter table public.users
  add column if not exists phone text;

-- Preflight (defensive): confirm no duplicate non-null phones exist before the
-- unique index is created. Expected 0 rows (phone is brand new). Raises a clear
-- error instead of a cryptic index-build failure if that assumption is ever
-- violated on re-apply.
do $$
declare
  dup_count int;
begin
  select count(*) into dup_count from (
    select phone from public.users
    where phone is not null
    group by phone
    having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception 'signup_antiabuse preflight: % duplicate users.phone value(s) found; resolve before creating the unique index', dup_count;
  end if;
end $$;

-- Partial UNIQUE index: one account per phone, only over non-null phones.
-- Enforced at the DB level so a race between two verify-otp calls cannot land
-- the same phone on two accounts.
create unique index if not exists users_phone_unique
  on public.users(phone)
  where phone is not null;

-- ── 2) signup_verifications — the per-user OTP + signals record ─────────────
create table if not exists public.signup_verifications (
  id                 uuid primary key default uuid_generate_v4(),
  -- One verification record per user.
  user_id            uuid not null unique
                       references public.users(id) on delete cascade,
  -- Phone under verification (E.164-ish normalized). Copied to users.phone
  -- only once verified, so the unique index there stays clean.
  phone              text,
  phone_verified_at  timestamptz,
  -- Hand-rolled device fingerprint, stored HASHED (sha256 hex). Never the raw
  -- signals.
  device_fingerprint text,
  -- Captured SERVER-SIDE at send-otp time. Never trust a client-sent IP.
  signup_ip          text,
  -- OTP is stored HASHED only. Short expiry + attempt cap gate brute force.
  otp_hash           text,
  otp_expires_at     timestamptz,
  attempts           int not null default 0,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists idx_signup_verifications_phone
  on public.signup_verifications(phone);
create index if not exists idx_signup_verifications_fingerprint
  on public.signup_verifications(device_fingerprint);
create index if not exists idx_signup_verifications_ip
  on public.signup_verifications(signup_ip);

-- ── RLS: owner-only ─────────────────────────────────────────────────────────
-- The OTP write/verify path runs through the SERVICE ROLE (createAdminClient),
-- which bypasses RLS. This policy governs the authenticated dashboard: a user
-- can read only their own verification row.
alter table public.signup_verifications enable row level security;
drop policy if exists signup_verifications_own on public.signup_verifications;
create policy signup_verifications_own on public.signup_verifications
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Verify after apply:
--   select column_name from information_schema.columns
--     where table_name='signup_verifications' order by ordinal_position;
--   select indexname from pg_indexes where tablename='users' and indexname='users_phone_unique';
