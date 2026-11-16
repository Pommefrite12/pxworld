-- Administrators and free imprints (migration 26): an account with the role 'admin' (`admin_roles`, never a client-editable flag) can place as many
-- free imprints as it wants, to dress the map or to try the site:
--   * it is not held by the personal quota (one standing at a time, `free_lifetime_max` in all);
--   * it is not held by the free period either: the switch (`free_parcels_open`), the window (`free_parcels_days`) and the cap (`free_parcels_cap`)
--     do not apply to it. The edition still has to be OPEN, as for everybody (nothing is placed before the opening);
--   * its free parcels do not count towards the cap that the VISITORS share (the cap is the public's gift, not the owner's).
-- Everything else is unchanged and still enforced here: 1 to 24 pixels, land only, never over a paid or held parcel or another free one, the share of
-- land. A moderator (role 'moderator') has no such privilege. `px_free_status` says so (`unlimited`); `px_place_free_parcel` asks `px_free_status`.
--
-- To undo: re-run the definition of `px_free_status` from migration 23.

create or replace function public.px_free_status(p_user uuid default null) returns jsonb
language plpgsql stable as $$
declare
  e public.editions;
  v_on boolean := coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'free_parcels_open'), false);
  v_days integer := public.px_setting_int('free_parcels_days')::integer;
  v_cap bigint := public.px_setting_int('free_parcels_cap');
  v_max integer := least(public.px_setting_int('free_max_area'), public.px_setting_int('min_area') - 1)::integer;
  v_life integer := public.px_setting_int('free_lifetime_max')::integer;
  v_ends timestamptz;
  v_placed bigint;
  v_used integer := 0;
  v_reason text;
  v_user text;
  v_admin boolean := p_user is not null and coalesce(public.px_staff_role(p_user), '') = 'admin';
begin
  select * into e from public.editions order by created_at limit 1;
  v_ends := case when e.opens_at is null then null else e.opens_at + make_interval(days => v_days) end;
  -- what the visitors have used of the cap: the administrators' own free parcels are not counted
  select count(*) into v_placed from public.parcels pc
   where pc.tier = 'free' and pc.status in ('active', 'covered', 'revoked')
     and not exists (select 1 from public.admin_roles r where r.user_id = pc.owner_id and r.role = 'admin');
  v_reason := case
    when public.px_edition_state() <> 'open' then 'edition'
    when v_admin then null                                   -- an administrator: the switch, the window and the cap do not apply
    when not v_on then 'off'
    when v_ends is null or clock_timestamp() >= v_ends then 'ended'
    when v_placed >= v_cap then 'full'
    else null end;
  if p_user is not null then
    select count(*) into v_used from public.parcels where owner_id = p_user and tier = 'free' and status in ('active', 'covered', 'revoked');
    v_user := case
      when v_admin then null                                 -- ... and neither does the personal quota
      when exists (select 1 from public.parcels where owner_id = p_user and tier = 'free' and status = 'active') then 'standing'
      when v_used >= v_life then 'lifetime'
      else null end;
  end if;
  return jsonb_build_object('open', v_reason is null, 'reason', v_reason, 'endsAt', v_ends, 'maxArea', v_max, 'cap', v_cap, 'placed', v_placed,
                            'userReason', v_user, 'used', v_used, 'lifetimeMax', v_life, 'unlimited', v_admin);
end $$;
revoke all on function public.px_free_status(uuid) from public, anon, authenticated;
