-- Editions: the 100 days live in the database, and the database alone decides what is open and what is frozen.
--
-- Until now the end of the sales was only checked by the web application, from an environment variable (NEXT_PUBLIC_WORLD_END_AT), and
-- nothing stopped a creation from being edited after the end. From here on:
--
--   * one row of `editions` (the founding edition) holds the state: `prelaunch` (no date, nothing sold), `open` (opens_at + 100 days =
--     closes_at), `closed`. It is created in `prelaunch`, with NO date: the 100 days never start by themselves. Only an administrator opens
--     the edition (px_edition_open, confirmed by typing its name, written to the audit log).
--   * the state is COMPUTED from the clock at every call (px_edition_state): at closes_at nothing can be bought or reserved, even if the
--     scheduled job never runs. The job (px_edition_sweep) only records what the clock already decided: it ends the open group projects,
--     and once the payments that were already under way have had the reservation delay to finish, it takes the historical snapshot
--     (edition_snapshots, append-only) and marks the edition `closed`.
--   * a payment started before the closing may finish during that delay; after it, px_fulfill_order refunds instead of activating. The
--     creations (new versions, collaborative drawing, comments, likes) are frozen from the same moment (px_edition_is_frozen).
--   * a single edition can exist (unique index): nothing creates a second one by itself. Lifting that is a deliberate future migration.
--
-- Additive and non-destructive: new tables, one new nullable column (back-filled), existing functions re-created with ONE added guard line
-- each (their bodies are otherwise the ones of migrations 2–18; privileges are kept by CREATE OR REPLACE).
--
-- ROLLBACK (if ever needed, in this order; no data of the shop is lost, only the edition state and snapshots):
--   drop trigger if exists parcel_likes_edition_guard on public.parcel_likes;
--   drop trigger if exists parcels_set_edition on public.parcels;
--   re-apply the earlier bodies of px_start_order (15), px_fulfill_order (2), px_add_asset (11), px_collab_paint/reset/enable (9),
--     px_comment_add (the comments migration), px_create_campaign, px_review_campaign, px_start_contribution, px_fulfill_contribution (17/18);
--   alter table public.parcels drop column if exists edition_id;
--   drop function if exists public.px_edition_sweep(), public.px_edition_take_snapshot(uuid), public.px_edition_build_snapshot(uuid, uuid),
--     public.px_edition_end_campaigns(), public.px_edition_reset(uuid, text), public.px_edition_extend(uuid, timestamptz, text),
--     public.px_edition_close_now(uuid, text), public.px_edition_open(uuid, text), public.px_edition_info(),
--     public.px_guard_edition_editable(), public.px_assert_edition_editable(), public.px_assert_edition_open(),
--     public.px_edition_is_frozen(timestamptz), public.px_edition_state(timestamptz), public.px_parcels_set_edition();
--   drop table if exists public.edition_snapshots; drop table if exists public.editions;

create table if not exists public.editions (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  name          text not null check (char_length(name) between 1 and 80),
  status        text not null default 'prelaunch' check (status in ('prelaunch', 'open', 'closed')),
  duration_days integer not null default 100 check (duration_days between 1 and 366),
  opens_at      timestamptz,
  closes_at     timestamptz,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  constraint editions_dates check (
       (status = 'prelaunch' and opens_at is null and closes_at is null and closed_at is null)
    or (status = 'open'      and opens_at is not null and closes_at is not null and closes_at > opens_at and closed_at is null)
    or (status = 'closed'    and opens_at is not null and closes_at is not null and closes_at > opens_at and closed_at is not null))
);
comment on table public.editions is 'The editions of the archive (today: the founding one). status prelaunch|open|closed; the dates stay empty until an administrator opens it.';
-- ONE edition for now. Nothing creates another one automatically; a second edition is a decision and a migration that drops this index.
create unique index if not exists editions_only_one_for_now on public.editions ((true));
alter table public.editions enable row level security;
revoke all on table public.editions from anon, authenticated;
insert into public.editions (slug, name) values ('fondatrice', 'Édition fondatrice') on conflict do nothing;

-- The historical snapshots: a manifest of what the public could see, with its sha256. Append-only (a retraction makes a NEW revision).
create table if not exists public.edition_snapshots (
  id            uuid primary key default gen_random_uuid(),
  edition_id    uuid not null references public.editions (id) on delete restrict,
  revision      integer not null check (revision >= 1),
  taken_at      timestamptz not null default now(),
  taken_by      uuid,
  parcel_count  integer not null check (parcel_count >= 0),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  manifest      jsonb not null,
  unique (edition_id, revision)
);
comment on table public.edition_snapshots is 'Append-only historical snapshots of an edition (manifest of the parcels and creations, with sha256).';
create trigger edition_snapshots_append_only before update or delete on public.edition_snapshots
  for each row execute function public.px_forbid_mutation();
