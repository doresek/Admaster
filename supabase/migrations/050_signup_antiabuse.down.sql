-- Reverse of 049_signup_antiabuse. Run only to fully revert.
-- Drops the signup_verifications table, the users.phone unique index, and the
-- users.phone column (in FK-safe / dependency-safe order).
drop table if exists public.signup_verifications;
drop index if exists public.users_phone_unique;
alter table public.users drop column if exists phone;
