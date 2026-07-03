-- Reverse of 044_autonomy_modes (valid while tables carry no mode-vocab rows).
alter table public.autonomy_events drop constraint if exists autonomy_events_event_check;
alter table public.autonomy_events add constraint autonomy_events_event_check
  check (event in
    ('level_changed','action_proposed','action_approved','action_rejected',
     'action_auto_executed','action_blocked','graduation_proposed'));
alter table public.autonomy_events rename column from_mode to from_level;
alter table public.autonomy_events rename column to_mode to to_level;

alter table public.client_autonomy drop constraint if exists client_autonomy_mode_check;
alter table public.client_autonomy alter column mode set default 'L1';
alter table public.client_autonomy add constraint client_autonomy_level_check
  check (mode in ('L0','L1','L2','L3'));
alter table public.client_autonomy rename column mode to level;
alter table public.client_autonomy rename column mode_since to level_since;