alter table public.edition_snapshots enable row level security;
revoke all on table public.edition_snapshots from anon, authenticated;

-- Every parcel belongs to an edition (today there is only the founding one): new rows get it by default, existing rows are back-filled.
alter table public.parcels add column if not exists edition_id uuid references public.editions (id) on delete restrict;
create or replace function public.px_parcels_set_edition() returns trigger language plpgsql as $$
begin
  if new.edition_id is null then new.edition_id := (select id from public.editions order by created_at limit 1); end if;
  return new;
end $$;
drop trigger if exists parcels_set_edition on public.parcels;
create trigger parcels_set_edition before insert on public.parcels for each row execute function public.px_parcels_set_edition();
update public.parcels set edition_id = (select id from public.editions order by created_at limit 1) where edition_id is null;

/* ------------------------------------------------------------------ the state, computed from the clock */

-- 'prelaunch' | 'open' | 'closed'. 'closed' from closes_at on (the instant of the clock, not of the transaction: clock_timestamp()).
create or replace function public.px_edition_state(p_now timestamptz default clock_timestamp()) returns text
language sql stable as $$
  select coalesce((select case when e.status = 'prelaunch' then 'prelaunch'
                               when e.status = 'closed' or p_now >= e.closes_at then 'closed'
                               else 'open' end
                     from public.editions e order by e.created_at limit 1), 'prelaunch')
$$;

-- The creations are frozen once the payments under way have had the reservation delay to finish (and always once the edition is closed).
create or replace function public.px_edition_is_frozen(p_now timestamptz default clock_timestamp()) returns boolean
language sql stable as $$
  select coalesce((select e.status = 'closed'
                          or (e.status = 'open' and p_now >= e.closes_at + make_interval(mins => public.px_setting_int('reservation_ttl_minutes')::integer))
                     from public.editions e order by e.created_at limit 1), false)
$$;

create or replace function public.px_assert_edition_open() returns void language plpgsql stable as $$
declare s text := public.px_edition_state();
begin
  if s = 'prelaunch' then raise exception 'px_edition_not_open'; end if;
  if s = 'closed' then raise exception 'px_edition_closed'; end if;
end $$;

create or replace function public.px_assert_edition_editable() returns void language plpgsql stable as $$
begin
  if public.px_edition_is_frozen() then raise exception 'px_edition_frozen'; end if;
end $$;

-- Likes are written by the browser roles directly (row-level security lets a user manage their own), so the guard has to be a trigger and
-- has to run with the rights of its owner (the browser roles may not call the px_ functions). INSERT is refused once the edition is
-- frozen; so is a user's own DELETE (an "unlike" changes the ranking too). A delete made by a cascade (the account is removed) is a trigger
-- inside a trigger (pg_trigger_depth() > 1) and always goes through.
create or replace function public.px_guard_edition_editable() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() <= 1 and public.px_edition_is_frozen() then raise exception 'px_edition_frozen'; end if;
    return old;
  end if;
  if public.px_edition_is_frozen() then raise exception 'px_edition_frozen'; end if;
  return new;
end $$;
drop trigger if exists parcel_likes_edition_guard on public.parcel_likes;
create trigger parcel_likes_edition_guard before insert or delete on public.parcel_likes for each row execute function public.px_guard_edition_editable();

-- What the public pages and the back office read (one JSON object; dates in ISO form).
create or replace function public.px_edition_info() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'name', e.name, 'status', e.status,
    'state', public.px_edition_state(), 'frozen', public.px_edition_is_frozen(),
    'durationDays', e.duration_days, 'opensAt', e.opens_at, 'closesAt', e.closes_at, 'closedAt', e.closed_at,
    'settlesAt', case when e.closes_at is null then null else e.closes_at + make_interval(mins => public.px_setting_int('reservation_ttl_minutes')::integer) end,
    'serverNow', clock_timestamp(),
    'snapshot', (select jsonb_build_object('revision', s.revision, 'takenAt', s.taken_at, 'parcelCount', s.parcel_count, 'hash', s.manifest_hash)
                   from public.edition_snapshots s where s.edition_id = e.id order by s.revision desc limit 1))
    from public.editions e order by e.created_at limit 1
$$;

/* ------------------------------------------------------------------ what an administrator can do (all audited) */

create or replace function public.px_edition_open(p_actor uuid, p_confirm text) returns jsonb
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor, 'admin');
  e public.editions;
  v_now timestamptz := clock_timestamp();
