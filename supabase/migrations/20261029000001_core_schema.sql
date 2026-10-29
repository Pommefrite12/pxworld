-- Pixel World — core schema.
-- Grid: 50 000 × 20 000 = 1 000 000 000 virtual pixels (see src/lib/grid/constants.ts).
-- Only purchased rectangles (parcels) are stored; the grid itself is virtual.
--
-- Table relationships (see docs/DATABASE.md for the diagram):
--   auth.users 1─1 profiles 1─* parcels 1─* parcel_assets
--   profiles 1─* orders *─1 parcels ; orders 1─* payments ; parcels 1─* parcel_reservations
--   parcel_assets / parcels 1─* moderation_reports ; moderation_actions & audit_logs are append-only logs.

-- Grid constants, mirrored from the application. A CHECK against these values is the last
-- line of defence if application code is ever wrong.
create or replace function public.px_grid_width()  returns integer language sql immutable parallel safe as $$ select 50000 $$;
create or replace function public.px_grid_height() returns integer language sql immutable parallel safe as $$ select 20000 $$;

/* ------------------------------------------------------------------ settings */

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
comment on table public.app_settings is 'Business parameters editable by admins (unit price, area limits, reservation TTL). Public, non-secret.';

insert into public.app_settings (key, value) values
  ('price_unit_cents',        '100'::jsonb),   -- 1 € per pixel, in minor units
  ('currency',                '"eur"'::jsonb),
  ('min_area',                '100'::jsonb),
  ('max_area',                '250000'::jsonb),
  ('reservation_ttl_minutes', '35'::jsonb),
  ('max_active_reservations_per_user', '3'::jsonb),
  ('sales_open',              'true'::jsonb);

create or replace function public.px_setting_int(p_key text) returns bigint
language sql stable as $$ select (value #>> '{}')::bigint from public.app_settings where key = p_key $$;

/* ------------------------------------------------------------------ profiles */

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  avatar_path text,
  country     char(2),
  bio         text,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  constraint profiles_country_format check (country is null or country ~ '^[A-Z]{2}$'),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 280)
);
create unique index profiles_username_key on public.profiles (lower(username));

-- Roles live in their own table, writable only by the service role: no client-editable flag.
create table public.admin_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('moderator', 'admin')),
  granted_by uuid,
  granted_at timestamptz not null default now()
);

create or replace function public.px_staff_role(p_user uuid) returns text
language sql stable security definer set search_path = public as
$$ select role from public.admin_roles where user_id = p_user $$;

create or replace function public.px_is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admin_roles where user_id = auth.uid()) $$;

-- Profile row created automatically when a user signs up (Supabase Auth).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'pixel'), '[^A-Za-z0-9_.-]', '', 'g');
  if char_length(base) < 3 then base := base || 'pix'; end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    n := n + 1;
    candidate := base || floor(random() * 9000 + 1000)::int::text;
    exit when n > 20;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

/* ------------------------------------------------------------------ parcels */

-- 10 hex characters = 40 bits: collisions are rare even with millions of parcels, and px_start_order retries on the
-- (unique) code constraint, so a collision can never fail a purchase.
create or replace function public.px_short_code() returns text language sql volatile as
$$ select substr(md5(random()::text || clock_timestamp()::text || txid_current()::text), 1, 10) $$;

create table public.parcels (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default public.px_short_code(),
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  x           integer not null,
  y           integer not null,
  w           integer not null,
  h           integer not null,
  area        integer generated always as (w * h) stored,
  -- Closed integer cell rectangle [x, x+w-1] × [y, y+h-1]. Adjacent parcels do NOT overlap.
  bbox        box generated always as (box(point(x::float8, y::float8), point((x + w - 1)::float8, (y + h - 1)::float8))) stored,
  -- reserved: pixels held while the buyer pays · active: paid and owned
  -- released: reservation ended unpaid · revoked: refunded / lost dispute / removed by an admin
  status      text not null check (status in ('reserved', 'active', 'released', 'revoked')),
  published_asset_id uuid,                -- FK added after parcel_assets (circular)
  hidden_at   timestamptz,                -- set by moderation: the parcel stays sold but its content is not shown
  hidden_reason text,
  created_at  timestamptz not null default now(),
  activated_at timestamptz,
  released_at timestamptz,
  updated_at  timestamptz not null default now(),

  constraint parcels_integers_in_grid check (
    x >= 0 and y >= 0 and w >= 1 and h >= 1
    and x + w <= public.px_grid_width() and y + h <= public.px_grid_height()),
  constraint parcels_side_cap check (w <= 1000 and h <= 1000),
  constraint parcels_min_area check (w * h >= 100),
  constraint parcels_max_area check (w * h <= 1000000),

  -- THE overlap guarantee. PostgreSQL enforces this atomically, across concurrent
  -- transactions and connections: a second overlapping INSERT/UPDATE blocks until the first
  -- commits, then fails with exclusion_violation (SQLSTATE 23P01).
  constraint parcels_no_overlap exclude using gist (bbox with &&) where (status in ('reserved', 'active'))
);

