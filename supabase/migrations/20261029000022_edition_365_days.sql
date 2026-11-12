-- The founding edition lasts 365 days, not 100 (the owner's decision, November 2026). Nothing else about the edition changes: it still
-- starts only when an administrator opens it (`px_edition_open`), the closing date is still opens_at + duration_days, written at the opening.
--
--   * the default length of a new edition row is now 365 (the check on the column allows 1 to 366);
--   * the founding edition is changed ONLY while it is in pre-launch (no date, nothing opened) and still has the old default: an edition
--     that is open or closed keeps the length it was opened with (its closing date is already written), and a length that somebody set by
--     hand is left alone.
--
-- To undo (only while the edition is in pre-launch):
--   alter table public.editions alter column duration_days set default 100;
--   update public.editions set duration_days = 100 where status = 'prelaunch' and duration_days = 365;

alter table public.editions alter column duration_days set default 365;
update public.editions set duration_days = 365 where status = 'prelaunch' and duration_days = 100;

-- The postponement of the closing had a ceiling of 366 days after the opening. With an edition of 365 days that left one day of room, so
-- the ceiling is now twice the length of the edition (730 days for 365): enough to absorb a real incident, still a hard limit that the
-- administrator cannot talk their way around (the buyers were promised a closing date). Everything else about the function is unchanged.
-- To undo: re-run the definition of `px_edition_extend` from migration 19.
create or replace function public.px_edition_extend(p_actor uuid, p_new_closes_at timestamptz, p_note text default null) returns jsonb
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor, 'admin');
  e public.editions;
begin
  select * into e from public.editions order by created_at limit 1 for update;
  if not found then raise exception 'px_not_found'; end if;
  if e.status <> 'open' or clock_timestamp() >= e.closes_at then raise exception 'px_edition_bad_state'; end if;
  if p_new_closes_at is null or p_new_closes_at <= e.closes_at or p_new_closes_at > e.opens_at + make_interval(days => 2 * e.duration_days) then raise exception 'px_edition_bad_date'; end if;
  update public.editions set closes_at = p_new_closes_at where id = e.id;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'edition.extend', 'edition', e.id::text,
          jsonb_build_object('closes_at_before', e.closes_at, 'closes_at', p_new_closes_at, 'note', left(coalesce(p_note, ''), 300)));
  return public.px_edition_info();
end $$;