begin
  select * into e from public.editions order by created_at limit 1 for update;
  if not found then raise exception 'px_not_found'; end if;
  if e.status <> 'prelaunch' then raise exception 'px_edition_bad_state'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(e.name) then raise exception 'px_edition_confirm_mismatch'; end if;
  update public.editions set status = 'open', opens_at = v_now, closes_at = v_now + make_interval(days => e.duration_days) where id = e.id;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'edition.open', 'edition', e.id::text,
          jsonb_build_object('opens_at', v_now, 'closes_at', v_now + make_interval(days => e.duration_days), 'duration_days', e.duration_days));
  return public.px_edition_info();
end $$;

-- Closes the sales now (the clock decides from then on); the creations freeze after the reservation delay, the snapshot follows.
create or replace function public.px_edition_close_now(p_actor uuid, p_confirm text) returns jsonb
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor, 'admin');
  e public.editions;
  v_now timestamptz := clock_timestamp();
  v_to timestamptz;
begin
  select * into e from public.editions order by created_at limit 1 for update;
  if not found then raise exception 'px_not_found'; end if;
  if e.status <> 'open' or v_now >= e.closes_at then raise exception 'px_edition_bad_state'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(e.name) then raise exception 'px_edition_confirm_mismatch'; end if;
  v_to := greatest(v_now, e.opens_at + interval '1 second');
  update public.editions set closes_at = v_to where id = e.id;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'edition.close_now', 'edition', e.id::text, jsonb_build_object('closes_at_before', e.closes_at, 'closes_at', v_to));
  return public.px_edition_info();
end $$;

-- Postpones the closing (never brings it forward, never beyond 366 days after the opening). Only while the edition is still open.
create or replace function public.px_edition_extend(p_actor uuid, p_new_closes_at timestamptz, p_note text default null) returns jsonb
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor, 'admin');
  e public.editions;
begin
  select * into e from public.editions order by created_at limit 1 for update;
  if not found then raise exception 'px_not_found'; end if;
  if e.status <> 'open' or clock_timestamp() >= e.closes_at then raise exception 'px_edition_bad_state'; end if;
  if p_new_closes_at is null or p_new_closes_at <= e.closes_at or p_new_closes_at > e.opens_at + interval '366 days' then raise exception 'px_edition_bad_date'; end if;
  update public.editions set closes_at = p_new_closes_at where id = e.id;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'edition.extend', 'edition', e.id::text,
          jsonb_build_object('closes_at_before', e.closes_at, 'closes_at', p_new_closes_at, 'note', left(coalesce(p_note, ''), 300)));
  return public.px_edition_info();
end $$;

-- Back to pre-launch, for a REHEARSAL on a site that sold nothing: refused as soon as a parcel is reserved or bought, or any payment was made.
create or replace function public.px_edition_reset(p_actor uuid, p_confirm text) returns jsonb
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor, 'admin');
  e public.editions;
begin
  select * into e from public.editions order by created_at limit 1 for update;
  if not found then raise exception 'px_not_found'; end if;
  if e.status <> 'open' then raise exception 'px_edition_bad_state'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(e.name) then raise exception 'px_edition_confirm_mismatch'; end if;
  if exists (select 1 from public.parcels where status in ('reserved', 'active'))
     or exists (select 1 from public.orders where paid_at is not null)
     or exists (select 1 from public.contributions where paid_at is not null)
     or exists (select 1 from public.edition_snapshots where edition_id = e.id) then
    raise exception 'px_edition_not_empty';
  end if;
  update public.editions set status = 'prelaunch', opens_at = null, closes_at = null, closed_at = null where id = e.id;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'edition.reset', 'edition', e.id::text, jsonb_build_object('opens_at_before', e.opens_at, 'closes_at_before', e.closes_at));
  return public.px_edition_info();
end $$;

/* ------------------------------------------------------------------ the closing: group projects, snapshot */

-- The group projects still collecting end with the edition (a contribution is a purchase): expired, everybody is flagged for a refund.
create or replace function public.px_edition_end_campaigns() returns integer
language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id, x, y, w, h from public.campaigns where status = 'open' order by deadline loop
    perform public.px_lock_tiles(r.x, r.y, r.w, r.h);
    perform 1 from public.campaigns where id = r.id and status = 'open' for update skip locked;
    if found then
      perform public.px_close_campaign(r.id, 'expired');
      n := n + 1;
    end if;
  end loop;
  -- the projects still waiting for a moderator can no longer be approved: they are closed with a reason the creator can read
  update public.campaigns
     set status = 'rejected', closed_at = clock_timestamp(), updated_at = clock_timestamp(),
         rejection_reason = 'The edition closed before this project could be reviewed. / L''édition s''est close avant l''examen de ce projet.'
   where status = 'pending';
  return n;
