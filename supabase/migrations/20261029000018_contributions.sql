-- "Fund it together", steps 2 and 3: people pay a share of an open project (contributions); when the goal is reached the parcel is
-- bought; when the time runs out or the project is withdrawn, everybody is refunded.
--
-- THE RULES OF THE MONEY (everything is decided here, in PostgreSQL, never in the application):
--  * A contribution is a payment of its own, in the project's currency. The amount is chosen by the contributor but CHECKED here:
--    at least `campaign_min_contribution_cents` (except the very last bit of the goal), never more than what is still missing, and it
--    never leaves less than 50 cents to fund (a payment smaller than the card network's minimum could never complete the goal).
--  * The goal is never exceeded: a payment IN PROGRESS holds its share of what is still missing (like unpaid pixels are held) for the
--    reservation delay; the project row is locked to count. A payment that arrives too late for its place, or after the project is
--    closed, is refused by `px_fulfill_contribution` and refunded.
--  * The goal reached → in the same transaction the parcel becomes the creator's (`px_complete_campaign`): active, its approved creation
--    published, the hold converted. No paid contribution is ever left over: paid never exceeds the goal.
--  * The project ends unfunded (deadline passed, or withdrawn) → every paid contribution becomes `refund_required` in the same
--    transaction as the closing; the application then issues the refunds (and retries them until Stripe confirms).
--  * Contributions are anonymous towards the public (only a count is shown); the table is server-only.

create table public.contributions (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns (id) on delete restrict,
  user_id       uuid not null references public.profiles (id) on delete restrict,
  amount_cents  bigint not null check (amount_cents > 0),
  currency      text not null,
  -- pending: the payment is in progress (its share is held) · paid · expired: the hold ran out unpaid · canceled: abandoned
  -- refund_required: paid, but must be given back (project closed unfunded, late payment, wrong amount) · refunded
  -- disputed / dispute_lost: a chargeback is open / was lost (a disputed contribution still counts as raised until it is lost)
  status        text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'canceled', 'refund_required', 'refunded', 'disputed', 'dispute_lost')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  amount_subtotal_cents bigint,
  amount_tax_cents      bigint,
  amount_total_cents    bigint,
  amount_refunded_cents bigint not null default 0,
  customer_email        text,
  billing_country       char(2),
  expires_at    timestamptz not null,
  paid_at       timestamptz,
  refunded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index contributions_campaign_idx on public.contributions (campaign_id, status);
create index contributions_user_idx on public.contributions (user_id, created_at desc);
create index contributions_pi_idx on public.contributions (stripe_payment_intent_id);
create index contributions_pending_idx on public.contributions (expires_at) where status = 'pending';
create index contributions_refund_idx on public.contributions (created_at) where status = 'refund_required';
-- one payment in progress per person and project: nobody can lock the whole missing amount with many open payments
create unique index contributions_one_pending on public.contributions (campaign_id, user_id) where status = 'pending';

alter table public.contributions enable row level security;
revoke all on table public.contributions from anon, authenticated;

/* ------------------------------------------------------------------ starting a contribution */

create or replace function public.px_start_contribution(p_user uuid, p_campaign uuid, p_amount bigint)
returns table (contribution_id uuid, amount_cents bigint, currency text, expires_at timestamptz)
language plpgsql as $$
#variable_conflict use_column
declare
  c public.campaigns;
  v_min bigint := public.px_setting_int('campaign_min_contribution_cents');
  v_paid bigint;
  v_held bigint;
  v_rem bigint;
  v_id uuid := gen_random_uuid();
  v_exp timestamptz := now() + make_interval(mins => public.px_setting_int('reservation_ttl_minutes')::integer);
begin
  select * into c from public.campaigns where id = p_campaign;
  if not found then raise exception 'px_not_found'; end if;
  -- same lock order as everywhere: the tiles, then the rows
  perform public.px_lock_tiles(c.x, c.y, c.w, c.h);
  select * into c from public.campaigns where id = p_campaign for update;
  if c.status <> 'open' or c.deadline is null or c.deadline <= now() then raise exception 'px_campaign_closed'; end if;
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sales_open'), false) is not true then
    raise exception 'px_sales_closed';
  end if;
  if (select status from public.profiles where id = p_user and deleted_at is null) is distinct from 'active' then raise exception 'px_account_suspended'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'px_invalid_amount'; end if;

  -- the holds that ran out are over
  update public.contributions set status = 'expired', updated_at = now() where campaign_id = c.id and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.contributions where campaign_id = c.id and user_id = p_user and status = 'pending') then
    raise exception 'px_contribution_in_progress';
  end if;

  select coalesce(sum(k.amount_cents) filter (where k.status in ('paid', 'disputed')), 0),
         coalesce(sum(k.amount_cents) filter (where k.status = 'pending'), 0)
    into v_paid, v_held from public.contributions k where k.campaign_id = c.id;
  v_rem := c.goal_cents - v_paid - v_held;
  if v_rem < 1 then raise exception 'px_campaign_full'; end if;             -- everything is paid, or being paid
  if p_amount > v_rem then raise exception 'px_amount_too_high'; end if;
  if p_amount < v_min and p_amount <> v_rem then raise exception 'px_amount_too_low'; end if;
  if p_amount <> v_rem and v_rem - p_amount < 50 then raise exception 'px_amount_leaves_dust'; end if;

  insert into public.contributions (id, campaign_id, user_id, amount_cents, currency, expires_at)
  values (v_id, c.id, p_user, p_amount, c.currency, v_exp);
  return query select v_id, p_amount, c.currency, v_exp;
