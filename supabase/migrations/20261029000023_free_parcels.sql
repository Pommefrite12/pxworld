-- Free imprints ("empreintes gratuites"): a small parcel (1 to 24 pixels: always below the smallest paid parcel) that anybody with a verified
-- e-mail can place for nothing, at the start of the edition. The price of that gift is that it is PRECARIOUS: a paid parcel that touches it
-- covers it, whole. Nothing else about the paid side changes.
--
-- The rules, all enforced here (the application only asks):
--   * `parcels.tier`: 'paid' (what has always existed) or 'free'. A free parcel is always land, active at once (no order, no payment), and has
--     1 to 24 pixels; a paid one has at least 25.
--   * A free parcel NEVER blocks a purchase: the "no overlap" guarantee of the paid side (the exclusion constraints) only looks at paid
--     parcels. Free parcels have a guarantee of their own (they cannot overlap each other).
--   * What is on the map is still never overlapping: a paid parcel that becomes active (an order paid, a group project funded: any path, it
--     is a trigger) COVERS every active free parcel of the same kind that its rectangle touches: status 'covered', with the date and the
--     parcel that covered it. A free parcel is only placed where no paid parcel is active or held (a reservation, a collecting project).
--   * Covering is final (a refund of the covering parcel does not bring the free one back). A covered parcel stays in the database and keeps
--     its public archive page, with the mention that it was covered.
--   * Quota: one free parcel standing at a time per account, and `free_lifetime_max` placements in all (a parcel given back after a failed
--     upload does not count). Window: `free_parcels_days` days from the opening of the edition, at most `free_parcels_cap` free parcels in all,
--     and an administrator can switch it off (`free_parcels_open`). The verified e-mail is checked by the application (it is Supabase's).
--   * The public counters of SOLD pixels count paid parcels only; the free ones are counted apart.
--
-- To undo (nothing free must exist): drop the trigger and the functions below, restore the constraints of migrations 12 and 15, drop the three
-- columns, and re-run the definitions of `px_is_area_free`, `px_set_setting` and `px_public_stats` from migrations 15 and 17.

/* ------------------------------------------------------------------ the columns */

alter table public.parcels add column tier text not null default 'paid' check (tier in ('paid', 'free'));
alter table public.parcels add column covered_at timestamptz;
alter table public.parcels add column covered_by uuid references public.parcels (id) on delete set null;
comment on column public.parcels.tier is 'paid: bought (the only kind until migration 23). free: a gift of 1 to 24 pixels that a paid parcel can cover.';
comment on column public.parcels.covered_at is 'When a paid parcel covered this free parcel (status covered).';
comment on column public.parcels.covered_by is 'The paid parcel that covered it.';

-- the status list gains 'covered' (the constraint is the inline check of the column, whatever its generated name)
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.parcels'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%reserved%released%revoked%';
  if c is not null then execute format('alter table public.parcels drop constraint %I', c); end if;
end $$;
alter table public.parcels add constraint parcels_status_check check (status in ('reserved', 'active', 'released', 'revoked', 'covered'));

-- paid: at least 25 pixels (as before). free: 1 to 24, always land.
alter table public.parcels drop constraint parcels_min_area;
alter table public.parcels add constraint parcels_min_area check ((tier = 'paid' and w * h >= 25) or (tier = 'free' and w * h <= 24));
alter table public.parcels add constraint parcels_free_is_land check (tier <> 'free' or kind = 'land');

-- a covered parcel says when (it may be revoked afterwards, so the date stays)
alter table public.parcels add constraint parcels_covered_consistent check (status <> 'covered' or (covered_at is not null and covered_by is not null));

/* ------------------------------------------------------------------ the overlap guarantees, by tier */

alter table public.parcels drop constraint parcels_no_overlap_land;
alter table public.parcels drop constraint parcels_no_overlap_water;
alter table public.parcels add constraint parcels_no_overlap_land
  exclude using gist (bbox with &&) where (status in ('reserved', 'active') and kind = 'land' and tier = 'paid');
alter table public.parcels add constraint parcels_no_overlap_water
  exclude using gist (bbox with &&) where (status in ('reserved', 'active') and kind = 'water' and tier = 'paid');
alter table public.parcels add constraint parcels_no_overlap_free
  exclude using gist (bbox with &&) where (status = 'active' and tier = 'free');

create index parcels_free_owner_idx on public.parcels (owner_id) where tier = 'free';

/* ------------------------------------------------------------------ is the area free? (two questions, two functions) */

-- For a PURCHASE or a group project: free parcels do not count (a paid parcel covers them). This is the function the paid side has always called.
create or replace function public.px_is_area_free(p_x integer, p_y integer, p_w integer, p_h integer, p_kind text default 'land') returns boolean
language sql stable as $$
  select not exists (
    select 1 from public.parcels p
     where p.kind = p_kind and p.tier = 'paid'
       and p.bbox && box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8))
       and (p.status = 'active'
            or (p.status = 'reserved' and exists (
                 select 1 from public.parcel_reservations r
                  where r.parcel_id = p.id and r.status = 'held' and r.expires_at > now())))
  )