end $$;

-- A new revision of the snapshot: what the public could see (active, visible parcels of visible owners, with their approved creation),
-- as a manifest ordered by code, with the sha256 of the manifest text. Returns the revision number.
create or replace function public.px_edition_build_snapshot(p_edition uuid, p_actor uuid) returns integer
language plpgsql as $$
declare
  v_manifest jsonb;
  v_count integer;
  v_rev integer;
begin
  select coalesce(jsonb_agg(q.item order by q.code), '[]'::jsonb), count(*)::integer into v_manifest, v_count
    from (
      select p.code,
             jsonb_build_object(
               'code', p.code, 'x', p.x, 'y', p.y, 'w', p.w, 'h', p.h, 'kind', p.kind,
               'author', pr.username, 'activated_at', p.activated_at,
               'creation', case when a.id is null then null else jsonb_build_object(
                  'asset_id', a.id, 'version', a.version, 'content_hash', a.content_hash, 'storage_path', a.storage_path,
                  'width', a.width, 'height', a.height, 'title', a.title, 'description', a.description, 'published_at', a.published_at) end) as item
        from public.parcels p
        join public.profiles pr on pr.id = p.owner_id
        left join public.parcel_assets a on a.id = p.published_asset_id and a.status = 'approved'
       where p.status = 'active' and p.hidden_at is null and pr.status = 'active' and pr.deleted_at is null
    ) q;
  select coalesce(max(revision), 0) + 1 into v_rev from public.edition_snapshots where edition_id = p_edition;
  insert into public.edition_snapshots (edition_id, revision, taken_by, parcel_count, manifest_hash, manifest)
  values (p_edition, v_rev, p_actor, v_count, encode(sha256(convert_to(v_manifest::text, 'UTF8')), 'hex'), v_manifest);
  return v_rev;
end $$;

-- A new revision after the edition is closed (a retraction, a creation that moderation approved late). Never rewrites an earlier one.
create or replace function public.px_edition_take_snapshot(p_actor uuid) returns jsonb
language plpgsql as $$
declare
  v_role text := public.px_require_staff(p_actor, 'admin');
  e public.editions;
  v_rev integer;
begin
  select * into e from public.editions order by created_at limit 1 for update;
  if not found then raise exception 'px_not_found'; end if;
  if e.status <> 'closed' then raise exception 'px_edition_bad_state'; end if;
  v_rev := public.px_edition_build_snapshot(e.id, p_actor);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'edition.snapshot', 'edition', e.id::text, jsonb_build_object('revision', v_rev));
  return public.px_edition_info();
end $$;

-- Run by the scheduled job (and when an administrator opens the page): records what the clock already decided. Idempotent.
--   'idle'      nothing is due        'closing'   the sales are over, the payments under way are still settling
--   'finalized' the snapshot is taken and the edition is marked closed (once)
create or replace function public.px_edition_sweep() returns text
language plpgsql as $$
declare
  e public.editions;
  v_now timestamptz := clock_timestamp();
  v_settle timestamptz;
  v_rev integer;
  v_count integer;
begin
  select * into e from public.editions order by created_at limit 1;
  if not found or e.status <> 'open' or v_now < e.closes_at then return 'idle'; end if;
  select * into e from public.editions where id = e.id for update;
  if e.status <> 'open' or v_now < e.closes_at then return 'idle'; end if;   -- done meanwhile, or postponed
  perform public.px_edition_end_campaigns();
  -- one extra minute after the reservation delay: a payment that started before it has certainly committed by then
  v_settle := e.closes_at + make_interval(mins => public.px_setting_int('reservation_ttl_minutes')::integer) + interval '1 minute';
  if v_now < v_settle then return 'closing'; end if;
  v_rev := public.px_edition_build_snapshot(e.id, null);
  select parcel_count into v_count from public.edition_snapshots where edition_id = e.id and revision = v_rev;
  update public.editions set status = 'closed', closed_at = v_now where id = e.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'edition.close', 'edition', e.id::text, jsonb_build_object('closes_at', e.closes_at, 'snapshot_revision', v_rev, 'parcels', v_count));
  return 'finalized';
end $$;

/* ------------------------------------------------------------------ the guards, one line each in the existing functions */
-- Each function below is its CURRENT definition (read from the database after migration 18) with one added line:
--   px_assert_edition_open()      nothing can be bought, reserved or started while the edition is not open;
--   px_assert_edition_editable()  nothing can be created, edited or drawn once the edition is frozen.
-- Two have a slightly longer change, explained where they are: px_fulfill_order and px_fulfill_contribution (a late payment is refunded).

