-- ============================================================
-- 027_backfill_clients  (F2)  — backfill clients from meta_clients (GROUND-TRUTH schema)
-- Foundation step 2 of 3. Run AFTER F1 (026). Additive, idempotent (NOT EXISTS).
-- Reconciled to the LIVE meta_clients columns:
--   present: id,user_id,name,industry,emoji,email,phone,company,notes,connected_at,...
--   ABSENT : business_analysis,avatar,core_generated_at (021 not applied) -> NO strategy backfill.
-- clients.id == meta_clients.id (1:1) so later FK re-points are pure constraint swaps.
-- Reverse: truncate public.clients;   (client_strategy untouched here)
-- The final SELECT is the VERIFY -- clients MUST equal meta_clients.
-- ============================================================

insert into public.clients
  (id, owner_user_id, name, email, phone, company, industry, notes, created_at, updated_at)
select mc.id, mc.user_id, mc.name,
       mc.email, mc.phone, mc.company,
       nullif(mc.industry,''), mc.notes,
       coalesce(mc.connected_at, now()), now()
from public.meta_clients mc
where not exists (select 1 from public.clients c where c.id = mc.id);

-- (client_strategy backfill intentionally omitted: meta_clients has no business_analysis/avatar
--  on this DB. client_strategy stays empty and is populated going forward by the brain/orchestrator.)

-- ===== VERIFY: clients MUST equal meta_clients =====
select (select count(*) from public.meta_clients)   as meta_clients,
       (select count(*) from public.clients)         as clients,
       (select count(*) from public.client_strategy) as client_strategy;  -- expected 0 for now
