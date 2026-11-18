-- Indexes on the foreign keys that had none (migration 28).
--
-- A foreign key makes PostgreSQL look for the rows that point to a row each time that row is deleted (or its key changed). Without an index on the
-- pointing column, every such check reads the WHOLE table. Measured on 20 000 parcels: `demo:clear --everything` took 53 seconds (each deleted parcel
-- made PostgreSQL scan `parcels` for those it "covers" and for those that show it as their picture); with the indexes below it takes 2 seconds.
-- The same lookups happen when an account is removed (the creations it uploaded) and, for the reservations, on every payment event
-- (`px_extend_reservation`, `px_cancel_order`, `px_fulfill_order`… all do `where order_id = …`).
--
-- Partial indexes (`where … is not null`) where most rows have no value: they stay small, and PostgreSQL still uses them for an equality lookup.
-- `tests/db/foreign-key-indexes.test.ts` fails if a foreign key is added without an index from now on.
--
-- To undo: drop these indexes (nothing depends on them).

create index if not exists parcels_covered_by_idx        on public.parcels (covered_by) where covered_by is not null;
create index if not exists parcels_published_asset_idx   on public.parcels (published_asset_id) where published_asset_id is not null;
create index if not exists parcels_edition_idx           on public.parcels (edition_id) where edition_id is not null;
create index if not exists parcel_assets_uploader_idx    on public.parcel_assets (uploader_id);
create index if not exists parcel_reservations_order_idx on public.parcel_reservations (order_id) where order_id is not null;
create index if not exists campaigns_parcel_idx          on public.campaigns (parcel_id) where parcel_id is not null;
create index if not exists moderation_reports_reporter_idx on public.moderation_reports (reporter_id) where reporter_id is not null;
create index if not exists moderation_reports_asset_idx  on public.moderation_reports (asset_id) where asset_id is not null;
create index if not exists moderation_actions_report_idx on public.moderation_actions (report_id) where report_id is not null;
