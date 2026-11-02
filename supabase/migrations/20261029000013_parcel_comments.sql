-- Comments on parcels: a signed-in visitor can leave a short remark under a creation.
--
-- Like every table that is not public data, it is server-only (RLS on, nothing granted to the browser roles): the pages
-- read it through the API, which only ever shows the comments of an active, visible parcel. Comments are plain text
-- (rendered through React, never as HTML), at most 500 characters, and are never edited: they can only be removed, by
--   - their author,
--   - the owner of the parcel they were left on (it is their wall),
--   - the moderators (and admins).
-- A removal keeps the row (status 'removed', who and in which capacity) so that a report about it can still be handled.

create table public.parcel_comments (
  id           uuid primary key default gen_random_uuid(),
  parcel_id    uuid not null references public.parcels (id) on delete cascade,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 500 and body = btrim(body)),
  status       text not null default 'visible' check (status in ('visible', 'removed')),
  removed_by   uuid,
  removed_role text check (removed_role in ('author', 'owner', 'moderator', 'admin')),
  removed_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index parcel_comments_parcel_idx on public.parcel_comments (parcel_id, created_at desc, id desc) where status = 'visible';
create index parcel_comments_author_idx on public.parcel_comments (author_id, created_at desc);

alter table public.parcel_comments enable row level security;
revoke all on table public.parcel_comments from anon, authenticated;
comment on table public.parcel_comments is 'Plain-text comments under a parcel (server-only). Removed comments are kept, marked, for moderation.';

-- Adds a comment. The same words twice in ten minutes on the same parcel by the same person are refused (copy-paste spam).
create or replace function public.px_comment_add(p_user uuid, p_code text, p_body text) returns uuid
language plpgsql as $$
declare
  pc public.parcels;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if (select status from public.profiles where id = p_user) is distinct from 'active' then raise exception 'px_account_suspended'; end if;
  select * into pc from public.parcels where code = p_code and status = 'active' and hidden_at is null;
  if not found then raise exception 'px_not_found'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'px_comment_invalid'; end if;
  if exists (select 1 from public.parcel_comments
              where parcel_id = pc.id and author_id = p_user and body = v_body and created_at > now() - interval '10 minutes') then
    raise exception 'px_comment_duplicate';
  end if;
  insert into public.parcel_comments (parcel_id, author_id, body) values (pc.id, p_user, v_body) returning id into v_id;
  return v_id;
end $$;

-- Removes a comment. Who may: its author, the owner of the parcel, any staff member. Returns the capacity it was removed in.
create or replace function public.px_comment_remove(p_actor uuid, p_comment uuid, p_reason text default null) returns text
language plpgsql as $$
declare
  c public.parcel_comments;
  pc public.parcels;
  v_role text;
begin
  select * into c from public.parcel_comments where id = p_comment and status = 'visible' for update;
  if not found then raise exception 'px_not_found'; end if;
  select * into pc from public.parcels where id = c.parcel_id;
  if c.author_id = p_actor then v_role := 'author';
  elsif pc.owner_id = p_actor then v_role := 'owner';
  else
    v_role := public.px_staff_role(p_actor); -- 'moderator' | 'admin' | null
    if v_role is null then raise exception 'px_forbidden'; end if;
  end if;
  update public.parcel_comments set status = 'removed', removed_by = p_actor, removed_role = v_role, removed_at = now() where id = c.id;
  -- an author taking back their own words is not an event; anybody else removing someone's words is journalised
  if v_role <> 'author' then
    insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
    values (p_actor, v_role, 'comment.remove', 'comment', c.id::text, jsonb_build_object('parcel_id', c.parcel_id, 'author_id', c.author_id, 'reason', p_reason));
  end if;
  return v_role;
end $$;

revoke all on function public.px_comment_add(uuid, text, text) from public, anon, authenticated;
revoke all on function public.px_comment_remove(uuid, uuid, text) from public, anon, authenticated;
