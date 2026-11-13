-- Illustration parcels (migration 24): decorative pictures that dress the map before it has real traces — historic places, cultures, the world of
-- today — placed by the site's owner, NOT by a visitor. A third `parcels.tier`, next to 'paid' and 'free':
--   * like a free parcel it never blocks a purchase and is COVERED, whole and for good, by any paid land parcel that touches it (the same trigger);
--   * unlike a free parcel it can be bigger (25 to 2 500 pixels: up to 50 × 50), belongs to one technical account ("image_illustration", nobody
--     can sign in to it) and is shown as "Illustration image" instead of an author;
--   * it is counted nowhere as sold, owned or free: the public counters, the free-period quotas and the free-parcel cap look at 'paid' and 'free' only.
-- The demonstration tool makes them (`demo:seed --set heritage`); `demo:clear` leaves them in place (they are meant to stay when the site opens).
--
-- To undo (no illustration may exist): restore the three constraints and the trigger function of migration 23.

alter table public.parcels drop constraint if exists parcels_tier_check;
alter table public.parcels add constraint parcels_tier_check check (tier in ('paid', 'free', 'illustration'));

alter table public.parcels drop constraint parcels_min_area;
alter table public.parcels add constraint parcels_min_area check (
  (tier = 'paid' and w * h >= 25) or (tier = 'free' and w * h <= 24) or (tier = 'illustration' and w * h between 25 and 2500));

alter table public.parcels drop constraint parcels_free_is_land;
alter table public.parcels add constraint parcels_free_is_land check (tier = 'paid' or kind = 'land');

-- the parcels that are not paid never overlap each other (a purchase never looks at them: it covers them)
alter table public.parcels drop constraint parcels_no_overlap_free;
alter table public.parcels add constraint parcels_no_overlap_free
  exclude using gist (bbox with &&) where (status = 'active' and tier in ('free', 'illustration'));

comment on column public.parcels.tier is 'paid: bought. free: a gift of 1 to 24 pixels that a visitor places and a paid parcel can cover. illustration: a decorative picture of 25 to 2 500 pixels placed by the site''s owner, shown as an illustration (no author), that a paid parcel can cover.';

create or replace function public.px_cover_free_parcels() returns trigger language plpgsql as $$
begin
  if new.tier = 'paid' and new.kind = 'land' and new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    -- a creation of the covered parcel that was still waiting for moderation will never be shown: it leaves the queue
    update public.parcel_assets a set status = 'superseded'
     where a.status = 'pending'
       and a.parcel_id in (select f.id from public.parcels f where f.tier in ('free', 'illustration') and f.status = 'active' and f.kind = 'land' and f.bbox && new.bbox);
    update public.parcels f
       set status = 'covered', covered_at = now(), covered_by = new.id, updated_at = now()
     where f.tier in ('free', 'illustration') and f.status = 'active' and f.kind = 'land' and f.bbox && new.bbox;
  end if;
  return null;
end $$;

-- the public counters: an illustration is decoration, not a contribution, so it is not a "published creation" either
create or replace function public.px_public_stats()
returns table (sold_pixels bigint, parcels bigint, owners bigint, published_creations bigint, map_version bigint, water_pixels bigint, water_parcels bigint,
               free_parcels bigint, free_pixels bigint)
language sql stable as $$
  select coalesce(sum(p.owned_px) filter (where p.tier = 'paid'), 0)::bigint,
         count(*) filter (where p.tier = 'paid')::bigint,
         count(distinct p.owner_id) filter (where p.tier = 'paid')::bigint,
         count(*) filter (where p.published_asset_id is not null and p.hidden_at is null and p.tier <> 'illustration')::bigint,
         (select version from public.map_state where id = 1),
         coalesce(sum(p.owned_px) filter (where p.kind = 'water' and p.tier = 'paid'), 0)::bigint,
         count(*) filter (where p.kind = 'water' and p.tier = 'paid')::bigint,
         count(*) filter (where p.tier = 'free')::bigint,
         coalesce(sum(p.owned_px) filter (where p.tier = 'free'), 0)::bigint
    from public.parcels p where p.status = 'active'
$$;
revoke all on function public.px_public_stats() from public, anon, authenticated;
