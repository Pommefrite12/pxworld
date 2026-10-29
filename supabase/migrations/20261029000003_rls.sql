-- Pixel World — Row Level Security.
--
-- The browser only ever holds the Supabase anon key (+ the signed-in user's JWT). Anything that can be
-- reached through PostgREST must therefore be safe by itself:
--   * RLS is ENABLED (and FORCED for table owners other than the service role) on every table.
--   * Default grants are revoked, then only what is needed is granted back, column by column.
--   * All writes that matter (reservations, orders, payments, moderation, uploads) happen server-side
--     through the px_* functions with the service role. Clients get read access to public data only.
-- Staff rights come from the admin_roles table (never from a client-editable flag).

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

/* profiles: public identity, editable by its owner (only safe columns) */
grant select (id, username, avatar_path, country, bio, status, created_at) on public.profiles to anon, authenticated;
grant update (username, avatar_path, country, bio) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select using (deleted_at is null);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and status = 'active') with check (id = auth.uid());
create policy profiles_staff_read on public.profiles for select to authenticated using (public.px_is_staff());

/* parcels: the map is public; reservations are visible to their owner only */
grant select (id, code, owner_id, x, y, w, h, area, status, published_asset_id, hidden_at, created_at, activated_at) on public.parcels to anon, authenticated;
create policy parcels_public_read on public.parcels for select using (status = 'active');
create policy parcels_owner_read on public.parcels for select to authenticated using (owner_id = auth.uid());
create policy parcels_staff_read on public.parcels for select to authenticated using (public.px_is_staff());

/* parcel_assets: only approved versions of visible parcels are public; owners see all their versions */
grant select (id, parcel_id, uploader_id, version, width, height, bytes, avg_color, title, description, link_url, is_commercial,
              status, rejection_reason, published_at, created_at) on public.parcel_assets to anon, authenticated;
create policy assets_public_read on public.parcel_assets for select
  using (status = 'approved' and exists (select 1 from public.parcels p where p.id = parcel_id and p.status = 'active' and p.hidden_at is null));
create policy assets_owner_read on public.parcel_assets for select to authenticated using (uploader_id = auth.uid());
create policy assets_staff_read on public.parcel_assets for select to authenticated using (public.px_is_staff());

/* orders / payments / reservations: buyer reads their own, staff read all. No client writes. */
grant select on public.orders, public.parcel_reservations to authenticated;
grant select (id, order_id, status, amount_cents, amount_refunded_cents, currency, created_at) on public.payments to authenticated;
create policy orders_owner_read on public.orders for select to authenticated using (user_id = auth.uid());
create policy orders_staff_read on public.orders for select to authenticated using (public.px_is_staff());
create policy reservations_owner_read on public.parcel_reservations for select to authenticated using (user_id = auth.uid());
create policy reservations_staff_read on public.parcel_reservations for select to authenticated using (public.px_is_staff());
create policy payments_owner_read on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy payments_staff_read on public.payments for select to authenticated using (public.px_is_staff());

/* likes: a user manages their own; the counts are exposed by the app */
grant select, insert, delete on public.parcel_likes to authenticated;
create policy likes_own_read on public.parcel_likes for select to authenticated using (user_id = auth.uid());
create policy likes_own_insert on public.parcel_likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
              and exists (select 1 from public.parcels c where c.id = parcel_id and c.status = 'active'));
create policy likes_own_delete on public.parcel_likes for delete to authenticated using (user_id = auth.uid());

/* editorial selection is public */
grant select on public.parcel_features to anon, authenticated;
create policy features_public_read on public.parcel_features for select using (true);

/* reports: reporters see their own (no evidence/IP columns); staff use the server-side admin area */
grant select (id, parcel_id, reason, status, created_at) on public.moderation_reports to authenticated;
create policy reports_own_read on public.moderation_reports for select to authenticated using (reporter_id = auth.uid());
create policy reports_staff_read on public.moderation_reports for select to authenticated using (public.px_is_staff());

/* settings are public and read-only (price shown to everybody) */
grant select (key, value, updated_at) on public.app_settings to anon, authenticated;
create policy settings_public_read on public.app_settings for select using (key <> 'secret');

/* logs: staff read-only (append-only enforced by triggers). admin_roles, stripe_events, rate_limits, map_state: no client access. */
grant select on public.audit_logs, public.moderation_actions to authenticated;
create policy audit_staff_read on public.audit_logs for select to authenticated using (public.px_is_staff());
create policy modactions_staff_read on public.moderation_actions for select to authenticated using (public.px_is_staff());
grant select on public.map_state to anon, authenticated;
create policy map_state_public_read on public.map_state for select using (true);

-- Helper reachable from RLS expressions only.
grant execute on function public.px_is_staff() to anon, authenticated;
