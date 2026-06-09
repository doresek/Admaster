-- ============================================================
-- AdMaster Pro -- Schema Update v17 (Drop Brand DNA)
-- Removes the legacy Brand DNA storage now that business identity
-- comes from the active client (public.meta_clients).
--   * users.brand     -- jsonb blob that held the old Brand DNA
--   * scores.brand_id  -- unused soft ref to that brand
-- No data depends on these columns; no indexes or constraints
-- reference them. Run AFTER 016_generated_images_client_id.sql
-- ============================================================

alter table public.users  drop column if exists brand;
alter table public.scores drop column if exists brand_id;
