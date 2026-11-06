-- The archive fields of a creation: a category, and the place it is about (distinct from where the parcel sits on the map).
--
-- Every creation (and every group project, whose creation becomes the parcel's when it is funded) can carry:
--   category       one of a closed list (arts, daily, family, nature, science, sport, food, tribute, humor, future, other);
--                  the words are in the interface (messages `archive.categories.*`), the database keeps the codes
--   place_label    free text, 1 to 80 characters ("Naples, Italie"): where it happened, what it is about. NEVER coordinates:
--                  a precise position would be personal data, and the archive does not need it
--   place_country  an optional ISO 3166-1 alpha-2 code, upper case
-- All three are optional in the database (every creation made before has none); the interface asks for the category.
-- The archive DATE needs no column: it is the date the payment was confirmed (parcels.activated_at), which nobody can edit.
--
-- Additive and non-destructive (new nullable columns, two small functions, one function re-created with ONE added statement).
--
-- ROLLBACK:
--   re-apply px_review_campaign as it is in migration 19;
--   drop function if exists public.px_set_campaign_archive(uuid, uuid, text, text, text), public.px_set_asset_archive(uuid, uuid, text, text, text);
--   alter table public.campaigns drop column if exists category, drop column if exists place_label, drop column if exists place_country;
--   alter table public.parcel_assets drop column if exists category, drop column if exists place_label, drop column if exists place_country;

alter table public.parcel_assets
  add column if not exists category text check (category is null or category in ('arts', 'daily', 'family', 'nature', 'science', 'sport', 'food', 'tribute', 'humor', 'future', 'other')),
  add column if not exists place_label text check (place_label is null or char_length(place_label) between 1 and 80),
  add column if not exists place_country char(2) check (place_country is null or place_country ~ '^[A-Z]{2}$');
alter table public.campaigns
  add column if not exists category text check (category is null or category in ('arts', 'daily', 'family', 'nature', 'science', 'sport', 'food', 'tribute', 'humor', 'future', 'other')),
  add column if not exists place_label text check (place_label is null or char_length(place_label) between 1 and 80),
  add column if not exists place_country char(2) check (place_country is null or place_country ~ '^[A-Z]{2}$');

-- One place for the rules of the three fields; the answer is the cleaned values, or px_invalid_archive.
create or replace function public.px_clean_archive(p_category text, p_place_label text, p_place_country text,
                                                   out category text, out place_label text, out place_country text)
language plpgsql immutable as $$
begin
  category := nullif(btrim(coalesce(p_category, '')), '');
  place_label := nullif(btrim(coalesce(p_place_label, '')), '');
  place_country := nullif(upper(btrim(coalesce(p_place_country, ''))), '');
  if category is not null and category not in ('arts', 'daily', 'family', 'nature', 'science', 'sport', 'food', 'tribute', 'humor', 'future', 'other') then raise exception 'px_invalid_archive'; end if;
  if place_label is not null and char_length(place_label) > 80 then raise exception 'px_invalid_archive'; end if;
  if place_country is not null and place_country !~ '^[A-Z]{2}$' then raise exception 'px_invalid_archive'; end if;
end $$;

-- The owner annotates the version they have just sent (still awaiting moderation). Frozen with the creations once the edition is frozen.
create or replace function public.px_set_asset_archive(p_user uuid, p_asset uuid, p_category text, p_place_label text, p_place_country text) returns void
language plpgsql as $$
declare
  a public.parcel_assets;
  v record;
begin
  perform public.px_assert_edition_editable();
  select * into a from public.parcel_assets where id = p_asset for update;
  if not found or a.uploader_id <> p_user then raise exception 'px_forbidden'; end if;
  if a.status <> 'pending' then raise exception 'px_not_pending'; end if;
  select * into v from public.px_clean_archive(p_category, p_place_label, p_place_country);
  update public.parcel_assets set category = v.category, place_label = v.place_label, place_country = v.place_country where id = p_asset;
end $$;

-- The same for a group project, while it waits for a moderator (it is copied onto the creation when the project is approved).
create or replace function public.px_set_campaign_archive(p_user uuid, p_campaign uuid, p_category text, p_place_label text, p_place_country text) returns void
language plpgsql as $$
declare
  c public.campaigns;
  v record;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or c.creator_id <> p_user then raise exception 'px_forbidden'; end if;
  if c.status <> 'pending' then raise exception 'px_not_pending'; end if;
  select * into v from public.px_clean_archive(p_category, p_place_label, p_place_country);
  update public.campaigns set category = v.category, place_label = v.place_label, place_country = v.place_country where id = p_campaign;
end $$;

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
    -- the archive fields the creator gave (category, place) travel with the creation
    update public.parcel_assets set category = c.category, place_label = c.place_label, place_country = c.place_country where id = a.id;
    update public.parcel_assets set status = 'approved', reviewed_by = p_actor, reviewed_at = now() where id = a.id;
    update public.campaigns
       set status = 'open', parcel_id = v_parcel, reviewed_by = p_actor, reviewed_at = now(), opens_at = now(), deadline = v_expires, updated_at = now()
     where id = c.id;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'campaign.' || p_decision, 'campaign', c.id::text, jsonb_build_object('creator_id', c.creator_id, 'reason', p_reason));
  return p_decision;
end $function$;

revoke all on function public.px_clean_archive(text, text, text) from public, anon, authenticated;
revoke all on function public.px_set_asset_archive(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.px_set_campaign_archive(uuid, uuid, text, text, text) from public, anon, authenticated;