end $$;
revoke all on function public.px_start_contribution(uuid, uuid, bigint) from public, anon, authenticated;

create or replace function public.px_attach_contribution_session(p_contribution uuid, p_session text) returns void
language sql as $$
  update public.contributions set stripe_checkout_session_id = p_session, updated_at = now() where id = p_contribution and status = 'pending';
$$;
revoke all on function public.px_attach_contribution_session(uuid, text) from public, anon, authenticated;

-- The contributor abandons (or the payment session could not be created): the share is given back at once.
create or replace function public.px_cancel_contribution(p_contribution uuid, p_user uuid, p_final_status text default 'canceled') returns text
language plpgsql as $$
declare k public.contributions;
begin
  select * into k from public.contributions where id = p_contribution and (p_user is null or user_id = p_user) for update;
  if not found then return 'not_found'; end if;
  if k.status <> 'pending' then return k.status; end if;
  update public.contributions set status = p_final_status, updated_at = now() where id = k.id;
  return p_final_status;
end $$;
revoke all on function public.px_cancel_contribution(uuid, uuid, text) from public, anon, authenticated;

/* ------------------------------------------------------------------ closing a campaign */

-- A project that ends WITHOUT its parcel being bought: its zone is given back, the payments in progress are over, and every
-- paid contribution must be refunded. `p_status` is 'expired' or 'cancelled'. The campaign row must be locked by the caller.
create or replace function public.px_close_campaign(p_campaign uuid, p_status text) returns integer
language plpgsql as $$
declare
  c public.campaigns;
  v_refunds integer;
begin
  select * into c from public.campaigns where id = p_campaign;
  if c.parcel_id is not null then
    update public.parcel_reservations set status = case when p_status = 'expired' then 'expired' else 'canceled' end, resolved_at = now()
     where parcel_id = c.parcel_id and status = 'held';
    update public.parcels set status = 'released', released_at = now() where id = c.parcel_id and status = 'reserved';
  end if;
  update public.contributions set status = 'expired', updated_at = now() where campaign_id = c.id and status = 'pending';
  update public.contributions set status = 'refund_required', updated_at = now() where campaign_id = c.id and status = 'paid';
  get diagnostics v_refunds = row_count;
  update public.campaigns set status = p_status, closed_at = now(), updated_at = now() where id = c.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'campaign.' || p_status, 'campaign', c.id::text, jsonb_build_object('refunds_due', v_refunds));
  return v_refunds;
end $$;
revoke all on function public.px_close_campaign(uuid, text) from public, anon, authenticated;

-- The goal is reached: the parcel is the creator's. Called by px_fulfill_contribution with the campaign row locked. Returns false if the
-- zone could not be kept (it should never happen: the hold lasts until the deadline); everything is then given back.
create or replace function public.px_complete_campaign(p_campaign uuid) returns boolean
language plpgsql as $$
declare
  c public.campaigns;
  v_asset uuid;
  v_n integer;
begin
  select * into c from public.campaigns where id = p_campaign;
  select id into v_asset from public.parcel_assets where parcel_id = c.parcel_id and status = 'approved' order by version desc limit 1;
  update public.parcels set status = 'active', activated_at = now(), published_asset_id = v_asset where id = c.parcel_id and status = 'reserved';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    perform public.px_close_campaign(c.id, 'expired');
    return false;
  end if;
  update public.parcel_assets set published_at = now() where id = v_asset;
  update public.parcel_reservations set status = 'converted', resolved_at = now() where parcel_id = c.parcel_id and status in ('held', 'expired');
  update public.campaigns set status = 'funded', funded_at = now(), closed_at = now(), updated_at = now() where id = c.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'campaign.funded', 'campaign', c.id::text, jsonb_build_object('parcel_id', c.parcel_id, 'goal_cents', c.goal_cents));
  return true;
