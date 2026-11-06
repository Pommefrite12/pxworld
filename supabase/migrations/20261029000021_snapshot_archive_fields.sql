-- The closing snapshot carries the archive fields of each creation (category, place) and the archive date, so that the export of the archive
-- (scripts/export-archive.mts) is complete without asking the live tables. And the manifest can now be built WITHOUT being stored, which makes a
-- rehearsal of the export possible on a test site before the real closing (`npm run archive:export -- --preview`).
--
-- * px_edition_manifest()            NEW. Reads what the public can see right now and answers it as the manifest (a json array, one item per parcel,
--                                    ordered by code). Stores nothing, changes nothing. Not callable by the browser roles.
-- * px_edition_build_snapshot(...)   now takes its manifest from px_edition_manifest() instead of building it inline.
--
-- Snapshots already taken are append-only and stay exactly as they were (one taken before this migration simply has no category/place in its
-- manifest; the export then leaves those columns empty and says so). The hash of a snapshot is still the sha256 of the manifest's text as PostgreSQL
-- stores it (`manifest::text`), which is also what the export writes to `manifest.json` byte for byte: `sha256sum manifest.json` gives the recorded hash.
--
-- ROLLBACK: re-apply px_edition_build_snapshot as it is in migration 19 (the inline query, without 'category', 'place_label', 'place_country'),
-- then: drop function if exists public.px_edition_manifest();

create or replace function public.px_edition_manifest() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(q.item order by q.code), '[]'::jsonb)
    from (
      select p.code,
             jsonb_build_object(
               'code', p.code, 'x', p.x, 'y', p.y, 'w', p.w, 'h', p.h, 'kind', p.kind,
               'author', pr.username, 'activated_at', p.activated_at,
               'creation', case when a.id is null then null else jsonb_build_object(
                  'asset_id', a.id, 'version', a.version, 'content_hash', a.content_hash, 'storage_path', a.storage_path,
                  'width', a.width, 'height', a.height, 'title', a.title, 'description', a.description, 'published_at', a.published_at,
                  'category', a.category, 'place_label', a.place_label, 'place_country', a.place_country) end) as item
        from public.parcels p
        join public.profiles pr on pr.id = p.owner_id
        left join public.parcel_assets a on a.id = p.published_asset_id and a.status = 'approved'
       where p.status = 'active' and p.hidden_at is null and pr.status = 'active' and pr.deleted_at is null
    ) q
$$;

create or replace function public.px_edition_build_snapshot(p_edition uuid, p_actor uuid) returns integer
language plpgsql as $$
declare
  v_manifest jsonb := public.px_edition_manifest();
  v_count integer := jsonb_array_length(v_manifest);
  v_rev integer;
begin
  select coalesce(max(revision), 0) + 1 into v_rev from public.edition_snapshots where edition_id = p_edition;
  insert into public.edition_snapshots (edition_id, revision, taken_by, parcel_count, manifest_hash, manifest)
  values (p_edition, v_rev, p_actor, v_count, encode(sha256(convert_to(v_manifest::text, 'UTF8')), 'hex'), v_manifest);
  return v_rev;
end $$;

revoke all on function public.px_edition_manifest() from public, anon, authenticated;
revoke all on function public.px_edition_build_snapshot(uuid, uuid) from public, anon, authenticated;