CREATE OR REPLACE FUNCTION public.px_start_order(p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer, p_land integer DEFAULT NULL::integer, p_currency text DEFAULT NULL::text, p_kind text DEFAULT 'land'::text)
 RETURNS TABLE(order_id uuid, parcel_id uuid, reservation_id uuid, amount_cents bigint, unit_price_cents integer, currency text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
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
  perform public.px_assert_edition_open();   -- the edition is not open (prelaunch or closed): nothing can be started
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
end $function$;

CREATE OR REPLACE FUNCTION public.px_create_campaign(p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer, p_land integer, p_currency text, p_kind text, p_days integer, p_storage_path text, p_hash text, p_width integer, p_height integer, p_bytes integer, p_avg_color text, p_title text, p_description text, p_link text, p_commercial boolean)
 RETURNS TABLE(id uuid, code text, goal_cents bigint, currency text)
 LANGUAGE plpgsql
AS $function$
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
  perform public.px_assert_edition_open();   -- the edition is not open (prelaunch or closed): nothing can be started
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
end $function$;

CREATE OR REPLACE FUNCTION public.px_start_contribution(p_user uuid, p_campaign uuid, p_amount bigint)
 RETURNS TABLE(contribution_id uuid, amount_cents bigint, currency text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
#variable_conflict use_column
declare
  c public.campaigns;
  v_min bigint := public.px_setting_int('campaign_min_contribution_cents');
  v_paid bigint;
  v_held bigint;
  v_rem bigint;
  v_id uuid := gen_random_uuid();
  v_exp timestamptz := now() + make_interval(mins => public.px_setting_int('reservation_ttl_minutes')::integer);
begin
  perform public.px_assert_edition_open();   -- the edition is not open (prelaunch or closed): nothing can be started
  select * into c from public.campaigns where id = p_campaign;
  if not found then raise exception 'px_not_found'; end if;
  -- same lock order as everywhere: the tiles, then the rows
  perform public.px_lock_tiles(c.x, c.y, c.w, c.h);
  select * into c from public.campaigns where id = p_campaign for update;
  if c.status <> 'open' or c.deadline is null or c.deadline <= now() then raise exception 'px_campaign_closed'; end if;
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sales_open'), false) is not true then
    raise exception 'px_sales_closed';
  end if;
  if (select status from public.profiles where id = p_user and deleted_at is null) is distinct from 'active' then raise exception 'px_account_suspended'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'px_invalid_amount'; end if;

  -- the holds that ran out are over
  update public.contributions set status = 'expired', updated_at = now() where campaign_id = c.id and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.contributions where campaign_id = c.id and user_id = p_user and status = 'pending') then
    raise exception 'px_contribution_in_progress';
  end if;

  select coalesce(sum(k.amount_cents) filter (where k.status in ('paid', 'disputed')), 0),
         coalesce(sum(k.amount_cents) filter (where k.status = 'pending'), 0)
    into v_paid, v_held from public.contributions k where k.campaign_id = c.id;
  v_rem := c.goal_cents - v_paid - v_held;
  if v_rem < 1 then raise exception 'px_campaign_full'; end if;             -- everything is paid, or being paid
  if p_amount > v_rem then raise exception 'px_amount_too_high'; end if;
  if p_amount < v_min and p_amount <> v_rem then raise exception 'px_amount_too_low'; end if;
  if p_amount <> v_rem and v_rem - p_amount < 50 then raise exception 'px_amount_leaves_dust'; end if;

  insert into public.contributions (id, campaign_id, user_id, amount_cents, currency, expires_at)
  values (v_id, c.id, p_user, p_amount, c.currency, v_exp);
  return query select v_id, p_amount, c.currency, v_exp;
end $function$;

CREATE OR REPLACE FUNCTION public.px_review_campaign(p_actor uuid, p_campaign uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
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
    perform public.px_assert_edition_open();   -- approving reserves the zone: only while the edition is open (rejecting stays possible)
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
end $function$;

CREATE OR REPLACE FUNCTION public.px_fulfill_order(p_order uuid, p_session text, p_payment_intent text, p_charge text, p_amount_subtotal bigint, p_amount_tax bigint, p_amount_total bigint, p_currency text, p_email text, p_country text, p_name text, p_tax_ids jsonb, p_invoice_url text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  o public.orders;
  v_updated integer;
begin
  -- Same lock order as px_start_order (tiles first, then rows) so the two can never deadlock.
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'px_order_not_found'; end if;
  perform public.px_lock_tiles(o.x, o.y, o.w, o.h);
  select * into o from public.orders where id = p_order for update;
  if o.stripe_checkout_session_id is not null and p_session is not null and o.stripe_checkout_session_id <> p_session then
    raise exception 'px_session_mismatch';
  end if;
  if o.status = 'paid' then return 'already_paid'; end if;
  if o.status in ('refunded', 'disputed', 'dispute_lost', 'refund_required') then return 'ignored'; end if;

  if p_payment_intent is not null then
    insert into public.payments (order_id, stripe_payment_intent_id, stripe_charge_id, status, amount_cents, currency)
    values (o.id, p_payment_intent, p_charge, 'succeeded', coalesce(p_amount_total, p_amount_subtotal), p_currency)
    on conflict (stripe_payment_intent_id) do update
      set status = 'succeeded', stripe_charge_id = coalesce(excluded.stripe_charge_id, public.payments.stripe_charge_id),
          amount_cents = excluded.amount_cents, failure_code = null, failure_message = null;
  end if;

  -- The amount actually charged must match what the server priced (tax excluded by Stripe in amount_subtotal).
  if p_amount_subtotal is distinct from o.amount_cents or lower(p_currency) <> o.currency then
    update public.orders set status = 'refund_required', stripe_payment_intent_id = p_payment_intent,
           customer_email = p_email where id = o.id;
    update public.parcel_reservations set status = 'canceled', resolved_at = now() where order_id = o.id and status = 'held';
    update public.parcels set status = 'released', released_at = now() where id = o.parcel_id and status = 'reserved';
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'order.amount_mismatch', 'order', o.id::text,
            jsonb_build_object('expected', o.amount_cents, 'received', p_amount_subtotal, 'currency', p_currency));
    return 'refund_required';
  end if;

  -- The edition is frozen (the reservation delay after the closing is over): a late payment buys nothing, it is refunded.
  if public.px_edition_is_frozen() then
    update public.orders set status = 'refund_required', stripe_payment_intent_id = p_payment_intent,
           customer_email = p_email, paid_at = now() where id = o.id;
    update public.parcel_reservations set status = 'expired', resolved_at = now() where order_id = o.id and status = 'held';
    update public.parcels set status = 'released', released_at = now() where id = o.parcel_id and status = 'reserved';
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'order.refund_required', 'order', o.id::text, jsonb_build_object('reason', 'edition_closed'));
    return 'refund_required';
  end if;

  begin
    update public.parcels set status = 'active', activated_at = now()
     where id = o.parcel_id and status in ('reserved', 'released');
    get diagnostics v_updated = row_count;
  exception when exclusion_violation then
    v_updated := 0;  -- the hold lapsed and somebody else took the pixels meanwhile
  end;

  if v_updated = 0 then
    update public.orders set status = 'refund_required', stripe_payment_intent_id = p_payment_intent,
           customer_email = p_email, paid_at = now() where id = o.id;
    update public.parcel_reservations set status = 'expired', resolved_at = now() where order_id = o.id and status = 'held';
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'order.refund_required', 'order', o.id::text, jsonb_build_object('reason', 'pixels_unavailable'));
    return 'refund_required';
  end if;

  update public.parcel_reservations set status = 'converted', resolved_at = now() where order_id = o.id and status in ('held', 'expired');
  update public.orders set
      status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent,
      amount_subtotal_cents = p_amount_subtotal, amount_tax_cents = p_amount_tax, amount_total_cents = p_amount_total,
      customer_email = p_email, billing_country = nullif(upper(p_country), ''), billing_name = p_name,
      tax_ids = p_tax_ids, invoice_url = p_invoice_url
    where id = o.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'order.paid', 'order', o.id::text, jsonb_build_object('parcel_id', o.parcel_id, 'amount_cents', o.amount_cents));
  return 'fulfilled';
