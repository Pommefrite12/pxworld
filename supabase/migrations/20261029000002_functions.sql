-- Pixel World — transactional business logic.
--
-- Every state change that touches the integrity of the map goes through one of these
-- functions, so that it is atomic and testable in SQL. They are callable ONLY by the
-- server (service role / table owner): execute is revoked from anon and authenticated.
--
-- Error convention: `raise exception 'px_<code>'` — the app maps messages to HTTP errors.

/* ------------------------------------------------------------------ reservations */

-- Serialises writers that touch the same 1000×1000 region of the map. The exclusion constraint alone is
-- already SAFE (never two overlapping rows), but two transactions that wait on each other's uncommitted
-- inserts can deadlock; taking these advisory locks first, always in ascending order, turns that into an
-- orderly queue: the loser simply finds the winner's committed row and gets px_parcel_unavailable.
create or replace function public.px_lock_tiles(p_x integer, p_y integer, p_w integer, p_h integer) returns void
language plpgsql as $$
declare tx integer; ty integer;
begin
  for ty in (p_y / 1000) .. ((p_y + p_h - 1) / 1000) loop
    for tx in (p_x / 1000) .. ((p_x + p_w - 1) / 1000) loop
      perform pg_advisory_xact_lock(7001, ty * 64 + tx);
    end loop;
  end loop;
end $$;

-- Releases expired reservations whose parcels overlap the given box (lazily, at reservation time),
-- so a lapsed hold never blocks a new buyer even if the cron job has not run yet.
create or replace function public.px_release_expired_overlapping(p_box box) returns void
language sql as $$
  with exp as (
    update public.parcel_reservations r
       set status = 'expired', resolved_at = now()
      from public.parcels p
     where r.parcel_id = p.id and r.status = 'held' and r.expires_at <= now() and p.bbox && p_box
    returning r.parcel_id, r.order_id
  ), rel as (
    update public.parcels set status = 'released', released_at = now()
     where id in (select parcel_id from exp) and status = 'reserved'
    returning id
  )
  update public.orders set status = 'expired'
   where id in (select order_id from exp where order_id is not null) and status = 'pending';
$$;

-- Atomically: validates, reserves the pixels, creates the order (price computed HERE from
-- app_settings, never taken from the client) and its reservation.
create or replace function public.px_start_order(p_user uuid, p_x integer, p_y integer, p_w integer, p_h integer)
returns table (order_id uuid, parcel_id uuid, reservation_id uuid, amount_cents bigint,
               unit_price_cents integer, currency text, expires_at timestamptz)
language plpgsql as $$
declare
  v_profile public.profiles;
  v_unit integer := public.px_setting_int('price_unit_cents');
  v_ttl integer := public.px_setting_int('reservation_ttl_minutes');
  v_min bigint := public.px_setting_int('min_area');
  v_max bigint := public.px_setting_int('max_area');
  v_cur text := (select value #>> '{}' from public.app_settings where key = 'currency');
  v_box box;
  v_parcel uuid;
  v_order uuid := gen_random_uuid();
  v_res uuid;
  v_expires timestamptz := now() + make_interval(mins => v_ttl);
  v_held bigint;
begin
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sales_open'), false) is not true then
    raise exception 'px_sales_closed';
  end if;
  select * into v_profile from public.profiles where id = p_user;
  if not found or v_profile.deleted_at is not null then raise exception 'px_no_profile'; end if;
  if v_profile.status <> 'active' then raise exception 'px_account_suspended'; end if;
  if p_w is null or p_h is null or p_x is null or p_y is null
     or p_w < 1 or p_h < 1 or p_x < 0 or p_y < 0
     or p_x + p_w > public.px_grid_width() or p_y + p_h > public.px_grid_height()
     or p_w > 1000 or p_h > 1000
     or p_w::bigint * p_h < v_min or p_w::bigint * p_h > v_max
     or (p_w::bigint * p_h) * v_unit > 99999999 then   -- Stripe's per-line maximum (999 999,99 in minor units)
    raise exception 'px_invalid_rect';
  end if;

  v_box := box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8));
  perform public.px_lock_tiles(p_x, p_y, p_w, p_h);
  perform public.px_release_expired_overlapping(v_box);

  -- Hoarding guard: a user can hold only a few unpaid reservations at once.
  select count(*) into v_held from public.parcel_reservations r
   where r.user_id = p_user and r.status = 'held' and r.expires_at > now();
  if v_held >= public.px_setting_int('max_active_reservations_per_user') then
    raise exception 'px_too_many_reservations';
  end if;

  begin
    insert into public.parcels (owner_id, x, y, w, h, status)
    values (p_user, p_x, p_y, p_w, p_h, 'reserved') returning id into v_parcel;
  exception when exclusion_violation then
    raise exception 'px_parcel_unavailable';
  end;

  insert into public.orders (id, user_id, parcel_id, x, y, w, h, area, unit_price_cents, amount_cents, currency, expires_at)
  values (v_order, p_user, v_parcel, p_x, p_y, p_w, p_h, p_w * p_h, v_unit, (p_w * p_h)::bigint * v_unit, v_cur, v_expires);

  insert into public.parcel_reservations (parcel_id, user_id, order_id, expires_at)
  values (v_parcel, p_user, v_order, v_expires) returning id into v_res;

  return query select v_order, v_parcel, v_res, (p_w * p_h)::bigint * v_unit, v_unit, v_cur, v_expires;
