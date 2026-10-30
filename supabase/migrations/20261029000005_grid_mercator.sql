-- Grid v2: 40 000 × 25 000 (8:5, still exactly 1 000 000 000 pixels), drawn with the Web-Mercator projection
-- instead of the earlier 50 000 × 20 000 plate carrée (see src/lib/grid/projection.ts).
--
-- A fresh database already gets these values from migration 1. This migration moves databases that were created
-- with the first grid. It does NOT touch existing rows: parcels bought on the old grid keep their pixel
-- coordinates (which no longer mean the same place on the map), so clear test data first with `npm run data:clear`
-- on a development database. A production database never ran the old grid.
create or replace function public.px_grid_width()  returns integer language sql immutable parallel safe as $$ select 40000 $$;
create or replace function public.px_grid_height() returns integer language sql immutable parallel safe as $$ select 25000 $$;