end $function$;

CREATE OR REPLACE FUNCTION public.px_fulfill_contribution(p_contribution uuid, p_session text, p_payment_intent text, p_amount_subtotal bigint, p_amount_tax bigint, p_amount_total bigint, p_currency text, p_email text, p_country text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  k public.contributions;
  c public.campaigns;
  v_paid bigint;
  v_others bigint;
  v_reason text;
begin
  select * into k from public.contributions where id = p_contribution;
  if not found then raise exception 'px_contribution_not_found'; end if;
  select * into c from public.campaigns where id = k.campaign_id;
  perform public.px_lock_tiles(c.x, c.y, c.w, c.h);
  select * into c from public.campaigns where id = k.campaign_id for update;
  select * into k from public.contributions where id = p_contribution for update;
  if k.stripe_checkout_session_id is not null and p_session is not null and k.stripe_checkout_session_id <> p_session then
    raise exception 'px_session_mismatch';
  end if;
  if k.status in ('paid', 'disputed') then return 'already_paid'; end if;
  if k.status in ('refunded', 'refund_required', 'dispute_lost') then return 'ignored'; end if;

  -- 1. the amount actually charged must be what the server decided (tax is excluded by Stripe in amount_subtotal)
  if p_amount_subtotal is distinct from k.amount_cents or lower(p_currency) <> k.currency then
    v_reason := 'amount_mismatch';
  -- 2. the project must still be open, and its time not over
  elsif c.status <> 'open' or c.deadline <= now() or public.px_edition_state() <> 'open' then
    v_reason := 'campaign_closed';
  else
    -- 3. never above the goal: what is paid + what other people are paying + this payment (a late payment, whose hold ran out, still
    --    gets its place if nobody else took it)
    select coalesce(sum(x.amount_cents) filter (where x.status in ('paid', 'disputed')), 0),
           coalesce(sum(x.amount_cents) filter (where x.status = 'pending' and x.id <> k.id), 0)
      into v_paid, v_others from public.contributions x where x.campaign_id = c.id;
    if v_paid + v_others + k.amount_cents > c.goal_cents then v_reason := 'over_goal'; end if;
  end if;

  if v_reason is not null then
    update public.contributions set status = 'refund_required', stripe_payment_intent_id = p_payment_intent, customer_email = p_email,
           amount_total_cents = p_amount_total, paid_at = now(), updated_at = now() where id = k.id;
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'contribution.refund_required', 'contribution', k.id::text,
            jsonb_build_object('reason', v_reason, 'campaign_id', c.id, 'expected', k.amount_cents, 'received', p_amount_subtotal, 'currency', p_currency));
    return 'refund_required';
  end if;

  update public.contributions set status = 'paid', paid_at = now(), updated_at = now(), stripe_payment_intent_id = p_payment_intent,
         amount_subtotal_cents = p_amount_subtotal, amount_tax_cents = p_amount_tax, amount_total_cents = p_amount_total,
         customer_email = p_email, billing_country = nullif(upper(p_country), '')
   where id = k.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'contribution.paid', 'contribution', k.id::text, jsonb_build_object('campaign_id', c.id, 'amount_cents', k.amount_cents));

  if v_paid + k.amount_cents >= c.goal_cents then
    if public.px_complete_campaign(c.id) then return 'funded'; end if;
    return 'refund_required';   -- the zone could not be kept: the project was closed and this payment is due back
  end if;
  return 'fulfilled';
