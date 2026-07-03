-- ============================================================
-- 020_meta_client_connect_token
-- Magic-link support for the CLIENT-side Meta connect, mirroring the brief
-- magic-link pattern (018_brief_code_token). The agency generates a per-client
-- connect token and sends it to the client; the client authorizes their OWN
-- Meta without ever logging into AdMaster.
--
-- Higher stakes than a brief link (it grants a Meta write), so unlike the brief
-- token this one is SINGLE-USE + EXPIRING by design (enforced in app code via
-- connect_consumed_at / connect_expires_at).
--
-- Additive + idempotent. No backfill: tokens are minted on demand. Existing
-- meta_clients columns, RLS, and admin/user login are untouched.
--
-- DDL only -- apply MANUALLY in the Supabase SQL Editor (H1).
-- Rollback: 020_meta_client_connect_token.down.sql
-- Run AFTER 019_meta_connections.sql. Apply BEFORE 021.
-- ============================================================

create extension if not exists pgcrypto;

alter table public.meta_clients
  add column if not exists connect_token       text,
  add column if not exists connect_expires_at  timestamptz,
  add column if not exists connect_consumed_at timestamptz;

create unique index if not exists idx_meta_clients_connect_token
  on public.meta_clients(connect_token)
  where connect_token is not null;

-- Token shape: 256-bit CSPRNG rendered as 64 lowercase hex chars
--   (encode(gen_random_bytes(32),'hex') in SQL, or randomBytes(32) in Node) --
-- identical to generateBriefToken() so the existing TOKEN_REGEX
-- (/^[a-f0-9]{64}$/) and rate-limit conventions apply verbatim.

-- Verify after apply:
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='meta_clients'
--     and column_name in ('connect_token','connect_expires_at','connect_consumed_at');
