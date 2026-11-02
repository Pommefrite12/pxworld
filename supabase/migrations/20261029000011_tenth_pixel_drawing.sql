-- Drawing down to a tenth of a pixel.
--
-- Still nothing changes for what is SOLD: a parcel is w × h pixels (counted, priced, available/sold). Only the precision of
-- the drawing does: every pixel holds k × k dots, k up to 10, so the finest brush is 0.1 px.
-- Finer images are bigger images, so k is capped by the size of the image: the largest k ≤ 10 with k² · w · h ≤ 4 000 000.
-- (20 × 20 px → 10, 200 × 200 → 10, 500 × 500 → 4, 1 000 × 1 000 → 2.) Keep in sync with creationScale() in
-- src/lib/grid/constants.ts.

create or replace function public.px_dot_scale(p_w integer, p_h integer) returns integer
language sql immutable parallel safe as $$
  select coalesce(max(k), 1) from generate_series(1, 10) as k where k::bigint * k * p_w * p_h <= 4000000
$$;
revoke all on function public.px_dot_scale(integer, integer) from public, anon, authenticated;

-- 1. A creation image is the parcel's size times a whole scale k, 1 ≤ k ≤ px_dot_scale (older creations at 1× and 2× stay valid).
create or replace function public.px_add_asset(
  p_user uuid, p_parcel uuid, p_storage_path text, p_hash text, p_width integer, p_height integer, p_bytes integer,
  p_avg_color text, p_title text, p_description text, p_link text, p_commercial boolean)
returns public.parcel_assets
language plpgsql as $$
declare
  pc public.parcels;
  a public.parcel_assets;
  k integer;
begin
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
end $$;

-- 2. The shared overlay is made of dots at the parcel's scale: x in [0, k·w), y in [0, k·h).
create or replace function public.px_collab_paint(p_token text, p_xs integer[], p_ys integer[], p_rgb integer[]) returns bigint
language plpgsql as $$
declare
  n integer := coalesce(cardinality(p_xs), 0);
  c public.parcel_collab;
  pc public.parcels;
  k integer;
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
end $$;

-- 3. Overlays drawn at 2 dots per pixel (migration 10) are re-expressed at the parcel's scale k: each old dot becomes the
--    k/2 × k/2 dots it covered (rounding outwards when k is odd; where two old dots overlap, the newer one wins), and
--    connected pages reload (reset_version moves past every version they may hold).
with old as (delete from public.parcel_collab_pixels returning parcel_id, x, y, rgb, version),
expanded as (
  select o.parcel_id, gx, gy, o.rgb, o.version
    from old o
    join public.parcels p on p.id = o.parcel_id
    cross join lateral (select public.px_dot_scale(p.w, p.h) as k) s
    cross join lateral generate_series((o.x * s.k) / 2, ((o.x + 1) * s.k + 1) / 2 - 1) as gx
    cross join lateral generate_series((o.y * s.k) / 2, ((o.y + 1) * s.k + 1) / 2 - 1) as gy
)
insert into public.parcel_collab_pixels (parcel_id, x, y, rgb, version)
select distinct on (parcel_id, gx, gy) parcel_id, gx, gy, rgb, version
  from expanded
 order by parcel_id, gx, gy, version desc;
update public.parcel_collab set version = version + 1, reset_version = version + 1
 where exists (select 1 from public.parcel_collab_pixels p where p.parcel_id = parcel_collab.parcel_id);