end $function$;

CREATE OR REPLACE FUNCTION public.px_add_asset(p_user uuid, p_parcel uuid, p_storage_path text, p_hash text, p_width integer, p_height integer, p_bytes integer, p_avg_color text, p_title text, p_description text, p_link text, p_commercial boolean)
 RETURNS parcel_assets
 LANGUAGE plpgsql
AS $function$
declare
  pc public.parcels;
  a public.parcel_assets;
  k integer;
begin
  perform public.px_assert_edition_editable();   -- the edition is frozen: nothing can be created or edited any more
  select * into pc from public.parcels where id = p_parcel for update;
  if not found or pc.owner_id <> p_user then raise exception 'px_forbidden'; end if;
  if pc.status not in ('reserved', 'active') then raise exception 'px_parcel_not_editable'; end if;
  if (select status from public.profiles where id = p_user) <> 'active' then raise exception 'px_account_suspended'; end if;
  k := p_width / pc.w;
  if p_width % pc.w <> 0 or k < 1 or k > public.px_dot_scale(pc.w, pc.h) or p_height <> pc.h * k then raise exception 'px_bad_dimensions'; end if;

  update public.parcel_assets set status = 'superseded' where parcel_id = p_parcel and status = 'pending';
  insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes,
                                    avg_color, title, description, link_url, is_commercial)
  values (p_parcel, p_user, coalesce((select max(version) from public.parcel_assets where parcel_id = p_parcel), 0) + 1,
          p_storage_path, p_hash, p_width, p_height, p_bytes, p_avg_color, p_title, p_description, p_link, p_commercial)
  returning * into a;
  return a;
end $function$;

CREATE OR REPLACE FUNCTION public.px_collab_paint(p_token text, p_xs integer[], p_ys integer[], p_rgb integer[])
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare
  n integer := coalesce(cardinality(p_xs), 0);
  c public.parcel_collab;
  pc public.parcels;
  k integer;
  v bigint;