$$;
revoke all on function public.px_is_area_free(integer, integer, integer, integer, text) from public, anon, authenticated;

-- For a FREE parcel: nothing may be there, free or paid, active or held (an order being paid, a collecting project).
create or replace function public.px_is_area_free_of_all(p_x integer, p_y integer, p_w integer, p_h integer) returns boolean
language sql stable as $$
  select not exists (
    select 1 from public.parcels p
     where p.kind = 'land'
       and p.bbox && box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8))
       and (p.status = 'active'
            or (p.status = 'reserved' and exists (
                 select 1 from public.parcel_reservations r
                  where r.parcel_id = p.id and r.status = 'held' and r.expires_at > now())))
  )
$$;
revoke all on function public.px_is_area_free_of_all(integer, integer, integer, integer) from public, anon, authenticated;

/* ------------------------------------------------------------------ a paid parcel that becomes active covers the free ones it touches */

create or replace function public.px_cover_free_parcels() returns trigger language plpgsql as $$
begin
  if new.tier = 'paid' and new.kind = 'land' and new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    -- a creation of the covered parcel that was still waiting for moderation will never be shown: it leaves the queue
    update public.parcel_assets a set status = 'superseded'
     where a.status = 'pending'
       and a.parcel_id in (select f.id from public.parcels f where f.tier = 'free' and f.status = 'active' and f.kind = 'land' and f.bbox && new.bbox);
    update public.parcels f
       set status = 'covered', covered_at = now(), covered_by = new.id, updated_at = now()
     where f.tier = 'free' and f.status = 'active' and f.kind = 'land' and f.bbox && new.bbox;
  end if;
  return null;
end $$;

drop trigger if exists parcels_cover_free on public.parcels;
create trigger parcels_cover_free after insert or update of status on public.parcels
  for each row execute function public.px_cover_free_parcels();

/* ------------------------------------------------------------------ the settings */

insert into public.app_settings (key, value) values
  ('free_parcels_open', 'true'::jsonb),      -- the switch: an administrator can end the free period at any time
  ('free_parcels_days', '60'::jsonb),        -- the window, in days from the opening of the edition
  ('free_parcels_cap', '5000'::jsonb),       -- the most free parcels ever placed (moderation and storage are not free)
  ('free_max_area', '24'::jsonb),            -- the biggest free parcel, in pixels (and always below the smallest paid one)
  ('free_lifetime_max', '3'::jsonb)          -- the most placements per account, over the whole edition
on conflict (key) do nothing;

