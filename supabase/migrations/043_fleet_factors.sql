-- ============================================================
-- 043_fleet_factors — C-04 exogenous-shock detection storage (spec C-04):
-- daily fleet-level factor rows (median/MAD of day-over-day metric deltas
-- across all active clients). AGGREGATE ONLY — deliberately NO client FK and
-- nothing tenant-identifying. RLS is enabled with NO policies: only the
-- service-role (server) can read/write; no authenticated user sees fleet data.
-- ADDITIVE / REVERSIBLE. Reverse: 043_fleet_factors.down.sql
-- ============================================================

create table if not exists public.fleet_daily_factors (
  id           uuid primary key default uuid_generate_v4(),
  date         date not null,
  platform     text not null default 'meta',
  metric       text not null,                  -- cpm | ctr | cvr | spend
  median_delta numeric,                        -- median day-over-day relative delta
  mad          numeric,                        -- median absolute deviation (robust spread)
  sample_n     int not null default 0,         -- clients contributing
  shocked      bool not null default false,
  direction    text check (direction in ('up','down') or direction is null),
  note         text,                           -- calendar overlay annotation (chag etc.)
  created_at   timestamptz default now(),
  unique (date, platform, metric)
);
create index if not exists idx_fleet_factors_date on public.fleet_daily_factors(date desc, platform);
-- RLS on, zero policies = service-role only (aggregate data never reaches a tenant).
alter table public.fleet_daily_factors enable row level security;
