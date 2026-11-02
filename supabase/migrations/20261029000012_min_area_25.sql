-- Smallest parcel: 25 pixels (5 × 5), was 100.
--
-- The CHECK constraints that carried the old floor are relaxed, the factory default of the admin setting `min_area` moves from
-- 100 to 25 (a value an admin chose on purpose is left alone), and px_set_setting lets the setting go down to 25.

alter table public.parcels drop constraint parcels_min_area;
alter table public.parcels add constraint parcels_min_area check (w * h >= 25);

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%area >= 100%'
  loop
    execute format('alter table public.orders drop constraint %I', c);
  end loop;
end $$;
alter table public.orders add constraint orders_min_area check (area >= 25);

update public.app_settings set value = '25'::jsonb where key = 'min_area' and value = '100'::jsonb;

create or replace function public.px_set_setting(p_actor uuid, p_key text, p_value jsonb) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  if p_key not in ('price_unit_cents', 'min_area', 'max_area', 'reservation_ttl_minutes', 'max_active_reservations_per_user', 'sales_open', 'sea_price_percent', 'min_land_percent') then
    raise exception 'px_bad_setting';
  end if;
  if p_key = 'sales_open' then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception 'px_bad_setting'; end if;
  else
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric)
       or (p_value #>> '{}')::numeric < (case when p_key = 'sea_price_percent' then 0 else 1 end) then raise exception 'px_bad_setting'; end if;
    if p_key in ('sea_price_percent', 'min_land_percent') and (p_value #>> '{}')::numeric > 100 then raise exception 'px_bad_setting'; end if;
    if p_key = 'min_area' and (p_value #>> '{}')::numeric < 25 then raise exception 'px_bad_setting'; end if;
    if p_key = 'max_area' and (p_value #>> '{}')::numeric > 1000000 then raise exception 'px_bad_setting'; end if;
    if p_key = 'reservation_ttl_minutes' and (p_value #>> '{}')::numeric < 32 then raise exception 'px_bad_setting'; end if;
  end if;
  update public.app_settings set value = p_value, updated_by = p_actor, updated_at = now() where key = p_key;
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'setting.update', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;
