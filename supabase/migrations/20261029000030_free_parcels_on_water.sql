-- Free imprints on the WATER too (migration 30).
--
-- Until now a free imprint (1 to 24 pixels, a gift that a paid parcel covers) had to be on land. It can now be on the sea as well: the same gift,
-- the same quota (one standing at a time and `free_lifetime_max` in all, whatever the kind), the same window and cap, the same 1 to 24 pixels,
-- the same moderation. What changes is the KIND of the parcel, with the rules that a water parcel already has:
--   * a free water parcel owns the WATER pixels of its rectangle (`land_px` counts the land ones, `owned_px` = w × h − land_px) and needs at least
--     `min_water_percent` of its pixels to be water (half, by default), as a paid water parcel does; a free land parcel still needs `min_land_percent`
--     of land;
--   * land and water never share a pixel, so the "no overlap" guarantee of the free parcels holds per KIND, like the paid ones: a free land parcel
--     and a free water parcel may sit on the same coastal rectangle, two free parcels of the same kind may not;
--   * a free parcel is only placed where nothing OF ITS KIND is active or held (paid, free or illustration);
--   * a paid parcel that becomes active covers the free parcels of ITS OWN kind that its rectangle touches (a paid water parcel covers free water
--     parcels, a paid land parcel covers free land parcels and illustrations; never the other kind: they own other pixels).
-- Illustrations stay land only. Nothing else about the paid side changes, and the public counters are untouched (a free parcel is counted in
-- `free_parcels` / `free_pixels` whatever its kind; `water_parcels` and `water_pixels` still count PAID water parcels only).
--
-- To undo (no free parcel may be on water): restore the constraints, the three functions of migrations 23 and 24 (`px_is_area_free_of_all`,
-- `px_cover_free_parcels`, `px_place_free_parcel`), and `parcels_free_is_land` / `parcels_no_overlap_free` of migration 24.

/* ------------------------------------------------------------------ the constraints */

-- a free parcel may be water; an illustration may not (it is a picture placed by the owner, on land)
alter table public.parcels drop constraint parcels_free_is_land;
alter table public.parcels add constraint parcels_illustration_is_land check (tier <> 'illustration' or kind = 'land');

-- the parcels that are not paid never overlap each other, per kind (a purchase never looks at them: it covers them)
alter table public.parcels drop constraint parcels_no_overlap_free;
alter table public.parcels add constraint parcels_no_overlap_free_land
  exclude using gist (bbox with &&) where (status = 'active' and tier in ('free', 'illustration') and kind = 'land');
alter table public.parcels add constraint parcels_no_overlap_free_water
  exclude using gist (bbox with &&) where (status = 'active' and tier = 'free' and kind = 'water');

/* ------------------------------------------------------------------ is the area free for a FREE parcel of this kind? */

drop function public.px_is_area_free_of_all(integer, integer, integer, integer);
create function public.px_is_area_free_of_all(p_x integer, p_y integer, p_w integer, p_h integer, p_kind text default 'land') returns boolean
language sql stable as $$
  select not exists (
    select 1 from public.parcels p
     where p.kind = p_kind
       and p.bbox && box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8))
       and (p.status = 'active'
            or (p.status = 'reserved' and exists (
                 select 1 from public.parcel_reservations r
                  where r.parcel_id = p.id and r.status = 'held' and r.expires_at > now())))
  )
$$;
revoke all on function public.px_is_area_free_of_all(integer, integer, integer, integer, text) from public, anon, authenticated;

/* ------------------------------------------------------------------ a paid parcel that becomes active covers the free ones of its own kind */

create or replace function public.px_cover_free_parcels() returns trigger language plpgsql as $$
begin
  if new.tier = 'paid' and new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    -- a creation of the covered parcel that was still waiting for moderation will never be shown: it leaves the queue
    update public.parcel_assets a set status = 'superseded'
     where a.status = 'pending'
       and a.parcel_id in (select f.id from public.parcels f where f.tier in ('free', 'illustration') and f.status = 'active' and f.kind = new.kind and f.bbox && new.bbox);
    update public.parcels f
       set status = 'covered', covered_at = now(), covered_by = new.id, updated_at = now()
     where f.tier in ('free', 'illustration') and f.status = 'active' and f.kind = new.kind and f.bbox && new.bbox;
  end if;
  return null;
