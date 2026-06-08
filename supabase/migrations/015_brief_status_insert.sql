-- ════════════════════════════════════════════════════════════
-- 015_brief_status_insert
-- Derive briefs.status on INSERT as well as UPDATE.
-- The original trigger (001_schema.sql) was BEFORE UPDATE only, so a brief
-- inserted already carrying a funnel/avatar stayed 'new'. Recreate it as
-- BEFORE INSERT OR UPDATE. Function body is UNCHANGED — only the firing
-- events change. DDL only — apply manually in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════

-- Same body as 001_schema.sql:220 — restated for self-containment.
create or replace function public.update_brief_status()
returns trigger language plpgsql as $$
begin
  if new.funnel is not null then
    new.status = 'complete';
  elsif new.avatar is not null then
    new.status = 'has_avatar';
  else
    new.status = 'new';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brief_status_trigger on public.briefs;

create trigger brief_status_trigger
  before insert or update on public.briefs
  for each row execute function public.update_brief_status();
