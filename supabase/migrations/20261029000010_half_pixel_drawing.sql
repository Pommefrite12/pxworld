-- Drawing at half-pixel precision.
--
-- A parcel is still w × h pixels: that is what is sold, counted (available / sold pixels) and priced, and none of it changes.
-- What changes is how finely a creation can be DRAWN on it: every pixel holds 2 × 2 dots, so a creation image may be the
-- parcel's own size (as before) or twice it, and the community overlay of "draw together" is made of dots.

-- 1. A creation image: the parcel's size, or twice it.
create or replace function public.px_add_asset(
  p_user uuid, p_parcel uuid, p_storage_path text, p_hash text, p_width integer, p_height integer, p_bytes integer,
  p_avg_color text, p_title text, p_description text, p_link text, p_commercial boolean)
returns public.parcel_assets
language plpgsql as $$
declare
  pc public.parcels;
  a public.parcel_assets;
begin
  select * into pc from public.parcels where id = p_parcel for update;
  if not found or pc.owner_id <> p_user then raise exception 'px_forbidden'; end if;
  if pc.status not in ('reserved', 'active') then raise exception 'px_parcel_not_editable'; end if;
  if (select status from public.profiles where id = p_user) <> 'active' then raise exception 'px_account_suspended'; end if;
  if not ((p_width = pc.w and p_height = pc.h) or (p_width = pc.w * 2 and p_height = pc.h * 2)) then raise exception 'px_bad_dimensions'; end if;

  update public.parcel_assets set status = 'superseded' where parcel_id = p_parcel and status = 'pending';
  insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes,
                                    avg_color, title, description, link_url, is_commercial)
  values (p_parcel, p_user, coalesce((select max(version) from public.parcel_assets where parcel_id = p_parcel), 0) + 1,
          p_storage_path, p_hash, p_width, p_height, p_bytes, p_avg_color, p_title, p_description, p_link, p_commercial)
  returning * into a;
  return a;
end $$;

-- 2. The shared overlay is made of dots: x in [0, 2w), y in [0, 2h).
create or replace function public.px_collab_paint(p_token text, p_xs integer[], p_ys integer[], p_rgb integer[]) returns bigint
language plpgsql as $$
declare
  n integer := coalesce(cardinality(p_xs), 0);
  c public.parcel_collab;
  pc public.parcels;
  v bigint;
begin
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
  if exists (
    select 1 from unnest(p_xs, p_ys, p_rgb) as t(x, y, rgb)
     where x is null or y is null or rgb is null or x < 0 or y < 0 or x >= pc.w * 2 or y >= pc.h * 2 or rgb < 0 or rgb > 16777215
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
end $$;

-- 3. Drawings made before this change were in whole pixels: each becomes its 2 × 2 dots (same colour), and connected
--    pages reload (reset_version moves past every version they may hold).
with old as (delete from public.parcel_collab_pixels returning parcel_id, x, y, rgb, version)
insert into public.parcel_collab_pixels (parcel_id, x, y, rgb, version)
select o.parcel_id, o.x * 2 + dx, o.y * 2 + dy, o.rgb, o.version
  from old o, (values (0), (1)) a(dx), (values (0), (1)) b(dy);
update public.parcel_collab set version = version + 1, reset_version = version + 1 where exists (select 1 from public.parcel_collab_pixels p where p.parcel_id = parcel_collab.parcel_id);
