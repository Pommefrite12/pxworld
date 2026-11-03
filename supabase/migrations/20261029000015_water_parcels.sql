-- Water parcels: the oceans and the seas can be bought too, as a category of their own.
--
-- A parcel is still a rectangle, but it now has a KIND. A land parcel owns the LAND pixels of its rectangle (the rest, the sea, is
-- cut away: it is not hers, and it is free or discounted); a water parcel owns the WATER pixels of its rectangle (the land is cut
-- away the same way). Land and water never share a pixel, so two parcels of different kinds may sit on the same rectangle: the
-- no-overlap guarantee of PostgreSQL now holds between parcels of the SAME kind. Everything else (customisation, moderation,
-- payment) is the same for both kinds; only the way a water parcel is SHOWN differs (blue tints, done by the application).
--
-- * `parcels.kind`, `orders.kind`: 'land' (every parcel so far) or 'water'.
-- * `parcels.land_px` keeps its meaning (land pixels inside the rectangle); a water parcel owns `w*h - land_px`. `owned_px` is the
--   number of pixels a parcel really owns, whatever its kind: the public counters (the whole planet, land and water) add them up.
-- * Settings (admin): `water_price_percent` (a water pixel costs this % of a land pixel, default 100), `min_water_percent` (at
--   least this % of a water parcel must be water, default 50), `land_cut_price_percent` (a land pixel cut away from a water
--   parcel costs this % of a land pixel, default 0 = free, like the sea cut away from a land parcel).
-- * `px_start_order` takes the kind (last, optional argument: every older call is a land purchase, as before).

alter table public.parcels add column kind text not null default 'land' check (kind in ('land', 'water'));
alter table public.orders  add column kind text not null default 'land' check (kind in ('land', 'water'));
-- the percentage of a land pixel's price that a pixel OWNED by the parcel cost when the order was made (100 for every land order)
alter table public.orders  add column water_percent integer not null default 100 check (water_percent between 1 and 1000);

alter table public.parcels add constraint parcels_water_has_land_count check (kind <> 'water' or land_px is not null);
alter table public.parcels add column owned_px integer generated always as
  (case when kind = 'water' then w * h - coalesce(land_px, 0) else coalesce(land_px, w * h) end) stored;
comment on column public.parcels.owned_px is 'Pixels the parcel really owns: its land pixels (kind land) or its water pixels (kind water).';

-- THE overlap guarantee, once per kind (a land parcel and a water parcel may share a rectangle: they never share a pixel).
alter table public.parcels drop constraint parcels_no_overlap;
alter table public.parcels add constraint parcels_no_overlap_land
  exclude using gist (bbox with &&) where (status in ('reserved', 'active') and kind = 'land');
alter table public.parcels add constraint parcels_no_overlap_water
  exclude using gist (bbox with &&) where (status in ('reserved', 'active') and kind = 'water');

alter table public.orders drop constraint orders_amount_consistent;
alter table public.orders add constraint orders_amount_consistent check (
  case when kind = 'water'
    then amount_cents = ((area - coalesce(land_px, 0))::bigint * unit_price_cents * water_percent) / 100
                      + (coalesce(land_px, 0)::bigint * unit_price_cents * sea_percent) / 100
    else amount_cents = coalesce(land_px, area)::bigint * unit_price_cents
                      + ((area - coalesce(land_px, area))::bigint * unit_price_cents * sea_percent) / 100
  end);

insert into public.app_settings (key, value) values
  ('water_price_percent',    '100'::jsonb),
  ('min_water_percent',      '50'::jsonb),
  ('land_cut_price_percent', '0'::jsonb)
on conflict (key) do nothing;

