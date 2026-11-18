-- One forgotten REVOKE (migration 29).
--
-- Migration 2 takes away from `public`, `anon` and `authenticated` the right to run the site's own functions (`px_*`): they are called by the server
-- only (service role / table owner), never through Supabase's public API. The loop at the end of migration 2 only knew the functions that existed THEN.
-- `px_cover_free_parcels` (migration 23, redefined in 24) came later and kept PostgreSQL's default: anybody could run it.
-- It is a trigger function, which PostgREST does not offer as a remote call, so nothing could be done with it — but the rule is "closed unless said
-- otherwise", and `tests/db/function-grants.test.ts` now fails if a `px_*` function (other than `px_is_staff`, which the row-level security policies use)
-- is open to them.
--
-- To undo: `grant execute on function public.px_cover_free_parcels() to public;` (there is no reason to).

revoke all on function public.px_cover_free_parcels() from public, anon, authenticated;