end $$;
revoke all on function public.px_complete_campaign(uuid) from public, anon, authenticated;

/* ------------------------------------------------------------------ a payment arrives */

-- Called ONLY from a verified Stripe webhook (or the reconciliation job, after asking Stripe). Idempotent: a replay answers
-- 'already_paid'. Outcomes: fulfilled | funded (this payment completed the goal) | already_paid | refund_required | ignored
create or replace function public.px_fulfill_contribution(
  p_contribution uuid, p_session text, p_payment_intent text,
  p_amount_subtotal bigint, p_amount_tax bigint, p_amount_total bigint, p_currency text, p_email text, p_country text)
returns text
language plpgsql as $$
declare
  k public.contributions;
  c public.campaigns;
  v_paid bigint;
  v_others bigint;
  v_reason text;
begin
  select * into k from public.contributions where id = p_contribution;
  if not found then raise exception 'px_contribution_not_found'; end if;
  select * into c from public.campaigns where id = k.campaign_id;
  perform public.px_lock_tiles(c.x, c.y, c.w, c.h);
  select * into c from public.campaigns where id = k.campaign_id for update;
  select * into k from public.contributions where id = p_contribution for update;
  if k.stripe_checkout_session_id is not null and p_session is not null and k.stripe_checkout_session_id <> p_session then
    raise exception 'px_session_mismatch';
  end if;
  if k.status in ('paid', 'disputed') then return 'already_paid'; end if;
  if k.status in ('refunded', 'refund_required', 'dispute_lost') then return 'ignored'; end if;

  -- 1. the amount actually charged must be what the server decided (tax is excluded by Stripe in amount_subtotal)
  if p_amount_subtotal is distinct from k.amount_cents or lower(p_currency) <> k.currency then
    v_reason := 'amount_mismatch';
  -- 2. the project must still be open, and its time not over
  elsif c.status <> 'open' or c.deadline <= now() then
    v_reason := 'campaign_closed';
  else
    -- 3. never above the goal: what is paid + what other people are paying + this payment (a late payment, whose hold ran out, still
    --    gets its place if nobody else took it)
    select coalesce(sum(x.amount_cents) filter (where x.status in ('paid', 'disputed')), 0),
           coalesce(sum(x.amount_cents) filter (where x.status = 'pending' and x.id <> k.id), 0)
      into v_paid, v_others from public.contributions x where x.campaign_id = c.id;
    if v_paid + v_others + k.amount_cents > c.goal_cents then v_reason := 'over_goal'; end if;
  end if;

  if v_reason is not null then
    update public.contributions set status = 'refund_required', stripe_payment_intent_id = p_payment_intent, customer_email = p_email,
           amount_total_cents = p_amount_total, paid_at = now(), updated_at = now() where id = k.id;
    insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
    values ('system', 'contribution.refund_required', 'contribution', k.id::text,
            jsonb_build_object('reason', v_reason, 'campaign_id', c.id, 'expected', k.amount_cents, 'received', p_amount_subtotal, 'currency', p_currency));
    return 'refund_required';
  end if;

  update public.contributions set status = 'paid', paid_at = now(), updated_at = now(), stripe_payment_intent_id = p_payment_intent,
         amount_subtotal_cents = p_amount_subtotal, amount_tax_cents = p_amount_tax, amount_total_cents = p_amount_total,
         customer_email = p_email, billing_country = nullif(upper(p_country), '')
   where id = k.id;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'contribution.paid', 'contribution', k.id::text, jsonb_build_object('campaign_id', c.id, 'amount_cents', k.amount_cents));

  if v_paid + k.amount_cents >= c.goal_cents then
    if public.px_complete_campaign(c.id) then return 'funded'; end if;
    return 'refund_required';   -- the zone could not be kept: the project was closed and this payment is due back
  end if;
  return 'fulfilled';
end $$;
revoke all on function public.px_fulfill_contribution(uuid, text, text, bigint, bigint, bigint, text, text, text) from public, anon, authenticated;

/* ------------------------------------------------------------------ refunds and disputes reported by Stripe */

