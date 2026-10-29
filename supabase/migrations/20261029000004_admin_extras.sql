-- Editorial selection ("Discover" page), journalised like every other staff action.
create or replace function public.px_set_parcel_featured(p_actor uuid, p_parcel uuid, p_featured boolean, p_note text default null) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor);
begin
  if not exists (select 1 from public.parcels where id = p_parcel and status = 'active') then raise exception 'px_not_found'; end if;
  if p_featured then
    insert into public.parcel_features (parcel_id, note, featured_by) values (p_parcel, left(p_note, 140), p_actor)
      on conflict (parcel_id) do update set note = excluded.note, featured_by = excluded.featured_by, featured_at = now();
  else
    delete from public.parcel_features where parcel_id = p_parcel;
  end if;
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason)
  values (p_actor, case when p_featured then 'feature_parcel' else 'unfeature_parcel' end, 'parcel', p_parcel::text, p_note);
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, case when p_featured then 'parcel.feature' else 'parcel.unfeature' end, 'parcel', p_parcel::text, jsonb_build_object('note', p_note));
end $$;
revoke all on function public.px_set_parcel_featured(uuid, uuid, boolean, text) from public, anon, authenticated;

-- Audit trail for money movements started by staff (the refund itself happens at Stripe; the webhook then updates the order).
create or replace function public.px_audit_staff_refund(p_actor uuid, p_order uuid, p_reason text) returns void
language plpgsql as $$
declare v_role text := public.px_require_staff(p_actor, 'admin');
begin
  insert into public.audit_logs (actor_id, actor_role, action, target_type, target_id, metadata)
  values (p_actor, v_role, 'order.refund_requested', 'order', p_order::text, jsonb_build_object('reason', p_reason));
end $$;
revoke all on function public.px_audit_staff_refund(uuid, uuid, text) from public, anon, authenticated;
