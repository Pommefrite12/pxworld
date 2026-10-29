import "server-only";
import { query, queryOne } from "@/lib/db/pool";

export const PAGE_SIZE = 25;

export async function dashboard() {
  const [stats, queues, revenue, daily, ordersByStatus] = await Promise.all([
    queryOne<{ sold_pixels: number; parcels: number; owners: number; published_creations: number }>("select * from public.px_public_stats()"),
    queryOne<{ pending_assets: number; open_reports: number; refunds: number; users: number; suspended: number; held: number }>(
      `select (select count(*) from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where a.status = 'pending' and p.status = 'active')::int as pending_assets,
              (select count(*) from public.moderation_reports where status in ('open','reviewing'))::int as open_reports,
              (select count(*) from public.orders where status = 'refund_required')::int as refunds,
              (select count(*) from public.profiles where deleted_at is null)::int as users,
              (select count(*) from public.profiles where status = 'suspended')::int as suspended,
              (select count(*) from public.parcel_reservations where status = 'held' and expires_at > now())::int as held`),
    queryOne<{ total: number; d7: number; d30: number; tax: number; refunded: number; currency: string }>(
      `select coalesce(sum(o.amount_cents) filter (where o.status in ('paid','disputed')), 0)::bigint as total,
              coalesce(sum(o.amount_cents) filter (where o.status in ('paid','disputed') and o.paid_at > now() - interval '7 days'), 0)::bigint as d7,
              coalesce(sum(o.amount_cents) filter (where o.status in ('paid','disputed') and o.paid_at > now() - interval '30 days'), 0)::bigint as d30,
              coalesce(sum(o.amount_tax_cents) filter (where o.status in ('paid','disputed')), 0)::bigint as tax,
              coalesce((select sum(amount_refunded_cents) from public.payments), 0)::bigint as refunded,
              'eur' as currency
         from public.orders o`),
    query<{ day: string; pixels: number; orders: number }>(
      `select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(o.area), 0)::int as pixels, count(o.id)::int as orders
         from generate_series(current_date - 29, current_date, '1 day') d
         left join public.orders o on o.status in ('paid','disputed') and o.paid_at::date = d::date
        group by d order by d`),
    query<{ status: string; n: number }>("select status, count(*)::int as n from public.orders group by status order by n desc"),
  ]);
  return { stats, queues, revenue, daily, ordersByStatus };
}

export const moderationQueue = (offset = 0) =>
  query<{ id: string; parcel_id: string; code: string; version: number; title: string | null; description: string | null; link_url: string | null; is_commercial: boolean; width: number; height: number; created_at: Date; username: string; owner_id: string; has_published: boolean }>(
    `select a.id, a.parcel_id, p.code, a.version, a.title, a.description, a.link_url, a.is_commercial, a.width, a.height, a.created_at, u.username, u.id as owner_id,
            (p.published_asset_id is not null) as has_published
       from public.parcel_assets a join public.parcels p on p.id = a.parcel_id join public.profiles u on u.id = a.uploader_id
      where a.status = 'pending' and p.status = 'active' order by a.created_at limit ${PAGE_SIZE} offset $1`, [offset]);

export const openReports = (status: string, offset = 0) =>
  query<{ id: string; reason: string; details: string | null; status: string; created_at: Date; evidence: Record<string, unknown>; code: string; parcel_id: string; hidden: boolean; owner: string; owner_id: string; reporter: string | null; asset_id: string | null; resolution_note: string | null; same_parcel: number }>(
    `select r.id, r.reason, r.details, r.status, r.created_at, r.evidence, p.code, p.id as parcel_id, (p.hidden_at is not null) as hidden, u.username as owner, u.id as owner_id,
            rp.username as reporter, r.asset_id, r.resolution_note,
            (select count(*)::int from public.moderation_reports x where x.parcel_id = r.parcel_id and x.status in ('open','reviewing')) as same_parcel
       from public.moderation_reports r join public.parcels p on p.id = r.parcel_id join public.profiles u on u.id = p.owner_id left join public.profiles rp on rp.id = r.reporter_id
      where ($1 = 'all' or (r.status = any (case when $1 = 'open' then array['open','reviewing'] else array[$1] end))) order by r.created_at desc limit ${PAGE_SIZE} offset $2`, [status, offset]);

export const parcelsList = (q: string, offset = 0) =>
  query<{ id: string; code: string; x: number; y: number; w: number; h: number; area: number; status: string; hidden: boolean; username: string; owner_id: string; title: string | null; featured: boolean; created_at: Date }>(
    `select p.id, p.code, p.x, p.y, p.w, p.h, p.area, p.status, (p.hidden_at is not null) as hidden, u.username, u.id as owner_id, a.title,
            exists (select 1 from public.parcel_features f where f.parcel_id = p.id) as featured, p.created_at
       from public.parcels p join public.profiles u on u.id = p.owner_id left join public.parcel_assets a on a.id = p.published_asset_id
      where p.status in ('active','reserved') and ($1 = '' or p.code = lower($1) or u.username ilike '%' || $1 || '%' or a.title ilike '%' || $1 || '%')
      order by p.created_at desc limit ${PAGE_SIZE} offset $2`, [q, offset]);

export const usersList = (q: string, offset = 0) =>
  query<{ id: string; username: string; email: string | null; country: string | null; status: string; suspended_reason: string | null; created_at: Date; parcels: number; pixels: number; role: string | null }>(
    `select u.id, u.username, au.email, u.country, u.status, u.suspended_reason, u.created_at,
            (select count(*)::int from public.parcels p where p.owner_id = u.id and p.status = 'active') as parcels,
            (select coalesce(sum(area), 0)::int from public.parcels p where p.owner_id = u.id and p.status = 'active') as pixels,
            (select role from public.admin_roles r where r.user_id = u.id) as role
       from public.profiles u left join auth.users au on au.id = u.id
      where u.deleted_at is null and ($1 = '' or u.username ilike '%' || $1 || '%' or au.email ilike '%' || $1 || '%')
      order by u.created_at desc limit ${PAGE_SIZE} offset $2`, [q, offset]);

export const ordersList = (status: string, offset = 0) =>
  query<{ id: string; status: string; w: number; h: number; area: number; amount_cents: number; amount_tax_cents: number | null; currency: string; created_at: Date; paid_at: Date | null; username: string; stripe_payment_intent_id: string | null; payment_status: string | null; refunded: number | null; code: string }>(
    `select o.id, o.status, o.w, o.h, o.area, o.amount_cents, o.amount_tax_cents, o.currency, o.created_at, o.paid_at, u.username, o.stripe_payment_intent_id,
            pay.status as payment_status, pay.amount_refunded_cents as refunded, p.code
       from public.orders o join public.profiles u on u.id = o.user_id join public.parcels p on p.id = o.parcel_id left join public.payments pay on pay.order_id = o.id
      where ($1 = 'all' or o.status = $1) order by o.created_at desc limit ${PAGE_SIZE} offset $2`, [status, offset]);

export const settingsList = () => query<{ key: string; value: unknown; updated_at: Date }>("select key, value, updated_at from public.app_settings order by key");

export const auditList = (offset = 0) =>
  query<{ id: number; created_at: Date; actor: string | null; actor_role: string | null; action: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown> }>(
    `select l.id, l.created_at, u.username as actor, l.actor_role, l.action, l.target_type, l.target_id, l.metadata
       from public.audit_logs l left join public.profiles u on u.id = l.actor_id order by l.id desc limit ${PAGE_SIZE * 2} offset $1`, [offset]);
