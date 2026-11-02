-- Drawing together: the owner of a parcel shares a secret link; anyone holding it can paint pixels on the parcel.
--
-- The community's strokes live in their own table, as an OVERLAY on the parcel's approved creation. They are never public
-- by themselves: they only become the parcel's creation when the owner publishes a snapshot, which goes through moderation
-- like any other new version (px_add_asset). So everything the map shows has still been approved by a moderator.
--
--   parcel_collab         one row per shared parcel: the secret token, on/off, and a version counter
--   parcel_collab_pixels  the painted pixels (x, y relative to the parcel's top-left corner, 24-bit colour) + the version
--                         at which each one last changed (clients ask for "everything after version N")
--
-- Painting takes a row lock on parcel_collab, so paints of one parcel are serialised: versions are strictly increasing in
-- COMMIT order, which is what makes "everything after version N" safe (no change can commit late with a lower version).

create table public.parcel_collab (
  parcel_id     uuid primary key references public.parcels (id) on delete cascade,
  -- 40 hex characters (≈ 150 random bits): the link is the capability, it must not be guessable
  token         text not null unique check (token ~ '^[0-9a-f]{40}$'),
  enabled       boolean not null default true,
  version       bigint not null default 0,
  -- clients that last synchronised before this version must reload everything (the overlay was reset)
  reset_version bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.parcel_collab_pixels (
  parcel_id uuid not null references public.parcels (id) on delete cascade,
  x         integer not null check (x >= 0),
  y         integer not null check (y >= 0),
  rgb       integer not null check (rgb between 0 and 16777215),
  version   bigint not null,
  primary key (parcel_id, x, y)
);
create index parcel_collab_pixels_version_idx on public.parcel_collab_pixels (parcel_id, version);

-- Server-only, like every table that is not public data: RLS on, nothing granted to the browser roles.
alter table public.parcel_collab enable row level security;
alter table public.parcel_collab_pixels enable row level security;
revoke all on table public.parcel_collab, public.parcel_collab_pixels from anon, authenticated;

comment on table public.parcel_collab is 'Secret drawing links: whoever holds the token may paint the parcel overlay while the parcel is active, visible and its owner in good standing.';
comment on table public.parcel_collab_pixels is 'Community overlay on a parcel (sparse: only painted pixels). Becomes a creation only through an owner-published, moderated snapshot.';

-- The owner is the only one who can switch sharing on, renew or cut the link, and reset the overlay.
create or replace function public.px_collab_owner_check(p_user uuid, p_parcel uuid) returns public.parcels
language plpgsql stable as $$
declare pc public.parcels;
begin
  select * into pc from public.parcels where id = p_parcel;
  if not found or pc.owner_id <> p_user then raise exception 'px_forbidden'; end if;
  if pc.status <> 'active' then raise exception 'px_parcel_not_active'; end if;
  if (select status from public.profiles where id = p_user) <> 'active' then raise exception 'px_account_suspended'; end if;
  return pc;
end $$;

-- Switches sharing on (creating the link) and returns the token. `p_rotate` issues a NEW token, so every link already
-- handed out stops working; the painted pixels are kept.
create or replace function public.px_collab_enable(p_user uuid, p_parcel uuid, p_rotate boolean default false) returns text
language plpgsql as $$
declare
  fresh text := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
  c public.parcel_collab;
begin
  perform public.px_collab_owner_check(p_user, p_parcel);
  insert into public.parcel_collab (parcel_id, token) values (p_parcel, fresh)
  on conflict (parcel_id) do update
    set enabled = true,
        token = case when p_rotate then excluded.token else public.parcel_collab.token end,
        updated_at = now()
  returning * into c;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'owner', case when p_rotate then 'collab.rotate' else 'collab.enable' end, 'parcel', p_parcel::text, '{}'::jsonb);
  return c.token;
end $$;

-- Stops sharing: the link stops working at once. The pixels stay (switching it on again brings them back).
create or replace function public.px_collab_disable(p_user uuid, p_parcel uuid) returns void
language plpgsql as $$
begin
  perform public.px_collab_owner_check(p_user, p_parcel);
  update public.parcel_collab set enabled = false, updated_at = now() where parcel_id = p_parcel;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'owner', 'collab.disable', 'parcel', p_parcel::text, '{}'::jsonb);
end $$;

-- Wipes the community overlay (the parcel's creation is untouched). Connected clients reload everything.
create or replace function public.px_collab_reset(p_user uuid, p_parcel uuid) returns bigint
language plpgsql as $$
declare c public.parcel_collab;
begin
  perform public.px_collab_owner_check(p_user, p_parcel);
  select * into c from public.parcel_collab where parcel_id = p_parcel for update;
  if not found then raise exception 'px_not_found'; end if;
  delete from public.parcel_collab_pixels where parcel_id = p_parcel;
  update public.parcel_collab set version = c.version + 1, reset_version = c.version + 1, updated_at = now() where parcel_id = p_parcel;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'owner', 'collab.reset', 'parcel', p_parcel::text, '{}'::jsonb);
  return c.version + 1;
end $$;

-- Anyone holding the token paints a batch of pixels: parallel arrays of x, y (relative to the parcel) and 0xRRGGBB.
-- All or nothing. Within one batch the LAST value of a pixel wins. Returns the new version.
create or replace function public.px_collab_paint(p_token text, p_xs integer[], p_ys integer[], p_rgb integer[]) returns bigint
language plpgsql as $$
declare
  n integer := coalesce(cardinality(p_xs), 0);
  c public.parcel_collab;
  pc public.parcels;
  v bigint;
begin
  if n = 0 or n > 2000 or cardinality(p_ys) is distinct from n or cardinality(p_rgb) is distinct from n then
    raise exception 'px_collab_bad_batch';
  end if;
  select * into c from public.parcel_collab where token = p_token for update;
  if not found or not c.enabled then raise exception 'px_collab_closed'; end if;
  select * into pc from public.parcels where id = c.parcel_id;
  -- a parcel that is hidden by moderation, revoked, or whose owner is suspended stops accepting strokes
  if pc.status <> 'active' or pc.hidden_at is not null
     or (select status from public.profiles where id = pc.owner_id) <> 'active' then
    raise exception 'px_collab_closed';
  end if;
  if exists (
    select 1 from unnest(p_xs, p_ys, p_rgb) as t(x, y, rgb)
     where x is null or y is null or rgb is null or x < 0 or y < 0 or x >= pc.w or y >= pc.h or rgb < 0 or rgb > 16777215
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

revoke all on function public.px_collab_owner_check(uuid, uuid) from public, anon, authenticated;
revoke all on function public.px_collab_enable(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.px_collab_disable(uuid, uuid) from public, anon, authenticated;
revoke all on function public.px_collab_reset(uuid, uuid) from public, anon, authenticated;
revoke all on function public.px_collab_paint(text, integer[], integer[], integer[]) from public, anon, authenticated;
