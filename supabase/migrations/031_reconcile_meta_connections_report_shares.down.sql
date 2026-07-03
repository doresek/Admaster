-- Reverse of 031. Both are leaf tables (nothing FKs into them). Run only to revert.
drop table if exists public.report_shares;
drop table if exists public.meta_connections;