-- Map reads: active parcels intersecting the viewport.
create index parcels_active_bbox_idx on public.parcels using gist (bbox) where status = 'active';
create index parcels_owner_idx on public.parcels (owner_id, status);
create index parcels_status_created_idx on public.parcels (status, created_at desc);
create index parcels_active_area_idx on public.parcels (area desc) where status = 'active';

/* ------------------------------------------------------------------ orders */

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete restrict,
  parcel_id     uuid not null references public.parcels (id) on delete restrict,
  -- snapshot of what was bought, immune to later edits
  x integer not null, y integer not null, w integer not null, h integer not null,
  area          integer not null check (area >= 100),
  unit_price_cents integer not null check (unit_price_cents > 0),
  amount_cents  bigint not null check (amount_cents > 0),       -- computed server-side: area × unit price
  currency      text not null default 'eur',
  status        text not null default 'pending' check (status in (
                  'pending',          -- created, checkout not completed
                  'paid',             -- verified Stripe webhook, parcel attributed
                  'failed',           -- payment attempt failed (final)
                  'expired',          -- checkout expired / reservation lapsed
                  'canceled',         -- abandoned by the buyer
                  'refund_required',  -- paid but pixels could not be attributed → must be refunded
                  'refunded',
                  'disputed',         -- chargeback opened, outcome pending
                  'dispute_lost')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  -- billing / tax (values reported by Stripe; the app never invents tax rules)
  amount_subtotal_cents bigint,
  amount_tax_cents      bigint,
  amount_total_cents    bigint,
  customer_email        text,
  billing_country       char(2),
  billing_name          text,
  tax_ids               jsonb,
  invoice_url           text,
  expires_at    timestamptz not null,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint orders_amount_consistent check (amount_cents = area::bigint * unit_price_cents)
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_parcel_idx on public.orders (parcel_id);
create index orders_pending_idx on public.orders (expires_at) where status = 'pending';
create index orders_pi_idx on public.orders (stripe_payment_intent_id);

create table public.parcel_reservations (
  id         uuid primary key default gen_random_uuid(),
  parcel_id  uuid not null references public.parcels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  order_id   uuid references public.orders (id) on delete set null,
  status     text not null default 'held' check (status in ('held', 'converted', 'expired', 'canceled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index parcel_reservations_one_held on public.parcel_reservations (parcel_id) where status = 'held';
create index parcel_reservations_expiry_idx on public.parcel_reservations (expires_at) where status = 'held';
create index parcel_reservations_user_idx on public.parcel_reservations (user_id) where status = 'held';

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete restrict,
  provider     text not null default 'stripe',
  stripe_payment_intent_id text not null unique,
  stripe_charge_id text,
  status       text not null check (status in ('succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed', 'dispute_lost', 'dispute_won')),
  amount_cents bigint not null,
  amount_refunded_cents bigint not null default 0,
  currency     text not null,
  failure_code text,
  failure_message text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);

-- Every Stripe event ever received: the idempotency ledger for webhooks.
create table public.stripe_events (
  id           text primary key,                  -- evt_…
  type         text not null,
  status       text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts     integer not null default 1,
  error        text,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index stripe_events_status_idx on public.stripe_events (status, received_at);

/* ------------------------------------------------------------------ creations */

-- One row per VERSION of a parcel's creation (image + descriptive fields). Moderation applies
-- to the version, so editing never un-publishes the approved one until the new one is approved.
create table public.parcel_assets (
  id           uuid primary key default gen_random_uuid(),
  parcel_id    uuid not null references public.parcels (id) on delete cascade,
  uploader_id  uuid not null references public.profiles (id) on delete restrict,
  version      integer not null,
  storage_path text not null,
  content_hash text not null,                      -- sha256 of the canonical PNG
  width        integer not null,
  height       integer not null,
  bytes        integer not null,
  mime         text not null default 'image/png' check (mime = 'image/png'),
  avg_color    char(7) not null check (avg_color ~ '^#[0-9a-f]{6}$'),
  title        text check (title is null or char_length(title) between 1 and 80),
  description  text check (description is null or char_length(description) <= 280),
  link_url     text check (link_url is null or (char_length(link_url) <= 500 and link_url ~ '^https://')),
  is_commercial boolean not null default false,    -- commercial ads must be identifiable
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded', 'removed')),
  rejection_reason text,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (parcel_id, version)
);
create unique index parcel_assets_one_pending on public.parcel_assets (parcel_id) where status = 'pending';
create index parcel_assets_queue_idx on public.parcel_assets (created_at) where status = 'pending';
create index parcel_assets_published_idx on public.parcel_assets (published_at desc) where status = 'approved';

alter table public.parcels
  add constraint parcels_published_asset_fk foreign key (published_asset_id) references public.parcel_assets (id) on delete set null;

/* ------------------------------------------------------------------ community */

create table public.parcel_likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  parcel_id  uuid not null references public.parcels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, parcel_id)
);
create index parcel_likes_recent_idx on public.parcel_likes (parcel_id, created_at desc);

create table public.parcel_features (
  parcel_id   uuid primary key references public.parcels (id) on delete cascade,
  note        text,
  featured_by uuid,
  featured_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ moderation & audit */

create table public.moderation_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  parcel_id   uuid not null references public.parcels (id) on delete cascade,
  asset_id    uuid references public.parcel_assets (id) on delete set null,
  reason      text not null check (reason in ('copyright', 'hate', 'sexual', 'scam', 'illegal_ad', 'violence', 'other')),
  details     text check (details is null or char_length(details) <= 1000),
  status      text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  -- Snapshot kept for the handling of the report (legal evidence): what was displayed when it was reported.
  evidence    jsonb not null default '{}'::jsonb,
  reporter_ip_hash text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text
);
create index moderation_reports_queue_idx on public.moderation_reports (status, created_at);
create index moderation_reports_parcel_idx on public.moderation_reports (parcel_id);

create table public.moderation_actions (
  id          bigint generated always as identity primary key,
  actor_id    uuid not null,
  action      text not null check (action in (
                'approve_asset', 'reject_asset', 'remove_asset', 'hide_parcel', 'unhide_parcel', 'revoke_parcel',
                'suspend_user', 'unsuspend_user', 'resolve_report', 'dismiss_report', 'feature_parcel', 'unfeature_parcel')),
  target_type text not null check (target_type in ('asset', 'parcel', 'user', 'report')),
  target_id   text not null,
  report_id   uuid references public.moderation_reports (id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index moderation_actions_target_idx on public.moderation_actions (target_type, target_id);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- Append-only: even the service role cannot rewrite history through normal statements.
create or replace function public.px_forbid_mutation() returns trigger language plpgsql as
$$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.px_forbid_mutation();
create trigger moderation_actions_append_only before update or delete on public.moderation_actions
  for each row execute function public.px_forbid_mutation();

/* ------------------------------------------------------------------ infrastructure */

-- Fixed-window rate limiting shared by all serverless instances.
create table public.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

create or replace function public.px_rate_limit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean language plpgsql as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into n;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_max;
end $$;

-- Map version: bumped whenever the visible map changes. Used to bust tile caches and refresh stats.
create table public.map_state (
  id         smallint primary key default 1 check (id = 1),
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.map_state default values;

-- Statement-level with transition tables: a statement that touches 100 000 parcels bumps the version ONCE (a row-level
-- trigger would rewrite the single map_state row 100 000 times in one transaction), and plain reservations
-- (status 'reserved') never touch map_state at all, so they cannot contend on it.
create or replace function public.px_bump_map_version_ins() returns trigger language plpgsql as $$
begin
  if exists (select 1 from new_rows where status = 'active') then
    update public.map_state set version = version + 1, updated_at = now() where id = 1;
  end if;
  return null;
end $$;

create or replace function public.px_bump_map_version_upd() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from old_rows o join new_rows n on n.id = o.id
     where (o.status = 'active' or n.status = 'active')
       and (o.status, o.hidden_at, o.published_asset_id) is distinct from (n.status, n.hidden_at, n.published_asset_id)) then
    update public.map_state set version = version + 1, updated_at = now() where id = 1;
  end if;
  return null;
end $$;

create trigger parcels_map_version_ins after insert on public.parcels
  referencing new table as new_rows for each statement execute function public.px_bump_map_version_ins();
create trigger parcels_map_version_upd after update on public.parcels
  referencing old table as old_rows new table as new_rows for each statement execute function public.px_bump_map_version_upd();

create or replace function public.px_touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;
create trigger parcels_touch before update on public.parcels for each row execute function public.px_touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.px_touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.px_touch_updated_at();
create trigger payments_touch before update on public.payments for each row execute function public.px_touch_updated_at();
