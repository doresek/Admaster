-- ════════════════════════════════════════════════════════════
-- 018_brief_code_token
-- Magic-link support for client briefs.
--
-- Today a client opens a brief by TYPING a short 6-char code into /brief.
-- This adds a long, unguessable TOKEN to each brief code so the client can
-- instead click a full link (/brief/<token>) and land straight on the form.
-- The 6-char code is kept as a manual-entry fallback.
--
-- Model (Approach A):
--   * The token lives on brief_codes (NOT on briefs) -> one token per code.
--   * REUSABLE by design: the same link may be submitted multiple times,
--     matching today's behavior where one code can yield many brief rows.
--   * No expiry / single-use in v1. Future hooks are left commented below.
--
-- Security: the token is the ONLY access control on the public brief form,
--   so it is a 256-bit CSPRNG value rendered as 64 lowercase hex chars.
--
-- DDL only -- apply MANUALLY in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════

-- gen_random_bytes() comes from pgcrypto (enabled by default on Supabase).
-- If the UPDATE below errors with "function gen_random_bytes does not exist",
-- prefix the call with the schema: extensions.gen_random_bytes(32).
create extension if not exists pgcrypto;

-- 1) Add the token column (nullable first, so the backfill can populate it).
alter table public.brief_codes
  add column if not exists token text;

-- 2) Backfill a CSPRNG 64-hex (256-bit) token for every EXISTING code, so all
--    currently-active codes immediately get a working magic link.
update public.brief_codes
  set token = encode(gen_random_bytes(32), 'hex')
  where token is null;

-- 3) Enforce uniqueness + fast lookup by token.
create unique index if not exists idx_brief_codes_token
  on public.brief_codes(token)
  where token is not null;

-- 4) (Optional) After confirming the backfill populated every row, make the
--    column mandatory. Left commented so this migration is safe to re-run.
-- alter table public.brief_codes alter column token set not null;

-- ── Future hooks (NOT part of v1) ───────────────────────────────────────────
-- Link expiry:
--   alter table public.brief_codes add column if not exists expires_at timestamptz;
-- Single-use links:
--   alter table public.brief_codes add column if not exists consumed_at timestamptz;
-- ────────────────────────────────────────────────────────────────────────────

-- Verify with:
--   select code, left(token, 8) || '...' as token_preview, client_id
--   from public.brief_codes order by created_at desc limit 10;