create or replace function public.px_record_contribution_refund(p_payment_intent text, p_amount_refunded bigint) returns text
language plpgsql as $$
declare
  k public.contributions;
  c public.campaigns;
  v_full boolean;
begin
  select * into k from public.contributions where stripe_payment_intent_id = p_payment_intent for update;
  if not found then return 'unknown_payment'; end if;
  select * into c from public.campaigns where id = k.campaign_id;
  v_full := p_amount_refunded >= coalesce(k.amount_total_cents, k.amount_cents);
  update public.contributions set amount_refunded_cents = greatest(amount_refunded_cents, p_amount_refunded), updated_at = now(),
         status = case when v_full and status in ('paid', 'refund_required', 'disputed') then 'refunded' else status end,
         refunded_at = case when v_full then coalesce(refunded_at, now()) else refunded_at end
   where id = k.id;
  -- a refund of a contribution to a project that is ALREADY funded (a staff refund, a customer's bank): the parcel is not touched
  -- automatically, a human decides (the application raises an alert from this audit line)
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', case when v_full then 'contribution.refunded' else 'contribution.partially_refunded' end, 'contribution', k.id::text,
          jsonb_build_object('amount_refunded', p_amount_refunded, 'campaign_status', c.status, 'after_funding', c.status = 'funded' and k.status = 'paid'));
  return case when v_full then 'refunded' else 'partially_refunded' end;
end $$;
revoke all on function public.px_record_contribution_refund(text, bigint) from public, anon, authenticated;

create or replace function public.px_record_contribution_dispute(p_payment_intent text, p_outcome text) returns text
language plpgsql as $$
declare k public.contributions;
begin
  select * into k from public.contributions where stripe_payment_intent_id = p_payment_intent for update;
  if not found then return 'unknown_payment'; end if;
  if p_outcome = 'opened' then
    update public.contributions set status = 'disputed', updated_at = now() where id = k.id and status = 'paid';
  elsif p_outcome = 'won' then
    update public.contributions set status = 'paid', updated_at = now() where id = k.id and status = 'disputed';
  elsif p_outcome = 'lost' then
    update public.contributions set status = 'dispute_lost', updated_at = now() where id = k.id and status in ('paid', 'disputed');
  else
    raise exception 'px_bad_dispute_outcome';
  end if;
  insert into public.audit_logs (actor_role, action, target_type, target_id, metadata)
  values ('system', 'contribution.dispute_' || p_outcome, 'contribution', k.id::text, jsonb_build_object('campaign_id', k.campaign_id));
  return p_outcome;
end $$;
revoke all on function public.px_record_contribution_dispute(text, text) from public, anon, authenticated;

/* ------------------------------------------------------------------ withdrawing and expiring now refund */

-- (replaces the step-1 versions, which had no contributions to look after)
create or replace function public.px_cancel_campaign(p_user uuid, p_campaign uuid) returns text
language plpgsql as $$
declare
  c public.campaigns;
  v_refunds integer := 0;
begin
  select * into c from public.campaigns where id = p_campaign;
  if not found or c.creator_id <> p_user then raise exception 'px_not_found'; end if;
  if c.parcel_id is not null then perform public.px_lock_tiles(c.x, c.y, c.w, c.h); end if;
  select * into c from public.campaigns where id = p_campaign for update;
  if c.status not in ('pending', 'open') then raise exception 'px_not_cancellable'; end if;
  if c.status = 'open' then
    v_refunds := public.px_close_campaign(c.id, 'cancelled');
  else
    update public.campaigns set status = 'cancelled', closed_at = now(), updated_at = now() where id = c.id;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_user, 'user', 'campaign.cancel', 'campaign', c.id::text, jsonb_build_object('was', c.status, 'refunds_due', v_refunds));
  return 'cancelled';
end $$;
revoke all on function public.px_cancel_campaign(uuid, uuid) from public, anon, authenticated;

create or replace function public.px_expire_campaigns(p_limit integer default 100) returns integer
language plpgsql as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id, x, y, w, h from public.campaigns where status = 'open' and deadline <= now() order by deadline limit p_limit
  loop
    perform public.px_lock_tiles(r.x, r.y, r.w, r.h);
    -- re-read under the lock: a payment may have just completed the goal
    perform 1 from public.campaigns where id = r.id and status = 'open' and deadline <= now() for update skip locked;
    if found then
      perform public.px_close_campaign(r.id, 'expired');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.px_expire_campaigns(integer) from public, anon, authenticated;
