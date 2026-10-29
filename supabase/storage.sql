-- Run once on the Supabase project (SQL editor) — storage is Supabase-specific, so it is not part of the portable migrations.
-- A PRIVATE bucket: files are only ever read by the server (service role) and served through /api/assets/[id], which
-- enforces moderation status. No storage policies are created on purpose: anon and authenticated users get no direct access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pixel-world-creations', 'pixel-world-creations', false, 3145728, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