create or replace function public.px_set_setting(p_actor uuid, p_key text, p_value jsonb) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  if p_key not in ('price_unit_cents', 'price_unit_cents_usd', 'min_area', 'max_area', 'reservation_ttl_minutes', 'max_active_reservations_per_user', 'sales_open',
                   'sea_price_percent', 'min_land_percent', 'water_price_percent', 'min_water_percent', 'land_cut_price_percent') then
    raise exception 'px_bad_setting';
  end if;
  if p_key = 'sales_open' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'px_bad_setting'; end if;
  else
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)
       or (p_value #>> '{}')::numeric < (case when p_key in ('sea_price_percent', 'land_cut_price_percent') then 0 else 1 end) then raise exception 'px_bad_setting'; end if;
    if p_key in ('sea_price_percent', 'min_land_percent', 'min_water_percent', 'land_cut_price_percent') and (p_value #>> '{}')::numeric > 100 then raise exception 'px_bad_setting'; end if;
    if p_key = 'water_price_percent' and (p_value #>> '{}')::numeric > 1000 then raise exception 'px_bad_setting'; end if;
    if p_key = 'min_area' and (p_value #>> '{}')::numeric < 25 then raise exception 'px_bad_setting'; end if;
    if p_key = 'max_area' and (p_value #>> '{}')::numeric > 1000000 then raise exception 'px_bad_setting'; end if;
    if p_key = 'reservation_ttl_minutes' and (p_value #>> '{}')::numeric < 32 then raise exception 'px_bad_setting'; end if;
  end if;
  update public.app_settings set value = p_value, updated_by = p_actor, updated_at = now() where key = p_key;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'setting.update', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

-- Is the rectangle free for a parcel of this kind? (Parcels of the other kind do not count: they own other pixels.)
drop function public.px_is_area_free(integer, integer, integer, integer);
create function public.px_is_area_free(p_x integer, p_y integer, p_w integer, p_h integer, p_kind text default 'land') returns boolean
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

revoke all on function public.px_is_area_free(integer, integer, integer, integer, text) from public, anon, authenticated;

-- The order. `p_land` is the number of LAND pixels of the rectangle, counted by the application server (null = all land).
drop function public.px_start_order(uuid, integer, integer, integer, integer, integer, text);
create function public.px_start_order(p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer, p_land integer default null, p_currency text default null, p_kind text default 'land')
returns table (order_id uuid, parcel_id uuid, reservation_id uuid, amount_cents bigint,
               unit_price_cents integer, currency text, expires_at timestamptz)
language plpgsql as $$
declare
  v_profile public.profiles;
  v_base text := lower((select value #>> '{}' from public.app_settings where key = 'currency'));
  v_cur text := lower(coalesce(nullif(trim(p_currency), ''), (select value #>> '{}' from public.app_settings where key = 'currency')));
  v_unit integer;
  v_ttl integer := public.px_setting_int('reservation_ttl_minutes');
  v_min bigint := public.px_setting_int('min_area');
  v_max bigint := public.px_setting_int('max_area');
  v_box box;
  v_parcel uuid;
  v_order uuid := gen_random_uuid();
  v_res uuid;
  v_expires timestamptz := now() + make_interval(mins => v_ttl);
  v_held bigint;
  v_water boolean := (p_kind = 'water');
  v_cut integer;                                    -- % of a land pixel's price for the pixels cut away (sea of a land parcel, land of a water parcel)
  v_wp integer := public.px_setting_int('water_price_percent');
  v_minshare integer;
  v_land integer := coalesce(p_land, p_w * p_h);   -- land pixels of the rectangle, counted by the application server (null = all land)
  v_owned integer;                                  -- pixels the parcel will own
  v_amount bigint;
begin
  if p_kind is null or p_kind not in ('land', 'water') then raise exception 'px_invalid_rect'; end if;
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sales_open'), false) is not true then
    raise exception 'px_sales_closed';
  end if;
  -- the shop sells in its own currency and in dollars, nothing else
  if v_cur = v_base then v_unit := public.px_setting_int('price_unit_cents');
  elsif v_cur = 'usd' then v_unit := public.px_setting_int('price_unit_cents_usd');
  else raise exception 'px_bad_currency';
  end if;
  select * into v_profile from public.profiles where id = p_user;
  if not found or v_profile.deleted_at is not null then raise exception 'px_no_profile'; end if;
  if v_profile.status <> 'active' then raise exception 'px_account_suspended'; end if;
  if p_w is null or p_h is null or p_x is null or p_y is null
     or p_w < 1 or p_h < 1 or p_x < 0 or p_y < 0
     or p_x + p_w > public.px_grid_width() or p_y + p_h > public.px_grid_height()
     or p_w > 1000 or p_h > 1000
     or p_w::bigint * p_h < v_min or p_w::bigint * p_h > v_max then
    raise exception 'px_invalid_rect';
  end if;
  if v_land < 0 or v_land > p_w * p_h then raise exception 'px_not_on_land'; end if;

  -- A land parcel may include some sea, but never be mostly sea: at least min_land_percent of its pixels must be land. A water parcel
  -- is the same the other way round: at least min_water_percent of its pixels must be water. What is cut away is free or discounted.
  if v_water then
    v_owned := p_w * p_h - v_land;
    v_minshare := public.px_setting_int('min_water_percent');
    v_cut := public.px_setting_int('land_cut_price_percent');
    if v_owned < 1 or v_owned::bigint * 100 < (p_w::bigint * p_h) * v_minshare then raise exception 'px_not_on_water'; end if;
    v_amount := (v_owned::bigint * v_unit * v_wp) / 100 + (v_land::bigint * v_unit * v_cut) / 100;
  else
    v_owned := v_land;
    v_minshare := public.px_setting_int('min_land_percent');
    v_cut := public.px_setting_int('sea_price_percent');
    if v_owned < 1 or v_owned::bigint * 100 < (p_w::bigint * p_h) * v_minshare then raise exception 'px_not_on_land'; end if;
    v_amount := v_land::bigint * v_unit + ((p_w * p_h - v_land)::bigint * v_unit * v_cut) / 100;
  end if;
  if v_amount < 1 or v_amount > 99999999 then raise exception 'px_invalid_rect'; end if;   -- Stripe's per-line maximum (999 999,99 in minor units)

  v_box := box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8));
  perform public.px_lock_tiles(p_x, p_y, p_w, p_h);
  perform public.px_release_expired_overlapping(v_box);

  -- Hoarding guard: a user can hold only a few unpaid reservations at once.
  select count(*) into v_held from public.parcel_reservations r
   where r.user_id = p_user and r.status = 'held' and r.expires_at > now();
  if v_held >= public.px_setting_int('max_active_reservations_per_user') then
    raise exception 'px_too_many_reservations';
  end if;

  for i in 1 .. 5 loop
    begin
      insert into public.parcels (owner_id, x, y, w, h, status, land_px, kind)
      values (p_user, p_x, p_y, p_w, p_h, 'reserved', v_land, p_kind) returning id into v_parcel;
      exit;
    exception
      when exclusion_violation then
        raise exception 'px_parcel_unavailable';
      when unique_violation then
        if i = 5 then raise; end if;  -- public code collision (astronomically rare): draw another code
    end;
  end loop;

  insert into public.orders (id, user_id, parcel_id, x, y, w, h, area, land_px, sea_percent, water_percent, kind, unit_price_cents, amount_cents, currency, expires_at)
  values (v_order, p_user, v_parcel, p_x, p_y, p_w, p_h, p_w * p_h, v_land, v_cut, case when v_water then v_wp else 100 end, p_kind, v_unit, v_amount, v_cur, v_expires);

  insert into public.parcel_reservations (parcel_id, user_id, order_id, expires_at)
  values (v_parcel, p_user, v_order, v_expires) returning id into v_res;

  return query select v_order, v_parcel, v_res, v_amount, v_unit, v_cur, v_expires;
end $$;

revoke all on function public.px_start_order(uuid, integer, integer, integer, integer, integer, text, text) from public, anon, authenticated;

-- The public counters count the whole planet: every pixel owned, land and water (the sea cut away from a land parcel, or the land cut
-- away from a water parcel, is not "sold"). `water_*` say how much of it is water.
drop function public.px_public_stats();
create function public.px_public_stats()
returns table (sold_pixels bigint, parcels bigint, owners bigint, published_creations bigint, map_version bigint, water_pixels bigint, water_parcels bigint)
language sql stable as $$
  select coalesce(sum(p.owned_px), 0)::bigint,
         count(*)::bigint,
         count(distinct p.owner_id)::bigint,
         count(*) filter (where p.published_asset_id is not null and p.hidden_at is null)::bigint,
         (select version from public.map_state where id = 1),
         coalesce(sum(p.owned_px) filter (where p.kind = 'water'), 0)::bigint,
         count(*) filter (where p.kind = 'water')::bigint
    from public.parcels p where p.status = 'active'
$$;
revoke all on function public.px_public_stats() from public, anon, authenticated;