end $$;

-- Read-only availability probe used while the buyer is still customising (non-binding).
create or replace function public.px_is_area_free(p_x integer, p_y integer, p_w integer, p_h integer) returns boolean
language sql stable as $$
  select not exists (
    select 1 from public.parcels p
     where p.bbox && box(point(p_x::float8, p_y::float8), point((p_x + p_w - 1)::float8, (p_y + p_h - 1)::float8))
       and (p.status = 'active'
            or (p.status = 'reserved' and exists (
                 select 1 from public.parcel_reservations r
                  where r.parcel_id = p.id and r.status = 'held' and r.expires_at > now())))
  )
$$;

create or replace function public.px_attach_checkout_session(p_order uuid, p_session text) returns void
language sql as $$
  update public.orders set stripe_checkout_session_id = p_session where id = p_order and status = 'pending';
$$;

-- Buyer abandons (or the Stripe session could not be created): free the pixels at once.
create or replace function public.px_cancel_order(p_order uuid, p_user uuid, p_final_status text default 'canceled') returns text
language plpgsql as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order and (p_user is null or user_id = p_user) for update;
  if not found then return 'not_found'; end if;
  if o.status <> 'pending' then return o.status; end if;
  update public.orders set status = p_final_status where id = o.id;
  update public.parcel_reservations set status = case when p_final_status = 'expired' then 'expired' else 'canceled' end,
         resolved_at = now() where order_id = o.id and status = 'held';
  update public.parcels set status = 'released', released_at = now() where id = o.parcel_id and status = 'reserved';
  return p_final_status;
end $$;

-- Checkout completed but the payment is still processing (asynchronous method): keep the pixels held while Stripe finishes.
create or replace function public.px_extend_reservation(p_order uuid, p_hours integer default 120) returns void
language plpgsql as $$
declare v_until timestamptz := now() + make_interval(hours => p_hours);
begin
  update public.parcel_reservations set expires_at = greatest(expires_at, v_until) where order_id = p_order and status = 'held';
  update public.orders set expires_at = greatest(expires_at, v_until) where id = p_order and status = 'pending';
end $$;

-- Hygiene job (cron): expires lapsed holds. Returns the Stripe sessions that may still be open.
create or replace function public.px_expire_reservations(p_limit integer default 500)
returns table (order_id uuid, stripe_checkout_session_id text)
language plpgsql as $$
begin
  return query
  with due as (
    select r.id, r.parcel_id, r.order_id from public.parcel_reservations r
     where r.status = 'held' and r.expires_at <= now()
     order by r.expires_at limit p_limit for update skip locked
  ), r2 as (
    update public.parcel_reservations r set status = 'expired', resolved_at = now()
      from due where r.id = due.id returning due.parcel_id, due.order_id
  ), p2 as (
    update public.parcels p set status = 'released', released_at = now()
      from r2 where p.id = r2.parcel_id and p.status = 'reserved' returning p.id
  ), o2 as (
    update public.orders o set status = 'expired'
      from r2 where o.id = r2.order_id and o.status = 'pending'
    returning o.id, o.stripe_checkout_session_id
  )
  select o2.id, o2.stripe_checkout_session_id from o2;