create or replace function public.px_set_setting(p_actor uuid, p_key text, p_value jsonb) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  if p_key not in ('price_unit_cents', 'price_unit_cents_usd', 'min_area', 'max_area', 'reservation_ttl_minutes', 'max_active_reservations_per_user', 'sales_open',
                   'sea_price_percent', 'min_land_percent', 'water_price_percent', 'min_water_percent', 'land_cut_price_percent',
                   'campaign_min_area', 'campaign_min_contribution_cents',
                   'free_parcels_open', 'free_parcels_days', 'free_parcels_cap', 'free_max_area', 'free_lifetime_max') then
    raise exception 'px_bad_setting';
  end if;
  if p_key in ('sales_open', 'free_parcels_open') then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'px_bad_setting'; end if;
  else
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)
       or (p_value #>> '{}')::numeric < (case when p_key in ('sea_price_percent', 'land_cut_price_percent') then 0 else 1 end) then raise exception 'px_bad_setting'; end if;
    if p_key in ('sea_price_percent', 'min_land_percent', 'min_water_percent', 'land_cut_price_percent') and (p_value #>> '{}')::numeric > 100 then raise exception 'px_bad_setting'; end if;
    if p_key = 'water_price_percent' and (p_value #>> '{}')::numeric > 1000 then raise exception 'px_bad_setting'; end if;
    if p_key in ('min_area', 'campaign_min_area') and (p_value #>> '{}')::numeric < 25 then raise exception 'px_bad_setting'; end if;
    if p_key = 'max_area' and (p_value #>> '{}')::numeric > 1000000 then raise exception 'px_bad_setting'; end if;
    if p_key = 'reservation_ttl_minutes' and (p_value #>> '{}')::numeric < 32 then raise exception 'px_bad_setting'; end if;
    -- below 50 cents a contribution would cost more in payment fees than it brings
    if p_key = 'campaign_min_contribution_cents' and (p_value #>> '{}')::numeric < 50 then raise exception 'px_bad_setting'; end if;
    -- the free period: a window of a year at most, a cap of a million at most, never as big as the smallest paid parcel, a handful of tries per account
    if p_key = 'free_parcels_days' and (p_value #>> '{}')::numeric > 366 then raise exception 'px_bad_setting'; end if;
    if p_key = 'free_parcels_cap' and (p_value #>> '{}')::numeric > 1000000 then raise exception 'px_bad_setting'; end if;
    if p_key = 'free_max_area' and (p_value #>> '{}')::numeric > 24 then raise exception 'px_bad_setting'; end if;
    if p_key = 'free_lifetime_max' and (p_value #>> '{}')::numeric > 10 then raise exception 'px_bad_setting'; end if;
  end if;
  update public.app_settings set value = p_value, updated_by = p_actor, updated_at = now() where key = p_key;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'setting.update', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

/* ------------------------------------------------------------------ where the free period stands, for the site and for one account */

-- `reason` is why nobody can place a free parcel right now (null: it is open); `userReason` is why THIS account cannot (null: it can).
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
begin
  select * into e from public.editions order by created_at limit 1;
  v_ends := case when e.opens_at is null then null else e.opens_at + make_interval(days => v_days) end;
  select count(*) into v_placed from public.parcels where tier = 'free' and status in ('active', 'covered', 'revoked');
  v_reason := case
    when public.px_edition_state() <> 'open' then 'edition'
    when not v_on then 'off'
    when v_ends is null or clock_timestamp() >= v_ends then 'ended'
    when v_placed >= v_cap then 'full'
    else null end;
  if p_user is not null then
    select count(*) into v_used from public.parcels where owner_id = p_user and tier = 'free' and status in ('active', 'covered', 'revoked');
    v_user := case
      when exists (select 1 from public.parcels where owner_id = p_user and tier = 'free' and status = 'active') then 'standing'
      when v_used >= v_life then 'lifetime'
      else null end;
  end if;
  return jsonb_build_object('open', v_reason is null, 'reason', v_reason, 'endsAt', v_ends, 'maxArea', v_max, 'cap', v_cap, 'placed', v_placed,
                            'userReason', v_user, 'used', v_used, 'lifetimeMax', v_life);
end $$;
revoke all on function public.px_free_status(uuid) from public, anon, authenticated;

/* ------------------------------------------------------------------ placing a free parcel */

-- `p_land` is the number of LAND pixels of the rectangle, counted by the application server (null = all land), as for a purchase.
-- The parcel is active at once; its creation arrives right after (`px_add_asset`) and waits for moderation like any other.
create or replace function public.px_place_free_parcel(p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer, p_land integer default null)
returns table (parcel_id uuid, code text)
language plpgsql as $$
#variable_conflict use_column
declare
  v_profile public.profiles;
  v_st jsonb;
  v_max integer;
  v_land integer := coalesce(p_land, p_w * p_h);
  v_minshare bigint := public.px_setting_int('min_land_percent');
  v_id uuid;
  v_code text;
begin
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
  if v_land < 1 or v_land::bigint * 100 < (p_w::bigint * p_h) * v_minshare then raise exception 'px_not_on_land'; end if;

  perform public.px_lock_tiles(p_x, p_y, p_w, p_h);
  perform public.px_release_expired_overlapping(box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8)));
  if not public.px_is_area_free_of_all(p_x, p_y, p_w, p_h) then raise exception 'px_parcel_unavailable'; end if;

  for i in 1 .. 5 loop
    begin
      insert into public.parcels (owner_id, x, y, w, h, status, land_px, kind, tier, activated_at)
      values (p_user, p_x, p_y, p_w, p_h, 'active', v_land, 'land', 'free', now())
      returning parcels.id, parcels.code into v_id, v_code;
      exit;
    exception
      when exclusion_violation then raise exception 'px_parcel_unavailable';
      when unique_violation then if i = 5 then raise; end if;   -- public code collision (astronomically rare): draw another code
    end;
  end loop;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'user', 'free_parcel.place', 'parcel', v_id::text, jsonb_build_object('area', p_w * p_h, 'x', p_x, 'y', p_y));
  return query select v_id, v_code;
end $$;
revoke all on function public.px_place_free_parcel(uuid, integer, integer, integer, integer, integer) from public, anon, authenticated;

-- Gives a free parcel back when its creation could not be stored (the upload failed): the slot is free again and the placement does not count.
create or replace function public.px_cancel_free_parcel(p_user uuid, p_parcel uuid) returns void
language plpgsql as $$
begin
  update public.parcels set status = 'released', released_at = now(), updated_at = now()
   where id = p_parcel and owner_id = p_user and tier = 'free' and status = 'active' and published_asset_id is null;
end $$;
revoke all on function public.px_cancel_free_parcel(uuid, uuid) from public, anon, authenticated;

/* ------------------------------------------------------------------ the public counters: sold pixels are paid parcels; the free ones apart */

drop function public.px_public_stats();
create function public.px_public_stats()
returns table (sold_pixels bigint, parcels bigint, owners bigint, published_creations bigint, map_version bigint, water_pixels bigint, water_parcels bigint,
               free_parcels bigint, free_pixels bigint)
language sql stable as $$
  select coalesce(sum(p.owned_px) filter (where p.tier = 'paid'), 0)::bigint,
         count(*) filter (where p.tier = 'paid')::bigint,
         count(distinct p.owner_id) filter (where p.tier = 'paid')::bigint,
         count(*) filter (where p.published_asset_id is not null and p.hidden_at is null)::bigint,
         (select version from public.map_state where id = 1),
         coalesce(sum(p.owned_px) filter (where p.kind = 'water' and p.tier = 'paid'), 0)::bigint,
         count(*) filter (where p.kind = 'water' and p.tier = 'paid')::bigint,
         count(*) filter (where p.tier = 'free')::bigint,
         coalesce(sum(p.owned_px) filter (where p.tier = 'free'), 0)::bigint
    from public.parcels p where p.status = 'active'
$$;
revoke all on function public.px_public_stats() from public, anon, authenticated;
