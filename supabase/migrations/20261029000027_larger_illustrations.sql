-- Larger illustration parcels (migration 27): up to 200 × 200 pixels (40 000), for the pictures on the biggest capitals of the world.
-- Migration 24 capped an illustration at 2 500 pixels (50 × 50). Nothing else changes: an illustration still belongs to the one technical account, is
-- still shown as an "Illustration image", still never overlaps another free or illustration parcel, is still COVERED whole by any paid land parcel that
-- touches it, and is still counted nowhere as sold, owned or free. (So a big illustration disappears as a whole under even a very small purchase: that is
-- the rule of the illustrations, unchanged.)
--
-- To undo (no illustration larger than 50 × 50 may exist): restore the constraint of migration 24.

alter table public.parcels drop constraint parcels_min_area;
alter table public.parcels add constraint parcels_min_area check (
  (tier = 'paid' and w * h >= 25) or (tier = 'free' and w * h <= 24) or (tier = 'illustration' and w * h between 25 and 40000));

comment on column public.parcels.tier is 'paid: bought. free: a gift of 1 to 24 pixels that a visitor places and a paid parcel can cover. illustration: a decorative picture of 25 to 40 000 pixels (up to 200 × 200) placed by the site''s owner, shown as an illustration (no author), that a paid parcel can cover.';