end $$;

/* ------------------------------------------------------------------ payments */

-- Attribute a paid order. Called ONLY from a verified Stripe webhook (or the reconciliation job
-- after retrieving the session from Stripe's API). Idempotent: replays return 'already_paid'.
-- Outcomes: fulfilled | already_paid | refund_required | ignored
create or replace function public.px_fulfill_order(
  p_order uuid, p_session text, p_payment_intent text, p_charge text,
  p_amount_subtotal bigint, p_amount_tax bigint, p_amount_total bigint, p_currency text,
  p_email text, p_country text, p_name text, p_tax_ids jsonb, p_invoice_url text default null)
returns text
language plpgsql as $$
declare
  o public.orders;
  v_updated integer;
begin
  -- Same lock order as px_start_order (tiles first, then rows) so the two can never deadlock.
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'px_order_not_found'; end if;
  perform public.px_lock_tiles(o.x, o.y, o.w, o.h);
  select * into o from public.orders where id = p_order for update;
  if o.stripe_checkout_session_id is not null and p_session is not null and o.stripe_checkout_session_id <> p_session then
    raise exception 'px_session_mismatch';
  end if;
  if o.status = 'paid' then return 'already_paid'; end if;
  if o.status in ('refunded', 'disputed', 'dispute_lost', 'refund_required') then return 'ignored'; end if;

  if p_payment_intent is not null then
    insert into public.payments (order_id, stripe_payment_intent_id, stripe_charge_id, status, amount_cents, currency)
    values (o.id, p_payment_intent, p_charge, 'succeeded', coalesce(p_amount_total, p_amount_subtotal), p_currency)
    on conflict (stripe_payment_intent_id) do update
      set status = 'succeeded', stripe_charge_id = coalesce(excluded.stripe_charge_id, public.payments.stripe_charge_id),
          amount_cents = excluded.amount_cents, failure_code = null, failure_message = null;
  end if;

  -- The amount actually charged must match what the server priced (tax excluded by Stripe in amount_subtotal).
  if p_amount_subtotal is distinct from o.amount_cents or lower(p_currency) <> o.currency then
    update public.orders set status = 'refund_required', stripe_payment_intent_id = p_payment_intent,
           customer_email = p_email where id = o.id;
    update public.parcel_reservations set status = 'canceled', resolved_at = now() where order_id = o.id and status = 'held';
    update public.parcels set status = 'released', released_at = now() where id = o.parcel_id and status = 'reserved';
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'order.amount_mismatch', 'order', o.id::text,
            jsonb_build_object('expected', o.amount_cents, 'received', p_amount_subtotal, 'currency', p_currency));
    return 'refund_required';
  end if;

  begin
    update public.parcels set status = 'active', activated_at = now()
     where id = o.parcel_id and status in ('reserved', 'released');
    get diagnostics v_updated = row_count;
  exception when exclusion_violation then
    v_updated := 0;  -- the hold lapsed and somebody else took the pixels meanwhile
  end;

  if v_updated = 0 then
    update public.orders set status = 'refund_required', stripe_payment_intent_id = p_payment_intent,
           customer_email = p_email, paid_at = now() where id = o.id;
    update public.parcel_reservations set status = 'expired', resolved_at = now() where order_id = o.id and status = 'held';
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'order.refund_required', 'order', o.id::text, jsonb_build_object('reason', 'pixels_unavailable'));
    return 'refund_required';
  end if;

  update public.parcel_reservations set status = 'converted', resolved_at = now() where order_id = o.id and status in ('held', 'expired');
  update public.orders set
      status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent,
      amount_subtotal_cents = p_amount_subtotal, amount_tax_cents = p_amount_tax, amount_total_cents = p_amount_total,
      customer_email = p_email, billing_country = nullif(upper(p_country), ''), billing_name = p_name,
      tax_ids = p_tax_ids, invoice_url = p_invoice_url
    where id = o.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'order.paid', 'order', o.id::text, jsonb_build_object('parcel_id', o.parcel_id, 'amount_cents', o.amount_cents));
  return 'fulfilled';
