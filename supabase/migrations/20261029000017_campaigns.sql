-- "Fund it together", step 1: a parcel that SEVERAL people pay for (a "campaign").
--
-- Somebody who cannot afford a big parcel designs it (same editor as a purchase), gives it a title, a description and a duration (7, 14
-- or 30 days) and sends it to moderation: nothing is paid and nothing is held yet. A moderator approves it (the zone is then RESERVED for
-- the duration, as an unpaid purchase would hold it, but longer) or rejects it with a reason. Contributions and the end of a campaign
-- (funded, expired, refunds) come in the next steps; this migration only creates the project and its moderation.
--
-- * `campaigns`: the project. Its creation (image) is stored as sent and becomes the parcel's first APPROVED creation when the
--   campaign opens (the moderator saw it): it is published when the parcel is paid for, with no second review.
-- * One active (pending or open) campaign per creator: the partial unique index is the guarantee, the function gives the clean error.
-- * The price is computed here, like an order's (same settings, same land/water rules). The goal is the price of the parcel, frozen.
-- * Settings (admin): `campaign_min_area` (smallest parcel that can be funded together, default 10 000 px) and
--   `campaign_min_contribution_cents` (smallest contribution, default 200 = 2 € / 2 $, used from the next step on).

insert into public.app_settings (key, value) values
  ('campaign_min_area',               '10000'::jsonb),
  ('campaign_min_contribution_cents', '200'::jsonb)
on conflict (key) do nothing;

create or replace function public.px_set_setting(p_actor uuid, p_key text, p_value jsonb) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  if p_key not in ('price_unit_cents', 'price_unit_cents_usd', 'min_area', 'max_area', 'reservation_ttl_minutes', 'max_active_reservations_per_user', 'sales_open',
                   'sea_price_percent', 'min_land_percent', 'water_price_percent', 'min_water_percent', 'land_cut_price_percent',
                   'campaign_min_area', 'campaign_min_contribution_cents') then
    raise exception 'px_bad_setting';
  end if;
  if p_key = 'sales_open' then
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
  end if;
  update public.app_settings set value = p_value, updated_by = p_actor, updated_at = now() where key = p_key;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'setting.update', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default public.px_short_code(),
  creator_id    uuid not null references public.profiles (id) on delete restrict,
  -- the parcel held for the campaign: set when it opens
  parcel_id     uuid references public.parcels (id) on delete set null,
  kind          text not null default 'land' check (kind in ('land', 'water')),
  x integer not null, y integer not null, w integer not null, h integer not null,
  area          integer generated always as (w * h) stored,
  land_px       integer,
  currency      text not null,
  unit_price_cents integer not null check (unit_price_cents > 0),
  goal_cents    bigint not null check (goal_cents > 0),
  duration_days integer not null check (duration_days in (7, 14, 30)),
  -- the creation, as sent
  storage_path  text not null,
  content_hash  text not null,
  width         integer not null,
  height        integer not null,
  bytes         integer not null,
  avg_color     char(7) not null check (avg_color ~ '^#[0-9a-f]{6}$'),
  title         text not null check (char_length(title) between 1 and 80),
  description   text check (description is null or char_length(description) <= 280),
  link_url      text check (link_url is null or (char_length(link_url) <= 500 and link_url ~ '^https://')),
  is_commercial boolean not null default false,
  -- pending: waits for a moderator · open: zone held, contributions welcome · funded: goal reached, parcel bought
  -- expired: deadline passed without the goal · cancelled: withdrawn by its creator · rejected: refused by moderation
  status        text not null default 'pending' check (status in ('pending', 'open', 'funded', 'expired', 'cancelled', 'rejected')),
  rejection_reason text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  opens_at      timestamptz,
  deadline      timestamptz,
  funded_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint campaigns_geometry check (x >= 0 and y >= 0 and w >= 1 and h >= 1 and w <= 1000 and h <= 1000 and w::bigint * h <= 1000000),
  constraint campaigns_open_has_parcel check (status not in ('open', 'funded') or (parcel_id is not null and deadline is not null))
);
create unique index campaigns_one_active_per_creator on public.campaigns (creator_id) where status in ('pending', 'open');
create index campaigns_queue_idx on public.campaigns (created_at) where status = 'pending';
create index campaigns_open_deadline_idx on public.campaigns (deadline) where status = 'open';
create index campaigns_creator_idx on public.campaigns (creator_id, created_at desc);

-- Nothing here is reachable through the browser's keys: every read and write goes through the server (public data is served by the API).
alter table public.campaigns enable row level security;
revoke all on table public.campaigns from anon, authenticated;

/* ------------------------------------------------------------------ creating a campaign */