begin
  perform public.px_assert_edition_editable();   -- the edition is frozen: nothing can be created or edited any more
  if n = 0 or n > 2000 or cardinality(p_ys) is distinct from n or cardinality(p_rgb) is distinct from n then
    raise exception 'px_collab_bad_batch';
  end if;
  select * into c from public.parcel_collab where token = p_token for update;
  if not found or not c.enabled then raise exception 'px_collab_closed'; end if;
  select * into pc from public.parcels where id = c.parcel_id;
  if pc.status <> 'active' or pc.hidden_at is not null
     or (select status from public.profiles where id = pc.owner_id) <> 'active' then
    raise exception 'px_collab_closed';
  end if;
  k := public.px_dot_scale(pc.w, pc.h);
  if exists (
    select 1 from unnest(p_xs, p_ys, p_rgb) as t(x, y, rgb)
     where x is null or y is null or rgb is null or x < 0 or y < 0 or x >= pc.w * k or y >= pc.h * k or rgb < 0 or rgb > 16777215
  ) then
    raise exception 'px_collab_out_of_bounds';
  end if;
  v := c.version + 1;
  insert into public.parcel_collab_pixels (parcel_id, x, y, rgb, version)
  select distinct on (t.x, t.y) c.parcel_id, t.x, t.y, t.rgb, v
    from unnest(p_xs, p_ys, p_rgb) with ordinality as t(x, y, rgb, ord)
   order by t.x, t.y, t.ord desc
  on conflict (parcel_id, x, y) do update set rgb = excluded.rgb, version = excluded.version;
  update public.parcel_collab set version = v, updated_at = now() where parcel_id = c.parcel_id;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.px_collab_reset(p_user uuid, p_parcel uuid)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare c public.parcel_collab;
begin
  perform public.px_assert_edition_editable();   -- the edition is frozen: nothing can be created or edited any more
  perform public.px_collab_owner_check(p_user, p_parcel);
  select * into c from public.parcel_collab where parcel_id = p_parcel for update;
  if not found then raise exception 'px_not_found'; end if;
  delete from public.parcel_collab_pixels where parcel_id = p_parcel;
  update public.parcel_collab set version = c.version + 1, reset_version = c.version + 1, updated_at = now() where parcel_id = p_parcel;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'owner', 'collab.reset', 'parcel', p_parcel::text, '{}'::jsonb);
  return c.version + 1;
end $function$;

CREATE OR REPLACE FUNCTION public.px_collab_enable(p_user uuid, p_parcel uuid, p_rotate boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  fresh text := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
  c public.parcel_collab;
begin
  perform public.px_assert_edition_editable();   -- the edition is frozen: nothing can be created or edited any more
  perform public.px_collab_owner_check(p_user, p_parcel);
  insert into public.parcel_collab (parcel_id, token) values (p_parcel, fresh)
  on conflict (parcel_id) do update
    set enabled = true,
        token = case when p_rotate then excluded.token else public.parcel_collab.token end,
        updated_at = now()
  returning * into c;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'owner', case when p_rotate then 'collab.rotate' else 'collab.enable' end, 'parcel', p_parcel::text, '{}'::jsonb);
  return c.token;
end $function$;

CREATE OR REPLACE FUNCTION public.px_comment_add(p_user uuid, p_code text, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  pc public.parcels;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform public.px_assert_edition_editable();   -- the edition is frozen: nothing can be created or edited any more
  if (select status from public.profiles where id = p_user) is distinct from 'active' then raise exception 'px_account_suspended'; end if;
  select * into pc from public.parcels where code = p_code and status = 'active' and hidden_at is null;
  if not found then raise exception 'px_not_found'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'px_comment_invalid'; end if;
  if exists (select 1 from public.parcel_comments
              where parcel_id = pc.id and author_id = p_user and body = v_body and created_at > now() - interval '10 minutes') then
    raise exception 'px_comment_duplicate';
  end if;
  insert into public.parcel_comments (parcel_id, author_id, body) values (pc.id, p_user, v_body) returning id into v_id;
  return v_id;
end $function$;

/* ------------------------------------------------------------------ privileges: the server only (nothing for the browser roles) */
revoke all on function public.px_edition_state(timestamptz) from public, anon, authenticated;
revoke all on function public.px_edition_is_frozen(timestamptz) from public, anon, authenticated;
revoke all on function public.px_assert_edition_open() from public, anon, authenticated;
revoke all on function public.px_assert_edition_editable() from public, anon, authenticated;
revoke all on function public.px_guard_edition_editable() from public, anon, authenticated;
revoke all on function public.px_parcels_set_edition() from public, anon, authenticated;
revoke all on function public.px_edition_info() from public, anon, authenticated;
revoke all on function public.px_edition_open(uuid, text) from public, anon, authenticated;
revoke all on function public.px_edition_close_now(uuid, text) from public, anon, authenticated;
revoke all on function public.px_edition_extend(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.px_edition_reset(uuid, text) from public, anon, authenticated;
revoke all on function public.px_edition_end_campaigns() from public, anon, authenticated;
revoke all on function public.px_edition_build_snapshot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.px_edition_take_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.px_edition_sweep() from public, anon, authenticated;