end $$;

create or replace function public.px_record_payment_failure(p_payment_intent text, p_order uuid, p_amount bigint, p_currency text,
                                                            p_code text, p_message text) returns void
language plpgsql as $$
begin
  if p_order is null or not exists (select 1 from public.orders where id = p_order) then return; end if;
  insert into public.payments (order_id, stripe_payment_intent_id, status, amount_cents, currency, failure_code, failure_message)
  values (p_order, p_payment_intent, 'failed', p_amount, p_currency, p_code, left(p_message, 500))
  on conflict (stripe_payment_intent_id) do update
    set failure_code = excluded.failure_code, failure_message = excluded.failure_message
    where public.payments.status = 'failed';   -- never downgrade a succeeded payment
end $$;

-- Refund (full or partial) reported by Stripe. A full refund returns the pixels to the market.
create or replace function public.px_record_refund(p_payment_intent text, p_amount_refunded bigint) returns text
language plpgsql as $$
declare
  pay public.payments;
  o public.orders;
  v_full boolean;
begin
  select * into pay from public.payments where stripe_payment_intent_id = p_payment_intent for update;
  if not found then return 'unknown_payment'; end if;
  v_full := p_amount_refunded >= pay.amount_cents;
  update public.payments set amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded),
         status = case when v_full then 'refunded' else 'partially_refunded' end where id = pay.id;
  select * into o from public.orders where id = pay.order_id for update;
  if v_full then
    if o.status = 'refund_required' then
      update public.orders set status = 'refunded' where id = o.id;
    elsif o.status in ('paid', 'disputed') then
      update public.orders set status = 'refunded' where id = o.id;
      update public.parcels set status = 'revoked', released_at = now() where id = o.parcel_id and status = 'active';
    end if;
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'order.refunded', 'order', o.id::text, jsonb_build_object('amount_refunded', p_amount_refunded));
    return 'refunded';
  end if;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'order.partially_refunded', 'order', o.id::text, jsonb_build_object('amount_refunded', p_amount_refunded));
  return 'partially_refunded';
end $$;

-- Dispute lifecycle: opened → hide the content (ownership kept); won → restore; lost → revoke the parcel.
create or replace function public.px_record_dispute(p_payment_intent text, p_outcome text) returns text
language plpgsql as $$
declare
  pay public.payments;
  o public.orders;
begin
  select * into pay from public.payments where stripe_payment_intent_id = p_payment_intent for update;
  if not found then return 'unknown_payment'; end if;
  select * into o from public.orders where id = pay.order_id for update;

  if p_outcome = 'opened' then
    update public.payments set status = 'disputed' where id = pay.id;
    if o.status = 'paid' then update public.orders set status = 'disputed' where id = o.id; end if;
    update public.parcels set hidden_at = coalesce(hidden_at, now()), hidden_reason = coalesce(hidden_reason, 'dispute')
     where id = o.parcel_id and status = 'active';
  elsif p_outcome = 'won' then
    update public.payments set status = 'dispute_won' where id = pay.id;
    if o.status = 'disputed' then update public.orders set status = 'paid' where id = o.id; end if;
    update public.parcels set hidden_at = null, hidden_reason = null where id = o.parcel_id and hidden_reason = 'dispute';
  elsif p_outcome = 'lost' then
    update public.payments set status = 'dispute_lost' where id = pay.id;
    update public.orders set status = 'dispute_lost' where id = o.id;
    update public.parcels set status = 'revoked', released_at = now() where id = o.parcel_id and status = 'active';
  else
    raise exception 'px_bad_dispute_outcome';
  end if;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'order.dispute_' || p_outcome, 'order', o.id::text, '{}'::jsonb);
  return p_outcome;
end $$;

