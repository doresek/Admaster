-- ============================================================
-- 008: Fix overly-broad RLS on public.contacts.
--
-- Migration 007 originally created:
--   create policy "contacts_authenticated_select" ... using (true);
-- which let ANY authenticated user (i.e. any logged-in customer of the
-- SaaS) read EVERY contact-form submission — names, emails, messages of
-- all other users. That is an IDOR / data-leak.
--
-- The app only ever INSERTs into contacts (the public /contact form);
-- nothing reads them via the client. So we drop the broad SELECT policy.
-- With RLS enabled and no SELECT policy, the inbox is readable ONLY by
-- service_role (backend), which is the intended access path.
--
-- Idempotent — safe to run on prod as-is.
-- ============================================================

drop policy if exists "contacts_authenticated_select" on public.contacts;
