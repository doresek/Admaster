-- Best-of-N image pipeline: persist losing candidates + judge rationale on the winner row.
-- The winner stays the canonical row (image_url); the 2 non-winners live in candidate_urls.

alter table public.generated_images
  add column if not exists candidate_urls jsonb default '[]'::jsonb,
  add column if not exists judge_rationale text,
  add column if not exists is_smart boolean default false;

comment on column public.generated_images.candidate_urls is
  'Best-of-N losing candidates: [{url, concept, total}]. Winner is image_url.';
comment on column public.generated_images.judge_rationale is
  'One-line Hebrew rationale from the LLM judge for why the winner was chosen.';
comment on column public.generated_images.is_smart is
  'True when the row came from the smart best-of-N pipeline (vs single-shot).';
