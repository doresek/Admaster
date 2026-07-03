-- ============================================================
-- 044_autonomy_modes — D1 DECIDED (Eliran, 2026-07-04): 3 user-selectable
-- MODES replace the L0–L3 ladder — draft_only · propose_approve (default) ·
-- act_within_caps. Columns renamed level→mode for honest vocabulary.
-- Both tables verified EMPTY at authoring (created this session, 0 rows) —
-- the CHECK/default swap and renames carry zero data risk and are fully
-- reversible. Reverse: 044_autonomy_modes.down.sql
-- ============================================================

alter table public.client_autonomy rename column level to mode;
alter table public.client_autonomy rename column level_since to mode_since;
alter table public.client_autonomy drop constraint if exists client_autonomy_level_check;
alter table public.client_autonomy alter column mode set default 'propose_approve';
alter table public.client_autonomy add constraint client_autonomy_mode_check
  check (mode in ('draft_only','propose_approve','act_within_caps'));

alter table public.autonomy_events rename column from_level to from_mode;
alter table public.autonomy_events rename column to_level to to_mode;
alter table public.autonomy_events drop constraint if exists autonomy_events_event_check;
alter table public.autonomy_events add constraint autonomy_events_event_check
  check (event in
    ('mode_changed','action_proposed','action_approved','action_rejected',
     'action_auto_executed','action_blocked','mode_suggestion'));