/* ------------------------------------------------------------------ creations */

-- Adds a new version of a parcel's creation (status 'pending'). A previous pending version is superseded.
create or replace function public.px_add_asset(
  p_user uuid, p_parcel uuid, p_storage_path text, p_hash text, p_width integer, p_height integer, p_bytes integer,
  p_avg_color text, p_title text, p_description text, p_link text, p_commercial boolean)
returns public.parcel_assets
language plpgsql as $$
declare
  pc public.parcels;
  a public.parcel_assets;
  v_status text;
begin
  select * into pc from public.parcels where id = p_parcel for update;
  if not found or pc.owner_id <> p_user then raise exception 'px_forbidden'; end if;
  if pc.status not in ('reserved', 'active') then raise exception 'px_parcel_not_editable'; end if;
  if (select status from public.profiles where id = p_user) <> 'active' then raise exception 'px_account_suspended'; end if;
  if p_width <> pc.w or p_height <> pc.h then raise exception 'px_bad_dimensions'; end if;

  update public.parcel_assets set status = 'superseded' where parcel_id = p_parcel and status = 'pending';
  insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes,
                                    avg_color, title, description, link_url, is_commercial)
  values (p_parcel, p_user, coalesce((select max(version) from public.parcel_assets where parcel_id = p_parcel), 0) + 1,
          p_storage_path, p_hash, p_width, p_height, p_bytes, p_avg_color, p_title, p_description, p_link, p_commercial)
  returning * into a;
  return a;
end $$;

/* ------------------------------------------------------------------ moderation (staff) */

create or replace function public.px_require_staff(p_actor uuid, p_min text default 'moderator') returns text
language plpgsql stable as $$
declare r text := public.px_staff_role(p_actor);
begin
  if r is null or (p_min = 'admin' and r <> 'admin') then raise exception 'px_forbidden'; end if;
  return r;
end $$;

create or replace function public.px_review_asset(p_actor uuid, p_asset uuid, p_decision text, p_reason text default null) returns text
language plpgsql as $$
declare
  a public.parcel_assets;
  pc public.parcels;
  v_role text := public.px_require_staff(p_actor);
begin
  if p_decision not in ('approve', 'reject') then raise exception 'px_bad_decision'; end if;
  select * into a from public.parcel_assets where id = p_asset for update;
  if not found then raise exception 'px_not_found'; end if;
  select * into pc from public.parcels where id = a.parcel_id for update;
  if a.status <> 'pending' then raise exception 'px_not_pending'; end if;

  if p_decision = 'approve' then
    if pc.status <> 'active' then raise exception 'px_parcel_not_active'; end if;
    update public.parcel_assets set status = 'superseded' where id = pc.published_asset_id and status = 'approved';
    update public.parcel_assets set status = 'approved', reviewed_by = p_actor, reviewed_at = now(), published_at = now() where id = a.id;
    update public.parcels set published_asset_id = a.id where id = pc.id;
  else
    update public.parcel_assets set status = 'rejected', reviewed_by = p_actor, reviewed_at = now(), rejection_reason = p_reason where id = a.id;
  end if;
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason)
  values (p_actor, p_decision || '_asset', 'asset', a.id::text, p_reason);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'asset.' || p_decision, 'asset', a.id::text, jsonb_build_object('parcel_id', pc.id, 'reason', p_reason));
  return p_decision;
end $$;

