-- Feature C: attach a Meta Pixel to a landing page so /lp/[slug] fires
-- PageView + Lead (on form submit), closing the conversion loop with ads.
alter table public.landing_pages
  add column if not exists meta_pixel_id text;

comment on column public.landing_pages.meta_pixel_id is
  'Meta Pixel ID injected into the public /lp/[slug] page (PageView + Lead on submit).';