end $$;
revoke all on function public.px_cover_free_parcels() from public, anon, authenticated;

/* ------------------------------------------------------------------ placing a free parcel, land or water */

-- `p_land` is the number of LAND pixels of the rectangle, counted by the application server (null = all land), whatever the kind: a water parcel
-- owns the others, as for a purchase. `p_kind` is 'land' (what every earlier call meant) or 'water'.
drop function public.px_place_free_parcel(uuid, integer, integer, integer, integer, integer);
create function public.px_place_free_parcel(p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer, p_land integer default null, p_kind text default 'land')
returns table (parcel_id uuid, code text)
language plpgsql as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
  v_st jsonb;
  v_max integer;
  v_water boolean := (p_kind = 'water');
  v_land integer := coalesce(p_land, p_w * p_h);
  v_owned integer;
  v_minshare bigint;
  v_id uuid;
  v_code text;
begin
  if p_kind is null or p_kind not in ('land', 'water') then raise exception 'px_invalid_rect'; end if;
  perform public.px_assert_edition_open();   -- the edition is not open (prelaunch or closed): nothing can be placed
  select * into v_profile from public.profiles where profiles.id = p_user;
  if not found or v_profile.deleted_at is not null then raise exception 'px_no_profile'; end if;
  if v_profile.status <> 'active' then raise exception 'px_account_suspended'; end if;

  v_st := public.px_free_status(p_user);
  if v_st ->> 'reason' = 'full' then raise exception 'px_free_full'; end if;
  if v_st ->> 'reason' is not null then raise exception 'px_free_closed'; end if;
  if v_st ->> 'userReason' is not null then raise exception 'px_free_quota'; end if;
  v_max := (v_st ->> 'maxArea')::integer;

  if p_w is null or p_h is null or p_x is null or p_y is null
     or p_w < 1 or p_h < 1 or p_x < 0 or p_y < 0
     or p_x + p_w > public.px_grid_width() or p_y + p_h > public.px_grid_height()
     or p_w * p_h > v_max then
    raise exception 'px_invalid_rect';
  end if;
  -- the same shares as a purchase: at least min_land_percent of land for a land parcel, at least min_water_percent of water for a water one
  if v_water then
    v_owned := p_w * p_h - v_land;
    v_minshare := public.px_setting_int('min_water_percent');
    if v_land < 0 or v_owned < 1 or v_owned::bigint * 100 < (p_w::bigint * p_h) * v_minshare then raise exception 'px_not_on_water'; end if;
  else
    v_owned := v_land;
    v_minshare := public.px_setting_int('min_land_percent');
    if v_land < 1 or v_land > p_w * p_h or v_land::bigint * 100 < (p_w::bigint * p_h) * v_minshare then raise exception 'px_not_on_land'; end if;
  end if;

  perform public.px_lock_tiles(p_x, p_y, p_w, p_h);
  perform public.px_release_expired_overlapping(box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8)));
  if not public.px_is_area_free_of_all(p_x, p_y, p_w, p_h, p_kind) then raise exception 'px_parcel_unavailable'; end if;

  for i in 1 .. 5 loop
    begin
      insert into public.parcels (owner_id, x, y, w, h, status, land_px, kind, tier, activated_at)
      values (p_user, p_x, p_y, p_w, p_h, 'active', v_land, p_kind, 'free', now())
      returning parcels.id, parcels.code into v_id, v_code;
      exit;
    exception
      when exclusion_violation then raise exception 'px_parcel_unavailable';
      when unique_violation then if i = 5 then raise; end if;   -- public code collision (astronomically rare): draw another code
    end;
  end loop;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'user', 'free_parcel.place', 'parcel', v_id::text, jsonb_build_object('area', p_w * p_h, 'x', p_x, 'y', p_y, 'kind', p_kind));
  return query select v_id, v_code;
end $$;
revoke all on function public.px_place_free_parcel(uuid, integer, integer, integer, integer, integer, text) from public, anon, authenticated;
