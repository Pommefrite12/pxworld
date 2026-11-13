-- Translations of a creation's title and description (migration 25). Only the illustration parcels use it: the demonstration tool stores, next to
-- the French text (`title`, `description`, what the French site shows), the same sentence in the other languages of the site, as
--   { "en": { "title": "...", "description": "..." }, "es": { ... }, "zh": { ... } }
-- and the site shows the one of the visitor's language. A visitor's own creation is never translated: nothing but the tool writes this column
-- (the creation API inserts its own list of columns), and the site only reads it for `tier = 'illustration'`.
--
-- To undo: drop the column (the French text is untouched).

alter table public.parcel_assets add column if not exists i18n jsonb;
alter table public.parcel_assets drop constraint if exists parcel_assets_i18n_object;
alter table public.parcel_assets add constraint parcel_assets_i18n_object check (i18n is null or jsonb_typeof(i18n) = 'object');
