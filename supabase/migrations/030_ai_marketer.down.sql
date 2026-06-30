-- Reverse of 030_ai_marketer. Drops in FK-safe order. Run only to fully revert.
drop table if exists public.whatsapp_messages;
drop table if exists public.diagnoses;
drop table if exists public.content_performance;
drop table if exists public.campaign_decisions;
drop table if exists public.campaign_items;
drop table if exists public.campaigns;