-- Validates, prices (from app_settings, never from the client) and records a PENDING campaign. Nothing is held: the zone is only
-- checked to be free right now, as a courtesy (the real guarantee is taken when a moderator approves).
create or replace function public.px_create_campaign(
  p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer, p_land integer, p_currency text, p_kind text, p_days integer,
  p_storage_path text, p_hash text, p_width integer, p_height integer, p_bytes integer, p_avg_color text,
  p_title text, p_description text, p_link text, p_commercial boolean)
returns table (id uuid, code text, goal_cents bigint, currency text)
language plpgsql as $$
declare
  v_profile public.profiles;
  v_base text := lower((select value #>> '{}' from public.app_settings where key = 'currency'));
  v_cur text := lower(coalesce(nullif(trim(p_currency), ''), (select value #>> '{}' from public.app_settings where key = 'currency')));
  v_unit integer;
  v_min bigint := public.px_setting_int('campaign_min_area');
  v_max bigint := public.px_setting_int('max_area');
  v_water boolean := (p_kind = 'water');
  v_land integer := coalesce(p_land, p_w * p_h);
  v_owned integer;
  v_cut integer;
  v_wp integer := public.px_setting_int('water_price_percent');
  v_minshare integer;
  v_amount bigint;
  v_k integer;
  v_id uuid;
  v_code text;
  v_constraint text;
begin
  if p_kind is null or p_kind not in ('land', 'water') then raise exception 'px_invalid_rect'; end if;
  if p_days is null or p_days not in (7, 14, 30) then raise exception 'px_invalid_campaign'; end if;
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sales_open'), false) is not true then
    raise exception 'px_sales_closed';
  end if;
  if v_cur = v_base then v_unit := public.px_setting_int('price_unit_cents');
  elsif v_cur = 'usd' then v_unit := public.px_setting_int('price_unit_cents_usd');
  else raise exception 'px_bad_currency';
  end if;
  select * into v_profile from public.profiles where profiles.id = p_user;
  if not found or v_profile.deleted_at is not null then raise exception 'px_no_profile'; end if;
  if v_profile.status <> 'active' then raise exception 'px_account_suspended'; end if;
  if p_w is null or p_h is null or p_x is null or p_y is null
     or p_w < 1 or p_h < 1 or p_x < 0 or p_y < 0
     or p_x + p_w > public.px_grid_width() or p_y + p_h > public.px_grid_height()
     or p_w > 1000 or p_h > 1000 then
    raise exception 'px_invalid_rect';
  end if;
  -- a campaign is for BIG parcels: below this area one pays alone
  if p_w::bigint * p_h < v_min then raise exception 'px_campaign_too_small'; end if;
  if p_w::bigint * p_h > v_max then raise exception 'px_invalid_rect'; end if;
  if v_land < 0 or v_land > p_w * p_h then raise exception 'px_not_on_land'; end if;
  -- the image is the parcel's size times a whole scale k (see px_add_asset)
  v_k := p_width / p_w;
  if p_width % p_w <> 0 or v_k < 1 or v_k > public.px_dot_scale(p_w, p_h) or p_height <> p_h * v_k then raise exception 'px_bad_dimensions'; end if;

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
  if v_amount < 1 or v_amount > 99999999 then raise exception 'px_invalid_rect'; end if;

  if exists (select 1 from public.campaigns c where c.creator_id = p_user and c.status in ('pending', 'open')) then
    raise exception 'px_campaign_already_active';
  end if;
  if not public.px_is_area_free(p_x, p_y, p_w, p_h, p_kind) then raise exception 'px_parcel_unavailable'; end if;

  for i in 1 .. 5 loop
    begin
      insert into public.campaigns (creator_id, kind, x, y, w, h, land_px, currency, unit_price_cents, goal_cents, duration_days,
                                    storage_path, content_hash, width, height, bytes, avg_color, title, description, link_url, is_commercial)
      values (p_user, p_kind, p_x, p_y, p_w, p_h, v_land, v_cur, v_unit, v_amount, p_days,
              p_storage_path, p_hash, p_width, p_height, p_bytes, p_avg_color, p_title, p_description, p_link, coalesce(p_commercial, false))
      returning campaigns.id, campaigns.code into v_id, v_code;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'campaigns_one_active_per_creator' then raise exception 'px_campaign_already_active'; end if;
      if i = 5 then raise; end if;   -- public code collision (astronomically rare): draw another code
    end;
  end loop;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'user', 'campaign.create', 'campaign', v_id::text, jsonb_build_object('goal_cents', v_amount, 'currency', v_cur, 'area', p_w * p_h, 'days', p_days));
  return query select v_id, v_code, v_amount, v_cur;
end $$;
revoke all on function public.px_create_campaign(uuid, integer, integer, integer, integer, integer, text, text, integer, text, text, integer, integer, integer, text, text, text, text, boolean) from public, anon, authenticated;

/* ------------------------------------------------------------------ moderation */

-- A moderator approves (the zone is held until the deadline and the project opens) or rejects (with a reason). The creation was seen
-- by the moderator: it becomes the parcel's first APPROVED version, published when the parcel is paid for.
create or replace function public.px_review_campaign(p_actor uuid, p_campaign uuid, p_decision text, p_reason text default null) returns text
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor);
  c public.campaigns;
  a public.parcel_assets;
  v_parcel uuid;
  v_expires timestamptz;
  v_box box;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'px_bad_decision'; end if;
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception 'px_not_found'; end if;
  if c.status <> 'pending' then raise exception 'px_not_pending'; end if;

  if p_decision = 'reject' then
    update public.campaigns
       set status = 'rejected', rejection_reason = p_reason, reviewed_by = p_actor, reviewed_at = now(), closed_at = now(), updated_at = now()
     where id = c.id;
  else
    if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sales_open'), false) is not true then
      raise exception 'px_sales_closed';
    end if;
    if (select status from public.profiles where id = c.creator_id) <> 'active' then raise exception 'px_account_suspended'; end if;
    v_box := box(point(c.x::float8, c.y::float8), point((c.x + c.w - 1)::float8, (c.y + c.h - 1)::float8));
    perform public.px_lock_tiles(c.x, c.y, c.w, c.h);
    perform public.px_release_expired_overlapping(v_box);
    v_expires := now() + make_interval(days => c.duration_days);
    for i in 1 .. 5 loop
      begin
        insert into public.parcels (owner_id, x, y, w, h, status, land_px, kind)
        values (c.creator_id, c.x, c.y, c.w, c.h, 'reserved', c.land_px, c.kind) returning id into v_parcel;
        exit;
      exception
        when exclusion_violation then raise exception 'px_parcel_unavailable';
        when unique_violation then if i = 5 then raise; end if;
      end;
    end loop;
    insert into public.parcel_reservations (parcel_id, user_id, order_id, expires_at) values (v_parcel, c.creator_id, null, v_expires);
    a := public.px_add_asset(c.creator_id, v_parcel, c.storage_path, c.content_hash, c.width, c.height, c.bytes, c.avg_color,
                             c.title, c.description, c.link_url, c.is_commercial);
    update public.parcel_assets set status = 'approved', reviewed_by = p_actor, reviewed_at = now() where id = a.id;
    update public.campaigns
       set status = 'open', parcel_id = v_parcel, reviewed_by = p_actor, reviewed_at = now(), opens_at = now(), deadline = v_expires, updated_at = now()
     where id = c.id;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'campaign.' || p_decision, 'campaign', c.id::text, jsonb_build_object('creator_id', c.creator_id, 'reason', p_reason));
  return p_decision;
end $$;
revoke all on function public.px_review_campaign(uuid, uuid, text, text) from public, anon, authenticated;

/* ------------------------------------------------------------------ cancelling */

-- The creator withdraws a project that is waiting for moderation or open. (Once contributions exist, the next step refunds them first.)
create or replace function public.px_cancel_campaign(p_user uuid, p_campaign uuid) returns text
language plpgsql as $$
declare c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or c.creator_id <> p_user then raise exception 'px_not_found'; end if;
  if c.status not in ('pending', 'open') then raise exception 'px_not_cancellable'; end if;
  if c.status = 'open' and c.parcel_id is not null then
    update public.parcel_reservations set status = 'canceled', resolved_at = now() where parcel_id = c.parcel_id and status = 'held';
    update public.parcels set status = 'released', released_at = now() where id = c.parcel_id and status = 'reserved';
  end if;
  update public.campaigns set status = 'cancelled', closed_at = now(), updated_at = now() where id = c.id;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'user', 'campaign.cancel', 'campaign', c.id::text, jsonb_build_object('was', c.status));
  return 'cancelled';
end $$;
revoke all on function public.px_cancel_campaign(uuid, uuid) from public, anon, authenticated;

/* ------------------------------------------------------------------ the end of the time */

-- Hygiene job (cron): an open project whose deadline has passed is over; its zone is given back. (The next step refunds the
-- contributions before a project is closed this way; until money can be contributed there is nothing to refund.)
create or replace function public.px_expire_campaigns(p_limit integer default 100) returns integer
language plpgsql as $$
declare n integer;
begin
  with due as (
    select id, parcel_id from public.campaigns where status = 'open' and deadline <= now() order by deadline limit p_limit for update skip locked
  ), res as (
    update public.parcel_reservations r set status = 'expired', resolved_at = now()
      from due where r.parcel_id = due.parcel_id and r.status = 'held' returning r.id
  ), par as (
    update public.parcels p set status = 'released', released_at = now()
      from due where p.id = due.parcel_id and p.status = 'reserved' returning p.id
  ), upd as (
    update public.campaigns c set status = 'expired', closed_at = now(), updated_at = now()
      from due where c.id = due.id returning c.id
  )
  select count(*) into n from upd;
  return coalesce(n, 0);
end $$;
revoke all on function public.px_expire_campaigns(integer) from public, anon, authenticated;