-- Hide / unhide a parcel's content. The parcel stays sold (the pixels were paid for).
create or replace function public.px_set_parcel_hidden(p_actor uuid, p_parcel uuid, p_hidden boolean, p_reason text default null) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor);
begin
  update public.parcels
     set hidden_at = case when p_hidden then coalesce(hidden_at, now()) else null end,
         hidden_reason = case when p_hidden then coalesce(p_reason, 'moderation') else null end
   where id = p_parcel and status = 'active';
  if not found then raise exception 'px_not_found'; end if;
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason)
  values (p_actor, case when p_hidden then 'hide_parcel' else 'unhide_parcel' end, 'parcel', p_parcel::text, p_reason);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, case when p_hidden then 'parcel.hide' else 'parcel.unhide' end, 'parcel', p_parcel::text,
          jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.px_set_user_suspended(p_actor uuid, p_user uuid, p_suspended boolean, p_reason text default null) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  if p_user = p_actor then raise exception 'px_forbidden'; end if;
  update public.profiles set status = case when p_suspended then 'suspended' else 'active' end,
         suspended_reason = case when p_suspended then p_reason else null end where id = p_user;
  if not found then raise exception 'px_not_found'; end if;
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason)
  values (p_actor, case when p_suspended then 'suspend_user' else 'unsuspend_user' end, 'user', p_user::text, p_reason);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, case when p_suspended then 'user.suspend' else 'user.unsuspend' end, 'user', p_user::text,
          jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.px_resolve_report(p_actor uuid, p_report uuid, p_resolution text, p_note text default null) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor);
begin
  if p_resolution not in ('actioned', 'dismissed', 'reviewing') then raise exception 'px_bad_decision'; end if;
  update public.moderation_reports set status = p_resolution, resolution_note = p_note,
         resolved_by = case when p_resolution = 'reviewing' then null else p_actor end,
         resolved_at = case when p_resolution = 'reviewing' then null else now() end
   where id = p_report;
  if not found then raise exception 'px_not_found'; end if;
  insert into public.moderation_actions (actor_id, action, target_type, target_id, report_id, reason)
  values (p_actor, case when p_resolution = 'dismissed' then 'dismiss_report' else 'resolve_report' end, 'report', p_report::text, p_report, p_note);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'report.' || p_resolution, 'report', p_report::text, jsonb_build_object('note', p_note));
end $$;

-- Admin-only: remove a parcel (frees the pixels; the purchase should be refunded separately in Stripe).
create or replace function public.px_revoke_parcel(p_actor uuid, p_parcel uuid, p_reason text) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  update public.parcels set status = 'revoked', released_at = now() where id = p_parcel and status = 'active';
  if not found then raise exception 'px_not_found'; end if;
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason)
  values (p_actor, 'revoke_parcel', 'parcel', p_parcel::text, p_reason);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'parcel.revoke', 'parcel', p_parcel::text, jsonb_build_object('reason', p_reason));
end $$;

-- Admin-only pricing change; applies to FUTURE orders only (existing orders keep their snapshot price).
create or replace function public.px_set_setting(p_actor uuid, p_key text, p_value jsonb) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  if p_key not in ('price_unit_cents', 'min_area', 'max_area', 'reservation_ttl_minutes', 'max_active_reservations_per_user', 'sales_open') then
    raise exception 'px_bad_setting';
  end if;
  if p_key = 'sales_open' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'px_bad_setting'; end if;
  else
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)
       or (p_value #>> '{}')::numeric < 1 then raise exception 'px_bad_setting'; end if;
    if p_key = 'min_area' and (p_value #>> '{}')::numeric < 100 then raise exception 'px_bad_setting'; end if;
    if p_key = 'max_area' and (p_value #>> '{}')::numeric > 1000000 then raise exception 'px_bad_setting'; end if;
    if p_key = 'reservation_ttl_minutes' and (p_value #>> '{}')::numeric < 32 then raise exception 'px_bad_setting'; end if;
  end if;
  update public.app_settings set value = p_value, updated_by = p_actor, updated_at = now() where key = p_key;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'setting.update', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

/* ------------------------------------------------------------------ public statistics */

-- Real figures only, computed from parcels. The app caches the result for a short time.
create or replace function public.px_public_stats()
returns table (sold_pixels bigint, parcels bigint, owners bigint, published_creations bigint, map_version bigint)
language sql stable as $$
  select coalesce(sum(p.area), 0)::bigint,
         count(*)::bigint,
         count(distinct p.owner_id)::bigint,
         count(*) filter (where p.published_asset_id is not null and p.hidden_at is null)::bigint,
         (select version from public.map_state where id = 1)
    from public.parcels p where p.status = 'active'
$$;

/* ------------------------------------------------------------------ privileges */

-- Business functions are server-only.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'px\_%' and p.proname not in ('px_is_staff')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
