alter table public.generated_images
  add column if not exists client_id uuid references public.meta_clients(id) on delete set null;

create index if not exists idx_generated_images_client_id on public.generated_images(client_id);
